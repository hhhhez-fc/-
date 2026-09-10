using System.Drawing;
using System.Drawing.Imaging;
using System.Security.Cryptography;
using LabelPrintHelper.Jobs;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Tests;

public sealed class PrintJobServiceTests
{
    [Fact]
    public async Task IdenticalCreateUploadAndConcurrentCommitNeverPrintTwice()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest(2);
        await fixture.Service.CreateAsync(manifest);
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        await fixture.Upload(manifest);
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => fixture.Service.CommitAsync(manifest.JobId!)));
        Assert.All(results, result => Assert.Equal("submitted", result.Status));
        Assert.Equal(2, fixture.Spooler.Calls);
        Assert.Equal(new uint?[] { 1, 2 }, results[0].Pages.Select(page => page.WindowsJobId));
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
        Assert.DoesNotContain("pngBase64", string.Join("", Directory.GetFiles(fixture.Root, "*.json", SearchOption.AllDirectories).Select(File.ReadAllText)));
        Assert.DoesNotContain("XP-420B", string.Join("", Directory.GetFiles(fixture.Root, "*.json", SearchOption.AllDirectories).Select(File.ReadAllText)));
        var restarted = fixture.NewService();
        Assert.Equal("submitted", (await restarted.CommitAsync(manifest.JobId!)).Status);
        Assert.Equal(2, fixture.Spooler.Calls);
    }

    [Fact]
    public async Task ChangedManifestAndChangedUploadConflictWithoutMutatingOriginal()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        await Assert.ThrowsAsync<PrintJobConflictException>(() => fixture.Service.CreateAsync(manifest with { WebsiteVersion = "other" }));
        await fixture.Upload(manifest);
        var changed = JobFixture.Asset(Color.Black);
        await Assert.ThrowsAsync<PrintJobConflictException>(() => fixture.Service.UploadAsync(manifest.JobId!, changed.AssetId!, changed));
        Assert.Equal("submitted", (await fixture.Service.CommitAsync(manifest.JobId!)).Status);
        Assert.Equal(1, fixture.Spooler.Calls);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("changed")]
    [InlineData("dimension")]
    [InlineData("hash")]
    [InlineData("profile")]
    [InlineData("printer")]
    public async Task InvalidInputsRejectBeforeAnySpoolWrite(string scenario)
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        if (scenario == "dimension") manifest = manifest with { Assets = [JobFixture.Asset(Color.White, 1)] };
        if (scenario == "hash") manifest = manifest with { Assets = [manifest.Assets![0] with { Sha256 = new string('a', 64) }] };
        if (scenario == "profile") fixture.Profiles.Verified = false;
        if (scenario == "printer") fixture.Catalog.Available = false;
        await fixture.Service.CreateAsync(manifest);
        if (scenario == "hash") await Assert.ThrowsAsync<ProtocolValidationException>(() => fixture.Upload(manifest));
        else if (scenario != "missing") await fixture.Upload(manifest);
        if (scenario == "changed") File.WriteAllBytes(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories).Single(), [1, 2]);
        await Assert.ThrowsAsync<ProtocolValidationException>(() => fixture.Service.CommitAsync(manifest.JobId!));
        Assert.Equal(0, fixture.Spooler.Calls);
    }

    [Theory]
    [InlineData(PrintSubmissionCertainty.NotSubmitted, 1, "failed", 0)]
    [InlineData(PrintSubmissionCertainty.NotSubmitted, 2, "partial", 1)]
    [InlineData(PrintSubmissionCertainty.Unknown, 2, "unknown", 1)]
    [InlineData(PrintSubmissionCertainty.Submitted, 1, "partial", 1)]
    public async Task TypedFailuresPersistConservativeOutcomeAndNeverRetry(PrintSubmissionCertainty certainty, int failAt, string status, int submitted)
    {
        using var fixture = new JobFixture();
        fixture.Spooler.FailAt = failAt;
        fixture.Spooler.Certainty = certainty;
        var manifest = fixture.Manifest(3);
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        var result = await fixture.Service.CommitAsync(manifest.JobId!);
        Assert.Equal(status, result.Status);
        Assert.Equal(submitted, result.Pages.Count(page => page.Status == "submitted"));
        Assert.Equal(RawPrintFailureStage.WritePrinter, result.Pages[failAt - 1].FailureStage);
        Assert.Equal((uint?)99, result.Pages[failAt - 1].WindowsJobId);
        await fixture.Service.CommitAsync(manifest.JobId!);
        Assert.Equal(failAt, fixture.Spooler.Calls);
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task AbandonedJobsExpireAndPathLikeIdsRemainInsideRoot()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest() with { JobId = "../../unsafe" };
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        fixture.Time.Now += TimeSpan.FromHours(25);
        await fixture.Service.CleanupExpiredAsync();
        Assert.Equal("failed", (await fixture.Service.GetAsync(manifest.JobId!)).Status);
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
        Assert.Single(Directory.GetDirectories(fixture.Root));
    }

    [Fact]
    public async Task RestartAfterPersistedSubmittingNeverResubmits()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        var store = new FilePrintJobStore(fixture.Root);
        using (await store.AcquireAsync(manifest.JobId!))
        {
            var job = (await store.ReadAsync(manifest.JobId!))!;
            await store.SaveAsync(job with { Summary = job.Summary with { Status = "submitting", Pages = [job.Summary.Pages[0] with { Status = "submitting" }] } });
        }
        var result = await fixture.NewService().CommitAsync(manifest.JobId!);
        Assert.Equal("unknown", result.Status);
        Assert.Equal(PrintSubmissionCertainty.Unknown, result.Pages[0].Certainty);
        Assert.Equal(0, fixture.Spooler.Calls);
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task InvalidBase64AndTruncatedPngCannotBeUploaded()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        var asset = manifest.Assets![0];
        await Assert.ThrowsAsync<ProtocolValidationException>(() => fixture.Service.UploadAsync(manifest.JobId!, asset.AssetId!, asset with { PngBase64 = asset.PngBase64 + " " }));
        await Assert.ThrowsAsync<ProtocolValidationException>(() => fixture.Service.UploadAsync(manifest.JobId!, asset.AssetId!, asset with { PngBase64 = Convert.ToBase64String(Convert.FromBase64String(asset.PngBase64!)[..32]) }));
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
        Assert.Equal(0, fixture.Spooler.Calls);
    }

    [Fact]
    public async Task UntypedSpoolFailureIsUnknownAndNoRetry()
    {
        using var fixture = new JobFixture();
        fixture.Spooler.UntypedFailure = true;
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        Assert.Equal("unknown", (await fixture.Service.CommitAsync(manifest.JobId!)).Status);
        await fixture.NewService().CommitAsync(manifest.JobId!);
        Assert.Equal(1, fixture.Spooler.Calls);
    }

    [Fact]
    public async Task GetReturnsLiveSnapshotWhileSecondPageSubmissionIsPaused()
    {
        using var fixture = new JobFixture();
        fixture.Spooler.PauseAt = 2;
        var manifest = fixture.Manifest(2);
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        var commit = fixture.Service.CommitAsync(manifest.JobId!);
        await fixture.Spooler.Paused.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            var snapshot = await fixture.NewService().GetAsync(manifest.JobId!, timeout.Token).WaitAsync(timeout.Token);
            Assert.Equal("submitting", snapshot.Status);
            Assert.Equal("submitted", snapshot.Pages[0].Status);
            Assert.Equal((uint?)1, snapshot.Pages[0].WindowsJobId);
            Assert.Equal("submitting", snapshot.Pages[1].Status);
            Assert.Equal(2, fixture.Spooler.Calls);
            Assert.NotEmpty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
        }
        finally { fixture.Spooler.Resume.TrySetResult(); await commit; }
        Assert.Equal("submitted", (await fixture.Service.GetAsync(manifest.JobId!)).Status);
        Assert.Equal(2, fixture.Spooler.Calls);
    }

    [Fact]
    public async Task ConcurrentSnapshotReadersAndAtomicReplacementNeverConflict()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        var store = new FilePrintJobStore(fixture.Root);
        var job = (await store.ReadAsync(manifest.JobId!))!;
        // A substantial summary keeps reader handles open long enough to exercise replacement sharing.
        job = job with { Summary = job.Summary with { Pages = Enumerable.Range(1, 2000).Select(i => job.Summary.Pages[0] with { Ordinal = i }).ToArray() } };
        await store.SaveAsync(job);
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var writers = Task.Run(async () =>
        {
            await start.Task;
            for (var i = 0; i < 40; i++) await store.SaveAsync(job with { Summary = job.Summary with { UpdatedAtUtc = job.Summary.UpdatedAtUtc.AddSeconds(i) } });
        });
        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
        {
            await start.Task;
            for (var i = 0; i < 40; i++)
            {
                Assert.Equal(2000, (await store.ReadAsync(manifest.JobId!))!.Summary.Pages.Count);
                await foreach (var id in store.GetJobIdsAsync()) Assert.Equal(manifest.JobId, id);
            }
        })).ToArray();
        start.SetResult();
        await Task.WhenAll(readers.Append(writers));
    }

    [Fact]
    public async Task HighBitWindowsJobIdSurvivesPersistence()
    {
        using var fixture = new JobFixture();
        fixture.Spooler.WindowsJobId = unchecked((int)0xF0000001);
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        await fixture.Service.CommitAsync(manifest.JobId!);
        Assert.Equal((uint?)0xF0000001, (await fixture.NewService().GetAsync(manifest.JobId!)).Pages[0].WindowsJobId);
    }

    [Fact]
    public async Task InvalidSecondDistinctAssetPreventsEvenFirstSpoolCall()
    {
        using var fixture = new JobFixture();
        var first = JobFixture.Asset(Color.White);
        var second = JobFixture.Asset(Color.Black, 1) with { AssetId = "asset-2", LabelId = "label-2" };
        var manifest = fixture.Manifest() with { Range = new(1, 2), ExpectedLabels = 2, Assets = [first, second], Sequence = [new(1, first.AssetId, first.LabelId, 1, 1), new(2, second.AssetId, second.LabelId, 2, 1)] };
        await fixture.Service.CreateAsync(manifest);
        await fixture.Upload(manifest);
        await Assert.ThrowsAsync<ProtocolValidationException>(() => fixture.Service.CommitAsync(manifest.JobId!));
        Assert.Equal(0, fixture.Spooler.Calls);
    }
}

