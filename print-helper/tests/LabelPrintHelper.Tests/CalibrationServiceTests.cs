using System.Text;
using LabelPrintHelper.Configuration;
using LabelPrintHelper.Printing;

namespace LabelPrintHelper.Tests;

public sealed class CalibrationServiceTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "label-profile-tests-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SavedCalibrationIsUnverifiedUntilExplicitTestPrintSucceeds()
    {
        var fixture = CreateFixture();
        var draft = CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0);

        var calibrated = await fixture.Service.CalibrateAsync(draft);

        Assert.False(calibrated.IsVerified);
        Assert.Equal(PrinterProfileStore.ProductionProfileId, calibrated.ProfileId);
        Assert.Equal(PrinterProfileStore.ProductionProfileVersion, calibrated.Version);
        Assert.Equal(fixture.Time.GetUtcNow(), calibrated.UpdatedAtUtc);
        Assert.Null(fixture.Store.GetVerifiedProfile("printer-1", calibrated.ProfileId, calibrated.Version));
        Assert.DoesNotContain("PRINT", Encoding.ASCII.GetString(fixture.Spooler.Documents.Single()), StringComparison.OrdinalIgnoreCase);

        var tested = await fixture.Service.PrintBorderTestAsync("printer-1");

        Assert.False(tested.IsVerified);
        Assert.NotNull(tested.TestPrintSubmittedAtUtc);
        Assert.Null(fixture.Store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion));
        var verified = await fixture.Service.ConfirmBorderTestAsync("printer-1", tested.TestAttemptId!, accepted: true);
        Assert.True(verified.IsVerified);
        Assert.Equal(PrinterProfileStore.HardwareConfirmedDialect, verified.SensorCommandDialect);
        Assert.NotNull(verified.VerifiedAtUtc);
        Assert.NotNull(fixture.Store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion));
        Assert.Equal(1, Count(Encoding.ASCII.GetString(fixture.Spooler.Documents.Last()), "PRINT 1,1"));
    }

    [Theory]
    [InlineData("gap")]
    [InlineData("blackMark")]
    [InlineData("continuous")]
    public async Task EveryMediaTypeCalibratesWithoutPrinting(string mediaType)
    {
        var fixture = CreateFixture();
        var request = mediaType switch
        {
            "gap" => CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 1, 2),
            "blackMark" => CalibrationRequest.BlackMark("printer-1", "XP-420B", 3m, 0.5m, 1, 2),
            _ => CalibrationRequest.Continuous("printer-1", "XP-420B", 1, 2),
        };

        var profile = await fixture.Service.CalibrateAsync(request);

        Assert.Equal(mediaType, profile.MediaType);
        Assert.DoesNotContain("PRINT", Encoding.ASCII.GetString(fixture.Spooler.Documents.Single()), StringComparison.OrdinalIgnoreCase);
        Assert.False(profile.IsVerified);
    }

    [Fact]
    public async Task FailedOrCancelledBorderTestLeavesProfileUnverified()
    {
        var fixture = CreateFixture();
        await fixture.Service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        fixture.Spooler.Fail = true;

        await Assert.ThrowsAsync<RawPrintException>(() => fixture.Service.PrintBorderTestAsync("printer-1"));

        Assert.Null(fixture.Store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion));
        Assert.False((await fixture.Store.GetAsync("printer-1"))!.IsVerified);
    }

    [Fact]
    public async Task RejectedPhysicalBorderConfirmationLeavesProfileUnverified()
    {
        var fixture = CreateFixture();
        await fixture.Service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var tested = await fixture.Service.PrintBorderTestAsync("printer-1");
        var rejected = await fixture.Service.ConfirmBorderTestAsync("printer-1", tested.TestAttemptId!, accepted: false);
        Assert.False(rejected.IsVerified);
        Assert.Null(rejected.VerifiedAtUtc);
        Assert.Equal(PrinterProfileStore.PendingHardwareDialect, rejected.SensorCommandDialect);
        Assert.Null(fixture.Store.GetVerifiedProfile("printer-1", rejected.ProfileId, rejected.Version));
    }

    [Fact]
    public async Task RecalibrationCannotBeOverwrittenByAnOlderInFlightTestAttempt()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new InterleavingSpooler();
        var service = new CalibrationService(store, spooler, new CompatibleCatalog());
        await service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        spooler.PauseAt = 2;

        var oldTest = service.PrintBorderTestAsync("printer-1");
        await spooler.Paused.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var recalibration = service.CalibrateAsync(CalibrationRequest.BlackMark("printer-1", "XP-420B", 3m, 0.5m, 0, 0));
        await Assert.ThrowsAsync<TimeoutException>(() => spooler.ThirdCall.Task.WaitAsync(TimeSpan.FromMilliseconds(100)));
        spooler.Resume.TrySetResult();
        var oldAttempt = await oldTest;
        await recalibration;

        var current = (await store.GetAsync("printer-1"))!;
        Assert.Equal("blackMark", current.MediaType);
        Assert.Null(current.TestAttemptId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ConfirmBorderTestAsync("printer-1", oldAttempt.TestAttemptId!, accepted: true));
        Assert.Null(store.GetVerifiedProfile("printer-1", current.ProfileId, current.Version));
    }

    [Fact]
    public async Task RecalibrationRevokesVerifiedProfileBeforeChangingPrinterSensorState()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new InterleavingSpooler();
        var service = new CalibrationService(store, spooler, new CompatibleCatalog());
        await service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var tested = await service.PrintBorderTestAsync("printer-1");
        await service.ConfirmBorderTestAsync("printer-1", tested.TestAttemptId!, accepted: true);
        Assert.NotNull(store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion));
        spooler.PauseAt = 3;

        var recalibration = service.CalibrateAsync(CalibrationRequest.BlackMark("printer-1", "XP-420B", 3m, 0.5m, 0, 0));
        await spooler.Paused.Task.WaitAsync(TimeSpan.FromSeconds(2));
        bool remainedVerified;
        try
        {
            remainedVerified = store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion) is not null;
        }
        finally { spooler.Resume.TrySetResult(); }
        var result = await recalibration;
        Assert.False(remainedVerified);
        Assert.False(result.IsVerified);
    }

    [Fact]
    public async Task BorderRetestRevokesVerifiedProfileBeforeSpoolingAndFailureKeepsItBlocked()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new InterleavingSpooler();
        var service = new CalibrationService(store, spooler, new CompatibleCatalog());
        await service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var firstTest = await service.PrintBorderTestAsync("printer-1");
        await service.ConfirmBorderTestAsync("printer-1", firstTest.TestAttemptId!, accepted: true);
        spooler.PauseAt = 3;
        spooler.FailAt = 3;

        var retest = service.PrintBorderTestAsync("printer-1");
        await spooler.Paused.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var remainedVerified = store.GetVerifiedProfile("printer-1", PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion) is not null;
        spooler.Resume.TrySetResult();
        await Assert.ThrowsAsync<RawPrintException>(() => retest);

        var current = (await store.GetAsync("printer-1"))!;
        Assert.False(remainedVerified);
        Assert.False(current.IsVerified);
        Assert.Null(current.TestAttemptId);
        Assert.Null(store.GetVerifiedProfile("printer-1", current.ProfileId, current.Version));
    }

    [Fact]
    public async Task CancelledBorderRetestLeavesVerifiedProfileBlockedWithoutConfirmableAttempt()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new InterleavingSpooler();
        var service = new CalibrationService(store, spooler, new CompatibleCatalog());
        await service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var firstTest = await service.PrintBorderTestAsync("printer-1");
        await service.ConfirmBorderTestAsync("printer-1", firstTest.TestAttemptId!, accepted: true);
        spooler.PauseAt = 3;
        using var cancellation = new CancellationTokenSource();

        var retest = service.PrintBorderTestAsync("printer-1", cancellation.Token);
        await spooler.Paused.Task.WaitAsync(TimeSpan.FromSeconds(2));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => retest);

        var current = (await store.GetAsync("printer-1"))!;
        Assert.False(current.IsVerified);
        Assert.Null(current.TestAttemptId);
        Assert.Null(current.TestPrintSubmittedAtUtc);
        Assert.Null(store.GetVerifiedProfile("printer-1", current.ProfileId, current.Version));
    }

    [Fact]
    public async Task CancellationDuringBorderRetestProfileReadStillRevokesVerifiedAttempt()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new RecordingSpooler();
        var setupService = new CalibrationService(store, spooler, new CompatibleCatalog());
        await setupService.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var firstTest = await setupService.PrintBorderTestAsync("printer-1");
        await setupService.ConfirmBorderTestAsync("printer-1", firstTest.TestAttemptId!, accepted: true);
        var blockingStore = new BlockingProfileStore(store);
        var service = new CalibrationService(blockingStore, spooler, new CancellationAwareCatalog());
        using var cancellation = new CancellationTokenSource();

        var retest = service.PrintBorderTestAsync("printer-1", cancellation.Token);
        await blockingStore.ReadStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        cancellation.Cancel();
        blockingStore.ResumeRead.TrySetResult();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => retest);

        var current = (await store.GetAsync("printer-1"))!;
        Assert.False(current.IsVerified);
        Assert.Null(current.TestAttemptId);
        Assert.Null(current.TestPrintSubmittedAtUtc);
        Assert.Null(store.GetVerifiedProfile("printer-1", current.ProfileId, current.Version));
    }

    [Fact]
    public async Task PrinterLookupFailureDuringBorderRetestLeavesVerifiedProfileBlockedWithoutConfirmableAttempt()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new RecordingSpooler();
        var service = new CalibrationService(store, spooler, new CompatibleCatalog());
        await service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, 0, 0));
        var firstTest = await service.PrintBorderTestAsync("printer-1");
        await service.ConfirmBorderTestAsync("printer-1", firstTest.TestAttemptId!, accepted: true);
        service = new CalibrationService(store, spooler, new UnavailableCatalog());

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.PrintBorderTestAsync("printer-1"));

        var current = (await store.GetAsync("printer-1"))!;
        Assert.False(current.IsVerified);
        Assert.Null(current.TestAttemptId);
        Assert.Null(current.TestPrintSubmittedAtUtc);
        Assert.Null(store.GetVerifiedProfile("printer-1", current.ProfileId, current.Version));
    }

    [Fact]
    public async Task ProfileStorePersistsStrictFieldsAndMatchesExactIdentity()
    {
        var fixture = CreateFixture();
        var saved = await fixture.Service.CalibrateAsync(CalibrationRequest.BlackMark("printer-1", "XP-420B", 3m, 0.5m, 2, 3));

        var json = await File.ReadAllTextAsync(Path.Combine(root, "profiles.json"));
        Assert.Contains("\"printerId\": \"printer-1\"", json, StringComparison.Ordinal);
        Assert.Contains("\"version\": \"xp420b-100x75-v1\"", json, StringComparison.Ordinal);
        Assert.Contains("\"updatedAtUtc\":", json, StringComparison.Ordinal);
        Assert.DoesNotContain(".tmp", Directory.EnumerateFiles(root).Select(Path.GetFileName));
        Assert.Null(fixture.Store.GetVerifiedProfile("printer-X", saved.ProfileId, saved.Version));
        Assert.Null(fixture.Store.GetVerifiedProfile(saved.PrinterId, "wrong", saved.Version));
        Assert.Null(fixture.Store.GetVerifiedProfile(saved.PrinterId, saved.ProfileId, "wrong"));
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(0, -1)]
    public async Task RejectsNegativeReferencesBeforeSavingOrSpooling(int x, int y)
    {
        var fixture = CreateFixture();
        await Assert.ThrowsAsync<ArgumentException>(() => fixture.Service.CalibrateAsync(CalibrationRequest.Gap("printer-1", "XP-420B", 2m, 0m, x, y)));
        Assert.Empty(fixture.Spooler.Documents);
        Assert.Null(await fixture.Store.GetAsync("printer-1"));
    }

    private Fixture CreateFixture()
    {
        Directory.CreateDirectory(root);
        var store = new PrinterProfileStore(Path.Combine(root, "profiles.json"));
        var spooler = new RecordingSpooler();
        var time = new FixedTimeProvider(new DateTimeOffset(2026, 9, 9, 8, 0, 0, TimeSpan.Zero));
        return new(store, spooler, time, new CalibrationService(store, spooler, new CompatibleCatalog(), time));
    }

    private static int Count(string source, string value) => source.Split(value, StringSplitOptions.None).Length - 1;
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    private sealed record Fixture(PrinterProfileStore Store, RecordingSpooler Spooler, FixedTimeProvider Time, CalibrationService Service);
    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private sealed class CompatibleCatalog : IPrinterCatalog
    {
        public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PrinterDescriptor>>([new("printer-1", "XP-420B", true, true, "ready", true)]);
    }
    private sealed class UnavailableCatalog : IPrinterCatalog
    {
        public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PrinterDescriptor>>([]);
    }
    private sealed class CancellationAwareCatalog : IPrinterCatalog
    {
        public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<IReadOnlyList<PrinterDescriptor>>([new("printer-1", "XP-420B", true, true, "ready", true)]);
        }
    }
    private sealed class BlockingProfileStore(PrinterProfileStore inner) : IPrinterProfileStore
    {
        public TaskCompletionSource ReadStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ResumeRead { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<StoredPrinterProfile?> GetAsync(string printerId, CancellationToken cancellationToken = default)
        {
            ReadStarted.TrySetResult();
            await ResumeRead.Task.WaitAsync(cancellationToken);
            return await inner.GetAsync(printerId, cancellationToken);
        }

        public Task SaveAsync(StoredPrinterProfile profile, CancellationToken cancellationToken = default) =>
            inner.SaveAsync(profile, cancellationToken);
    }
    private sealed class RecordingSpooler : IRawPrintSpooler
    {
        public List<byte[]> Documents { get; } = [];
        public bool Fail { get; set; }
        public Task<int> SubmitAsync(string printerName, ReadOnlyMemory<byte> document, string documentName, CancellationToken cancellationToken)
        {
            Documents.Add(document.ToArray());
            if (Fail) throw new RawPrintException(RawPrintFailureStage.WritePrinter, PrintSubmissionCertainty.NotSubmitted, null, 5, "test failure");
            return Task.FromResult(Documents.Count);
        }
    }
    private sealed class InterleavingSpooler : IRawPrintSpooler
    {
        private int calls;
        public int PauseAt { get; set; }
        public int FailAt { get; set; }
        public TaskCompletionSource Paused { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ThirdCall { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<int> SubmitAsync(string printerName, ReadOnlyMemory<byte> document, string documentName, CancellationToken cancellationToken)
        {
            var call = Interlocked.Increment(ref calls);
            if (call == 3) ThirdCall.TrySetResult();
            if (call == PauseAt) { Paused.TrySetResult(); await Resume.Task.WaitAsync(cancellationToken); }
            if (call == FailAt) throw new RawPrintException(RawPrintFailureStage.WritePrinter, PrintSubmissionCertainty.NotSubmitted, null, 5, "interleaved failure");
            return call;
        }
    }
}
