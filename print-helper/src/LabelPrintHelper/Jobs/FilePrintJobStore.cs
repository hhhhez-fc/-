using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LabelPrintHelper.Jobs;

public sealed class FilePrintJobStore : IPrintJobStore
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new(StringComparer.OrdinalIgnoreCase);
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
    private readonly string root;
    public FilePrintJobStore(string? root = null)
    {
        this.root = Path.GetFullPath(root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LabelPrintHelper", "jobs"));
        Directory.CreateDirectory(this.root);
        RejectReparsePoint(this.root);
    }
    private static string Name(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private string JobDirectory(string jobId)
    {
        var path = Path.GetFullPath(Path.Combine(root, Name(jobId)));
        if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("任务存储路径无效");
        RejectReparsePoint(root);
        RejectReparsePoint(path);
        return path;
    }
    private static void RejectReparsePoint(string path)
    {
        if ((Directory.Exists(path) || File.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("任务存储不支持链接路径");
    }
    public async Task<IDisposable> AcquireAsync(string jobId, CancellationToken cancellationToken = default)
    {
        var directory = JobDirectory(jobId);
        var gate = Gates.GetOrAdd(directory, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(directory);
            // FileShare.None prevents a second helper process from printing the same job concurrently.
            var path = Path.Combine(directory, "job.lock");
            RejectReparsePoint(path);
            return new Lease(gate, new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
        }
        catch { gate.Release(); throw; }
    }
    public async Task<StoredPrintJob?> ReadAsync(string jobId)
    {
        var path = Path.Combine(JobDirectory(jobId), "state.json");
        return await ReadStateSnapshotAsync(path);
    }
    public Task SaveAsync(StoredPrintJob job) => AtomicWriteAsync(Path.Combine(JobDirectory(job.Summary.JobId), "state.json"), JsonSerializer.SerializeToUtf8Bytes(job, JsonOptions));
    public async Task<byte[]?> ReadAssetAsync(string jobId, string assetId)
    {
        var path = Path.Combine(JobDirectory(jobId), Name(assetId) + ".png");
        await using var stream = await OpenSnapshotAsync(path);
        if (stream is null) return null;
        using var bytes = new MemoryStream();
        await stream.CopyToAsync(bytes);
        return bytes.ToArray();
    }
    public Task SaveAssetAsync(string jobId, string assetId, byte[] bytes) => AtomicWriteAsync(Path.Combine(JobDirectory(jobId), Name(assetId) + ".png"), bytes);
    private static async Task AtomicWriteAsync(string path, byte[] bytes)
    {
        RejectReparsePoint(path);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes);
                stream.Flush(flushToDisk: true);
            }
            if (File.Exists(path)) File.Replace(temporary, path, destinationBackupFileName: null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public Task DeleteAssetsAsync(string jobId)
    {
        var directory = JobDirectory(jobId);
        foreach (var file in Directory.EnumerateFiles(directory).Where(path => path.EndsWith(".png", StringComparison.Ordinal) || path.EndsWith(".tmp", StringComparison.Ordinal)))
        {
            RejectReparsePoint(file);
            File.Delete(file);
        }
        return Task.CompletedTask;
    }
    public async IAsyncEnumerable<string> GetJobIdsAsync()
    {
        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            RejectReparsePoint(directory);
            var path = Path.Combine(directory, "state.json");
            var job = await ReadStateSnapshotAsync(path);
            if (job is not null && string.Equals(directory, JobDirectory(job.Summary.JobId), StringComparison.OrdinalIgnoreCase)) yield return job.Summary.JobId;
        }
    }
    private static async Task<FileStream?> OpenSnapshotAsync(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                RejectReparsePoint(path);
                // Atomic replacement publishes a new file; readers keep their old
                // immutable handle and must allow the publisher to replace its name.
                return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
            }
            catch (IOException exception) when (attempt < 5 && (exception.HResult & 0xffff) is 2 or 3 or 32 or 33)
            {
                // ReplaceFile may briefly own the destination name. Retry only
                // the read-open, never the spool operation or an arbitrary I/O error.
                await Task.Delay(2);
            }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
        }
    }
    private static async Task<StoredPrintJob?> ReadStateSnapshotAsync(string path)
    {
        await using var stream = await OpenSnapshotAsync(path);
        return stream is null ? null : await JsonSerializer.DeserializeAsync<StoredPrintJob>(stream, JsonOptions) ?? throw new IOException("打印任务状态损坏");
    }
    private sealed class Lease(SemaphoreSlim gate, FileStream stream) : IDisposable
    {
        public void Dispose() { stream.Dispose(); gate.Release(); }
    }
}