internal sealed class JobFixture : IDisposable
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "label-job-tests-" + Guid.NewGuid());
    public FakeSpooler Spooler { get; } = new();
    public FakeCatalog Catalog { get; } = new();
    public FakeProfiles Profiles { get; } = new();
    public FakeTime Time { get; } = new();
    public PrintJobService Service { get; }
    public JobFixture() => Service = NewService();
    public PrintJobService NewService() => new(new FilePrintJobStore(Root), Spooler, Catalog, Profiles, Time);
    public PrintJobManifest Manifest(int copies = 1) => new(1, "job-1", "2026-09-08T00:00:00Z", "1", "printer-1", "XP-420B", ProtocolValidator.ProfileId, "1", 100, 75, 800, 600, "landscape", new(1, 1), copies, true, 0, 0, new("text", null), copies, [Asset(Color.White)], Enumerable.Range(1, copies).Select(i => new PrintSequenceEntry(i, "asset-1", "label-1", 1, i)).ToArray());
    public async Task Upload(PrintJobManifest manifest)
    {
        foreach (var asset in manifest.Assets!) await Service.UploadAsync(manifest.JobId!, asset.AssetId!, asset);
    }
    public static PrintAssetUpload Asset(Color color, int width = 800)
    {
        using var bitmap = new Bitmap(width, 600);
        using (var graphics = Graphics.FromImage(bitmap)) graphics.Clear(color);
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        var bytes = stream.ToArray();
        return new("asset-1", "label-1", 800, 600, 0, Convert.ToBase64String(bytes), Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }
    public void Dispose() { if (Directory.Exists(Root)) Directory.Delete(Root, true); }
    internal sealed class FakeTime : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
    internal sealed class FakeCatalog : IPrinterCatalog
    {
        public bool Available = true;
        public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<PrinterDescriptor>>([new("printer-1", "XP-420B", true, true, Available ? "ready" : "offline", Available)]);
    }
    internal sealed class FakeProfiles : IVerifiedPrinterProfileProvider
    {
        public bool Verified = true;
        public PrinterProfile? GetVerifiedProfile(string printerId, string profileId, string version) => Verified ? new(100, 75, 800, 600, new GapMediaSensing(2, 0), 1, 0, 0) : null;
    }
    internal sealed class FakeSpooler : IRawPrintSpooler
    {
        public int Calls;
        public int FailAt;
        public PrintSubmissionCertainty Certainty;
        public bool UntypedFailure;
        public int PauseAt;
        public int? WindowsJobId;
        public TaskCompletionSource Paused { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<int> SubmitAsync(string printerName, ReadOnlyMemory<byte> document, string documentName, CancellationToken cancellationToken)
        {
            var call = Interlocked.Increment(ref Calls);
            await Task.Yield();
            if (call == PauseAt) { Paused.TrySetResult(); await Resume.Task; }
            if (UntypedFailure) throw new IOException("fake unexpected failure");
            if (call == FailAt) throw new RawPrintException(RawPrintFailureStage.WritePrinter, Certainty, 99, 5, "fake failure");
            return WindowsJobId ?? call;
        }
    }
}
