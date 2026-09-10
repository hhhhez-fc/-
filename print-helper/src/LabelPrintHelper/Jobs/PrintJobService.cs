using System.Security.Cryptography;
using System.Text.Json;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Jobs;

public sealed class PrintJobService(IPrintJobStore store, IRawPrintSpooler spooler, IPrinterCatalog printers, IVerifiedPrinterProfileProvider profiles, TimeProvider? timeProvider = null)
{
    private readonly TimeProvider time = timeProvider ?? TimeProvider.System;

    public async Task<PrintJobStatus> CreateAsync(PrintJobManifest manifest, CancellationToken cancellationToken = default)
    {
        ProtocolValidator.ValidateManifest(manifest);
        // Snapshot caller-owned collections, canonicalize representation and never persist image content in JSON.
        var canonical = manifest with { Assets = manifest.Assets!.OrderBy(asset => asset.AssetId, StringComparer.Ordinal).Select(asset => asset with { Sha256 = asset.Sha256!.ToLowerInvariant() }).ToArray() };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(canonical, FilePrintJobStore.JsonOptions);
        canonical = JsonSerializer.Deserialize<PrintJobManifest>(bytes, FilePrintJobStore.JsonOptions)!;
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(bytes));
        using var lease = await store.AcquireAsync(canonical.JobId!, cancellationToken);
        var existing = await store.ReadAsync(canonical.JobId!);
        if (existing is not null)
        {
            if (existing.Summary.ManifestFingerprint != fingerprint) throw new PrintJobConflictException("任务标识已被不同的打印内容使用");
            return (await RecoverAsync(existing)).Summary;
        }
        var now = time.GetUtcNow();
        var assets = canonical.Assets!.ToDictionary(asset => asset.AssetId!, StringComparer.Ordinal);
        var summary = new PrintJobStatus(canonical.JobId!, fingerprint, "received", now, now,
            canonical.Sequence!.Select(entry => new PrintPageOutcome(entry.Ordinal, entry.AssetId!, assets[entry.AssetId!].Sha256!)).ToArray());
        await store.SaveAsync(new(summary, canonical with { Assets = canonical.Assets!.Select(asset => asset with { PngBase64 = null }).ToArray() }));
        return summary;
    }

    public async Task<PrintJobStatus> UploadAsync(string jobId, string assetId, PrintAssetUpload upload, CancellationToken cancellationToken = default)
    {
        ProtocolValidator.ValidateAsset(upload);
        if (upload.AssetId != assetId) throw new ProtocolValidationException("资产标识与上传路径不一致");
        using var lease = await store.AcquireAsync(jobId, cancellationToken);
        var job = await GetStoredAsync(jobId);
        var expected = job.Summary.Pages.FirstOrDefault(page => page.AssetId == assetId) ?? throw new ProtocolValidationException("资产不属于该打印任务");
        var bytes = Convert.FromBase64String(upload.PngBase64!);
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        var existing = await store.ReadAssetAsync(jobId, assetId);
        if (existing is not null && !existing.AsSpan().SequenceEqual(bytes)) throw new PrintJobConflictException("资产标识已被不同内容使用");
        if (!string.Equals(upload.Sha256, expected.Sha256, StringComparison.OrdinalIgnoreCase)) throw new PrintJobConflictException("资产与已登记内容不一致");
        if (!string.Equals(hash, expected.Sha256, StringComparison.OrdinalIgnoreCase)) throw new ProtocolValidationException("打印资产 SHA-256 校验失败");
        if (job.Summary.IsTerminal) return job.Summary;
        var descriptor = job.Manifest!.Assets!.Single(asset => asset.AssetId == assetId);
        if ((upload with { PngBase64 = null, Sha256 = descriptor.Sha256 }) != descriptor) throw new PrintJobConflictException("资产属性与已登记内容不一致");
        if (existing is null) await store.SaveAssetAsync(jobId, assetId, bytes);
        return job.Summary;
    }

    public async Task<PrintJobStatus> GetAsync(string jobId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // A live submission owns the write lock for its full sequence. Polling reads
        // its last atomic snapshot without waiting or treating it as a crashed job.
        // Recovery is permitted only to callers holding the exclusive task lease.
        return (await store.ReadAsync(jobId) ?? throw new PrintJobNotFoundException()).Summary;
    }

    public async Task<PrintJobStatus> CommitAsync(string jobId, CancellationToken cancellationToken = default)
    {
        using var lease = await store.AcquireAsync(jobId, cancellationToken);
        var job = await GetStoredAsync(jobId);
        if (job.Summary.IsTerminal) return job.Summary;
        job = job with { Summary = job.Summary with { Status = "validating", UpdatedAtUtc = time.GetUtcNow() } };
        await store.SaveAsync(job);
        byte[][] documents;
        string printerName;
        try
        {
            var manifest = job.Manifest!;
            var assets = new List<PrintAssetUpload>();
            foreach (var asset in manifest.Assets!)
            {
                var bytes = await store.ReadAssetAsync(jobId, asset.AssetId!) ?? throw new ProtocolValidationException("打印资产尚未全部上传");
                if (!string.Equals(Convert.ToHexStringLower(SHA256.HashData(bytes)), asset.Sha256, StringComparison.OrdinalIgnoreCase)) throw new ProtocolValidationException("打印资产 SHA-256 校验失败");
                assets.Add(asset with { PngBase64 = Convert.ToBase64String(bytes) });
            }
            manifest = manifest with { Assets = assets };
            ProtocolValidator.ValidateManifest(manifest);
            var printer = (await printers.GetPrintersAsync(cancellationToken)).SingleOrDefault(item => item.Id == manifest.PrinterId);
            if (printer is null || !printer.IsCompatible || !printer.IsAvailable || printer.DisplayName != manifest.PrinterName) throw new ProtocolValidationException("目标 XP-420B 打印机不可用");
            printerName = printer.DisplayName;
            var profile = profiles.GetVerifiedProfile(printer.Id, manifest.ProfileId!, manifest.PrinterProfileVersion!) ?? throw new ProtocolValidationException("打印机尚未完成纸张校准验证");
            var threshold = manifest.Threshold!.Value ?? (manifest.Threshold.Mode == "text" ? 180 : 128);
            var encoded = assets.ToDictionary(asset => asset.AssetId!, asset => TsplEncoder.EncodePage(MonochromeRasterizer.Rasterize(asset, threshold), profile), StringComparer.Ordinal);
            documents = manifest.Sequence!.Select(entry => encoded[entry.AssetId!]).ToArray();
        }
        catch (Exception exception) when (exception is ProtocolValidationException or InvalidDataException or ArgumentException)
        {
            await FinishAsync(job, "failed");
            throw new ProtocolValidationException(exception.Message);
        }
        // Once submission starts, request disconnection must not cancel or replay the operation.
        job = job with { Summary = job.Summary with { Status = "submitting", UpdatedAtUtc = time.GetUtcNow() } };
        await store.SaveAsync(job);
        var pages = job.Summary.Pages.ToArray();
        for (var index = 0; index < documents.Length; index++)
        {
            pages[index] = pages[index] with { Status = "submitting" };
            job = job with { Summary = job.Summary with { Pages = pages.ToArray(), UpdatedAtUtc = time.GetUtcNow() } };
            await store.SaveAsync(job);
            try
            {
                var windowsId = await spooler.SubmitAsync(printerName, documents[index], $"LabelPrintHelper {jobId} #{index + 1}", CancellationToken.None);
                pages[index] = pages[index] with { Status = "submitted", WindowsJobId = unchecked((uint)windowsId), Certainty = PrintSubmissionCertainty.Submitted };
                job = job with { Summary = job.Summary with { Pages = pages.ToArray(), UpdatedAtUtc = time.GetUtcNow() } };
                await store.SaveAsync(job);
            }
            catch (RawPrintException exception)
            {
                pages[index] = pages[index] with { Status = exception.SubmissionCertainty == PrintSubmissionCertainty.Submitted ? "submitted" : exception.SubmissionCertainty == PrintSubmissionCertainty.Unknown ? "unknown" : "failed", WindowsJobId = exception.WindowsJobId, FailureStage = exception.Stage, Certainty = exception.SubmissionCertainty };
                job = job with { Summary = job.Summary with { Pages = pages.ToArray() } };
                var status = exception.SubmissionCertainty == PrintSubmissionCertainty.Unknown ? "unknown" : pages.All(page => page.Status == "submitted") ? "submitted" : pages.Any(page => page.Status == "submitted") ? "partial" : "failed";
                return await FinishAsync(job, status);
            }
            catch (Exception)
            {
                // An untyped error, including persistence failure after a spool call, is ambiguous.
                pages[index] = pages[index] with { Status = "unknown", Certainty = PrintSubmissionCertainty.Unknown };
                return await FinishAsync(job with { Summary = job.Summary with { Pages = pages.ToArray() } }, "unknown");
            }
        }
        return await FinishAsync(job, "submitted");
    }

    public async Task CleanupExpiredAsync(CancellationToken cancellationToken = default)
    {
        await foreach (var jobId in store.GetJobIdsAsync())
        {
            using var lease = await store.AcquireAsync(jobId, cancellationToken);
            _ = await GetStoredAsync(jobId);
        }
    }
    private async Task<StoredPrintJob> GetStoredAsync(string jobId) => await RecoverAsync(await store.ReadAsync(jobId) ?? throw new PrintJobNotFoundException());
    private async Task<StoredPrintJob> RecoverAsync(StoredPrintJob job)
    {
        if (job.Summary.IsTerminal)
        {
            await store.DeleteAssetsAsync(job.Summary.JobId);
            return job;
        }
        if (job.Summary.Status == "submitting")
        {
            var pages = job.Summary.Pages.Select(page => page.Status == "submitting" ? page with { Status = "unknown", Certainty = PrintSubmissionCertainty.Unknown } : page).ToArray();
            return new(await FinishAsync(job with { Summary = job.Summary with { Pages = pages } }, "unknown"), null);
        }
        if (time.GetUtcNow() - job.Summary.CreatedAtUtc >= TimeSpan.FromHours(24)) return new(await FinishAsync(job, "failed"), null);
        return job;
    }
    private async Task<PrintJobStatus> FinishAsync(StoredPrintJob job, string status)
    {
        var summary = job.Summary with { Status = status, UpdatedAtUtc = time.GetUtcNow() };
        await store.SaveAsync(new(summary, null));
        await store.DeleteAssetsAsync(summary.JobId);
        return summary;
    }
}
