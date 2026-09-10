using LabelPrintHelper.Lifecycle;
using LabelPrintHelper.Maintenance;

namespace LabelPrintHelper.Tests;

public sealed class HelperLifecycleTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "label-maintenance-tests-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(new string[0], LaunchMode.Background)]
    [InlineData(new[] { "labelprint://start" }, LaunchMode.FocusDiagnostics)]
    [InlineData(new[] { "--maintenance-cleanup" }, LaunchMode.MaintenanceCleanup)]
    [InlineData(new[] { "--shutdown" }, LaunchMode.Shutdown)]
    public void AcceptsOnlyNarrowLaunchShapes(string[] arguments, LaunchMode expected)
    {
        Assert.Equal(expected, LaunchRequest.Parse(arguments).Mode);
    }

    [Fact]
    public void CalibrationProtocolLaunchIsExactAndCarriesNoPayload()
    {
        var request = LaunchRequest.Parse(["labelprint://calibrate"]);

        Assert.Equal("FocusCalibration", request.Mode.ToString());
        Assert.Throws<ArgumentException>(() => LaunchRequest.Parse(["labelprint://calibrate?printerId=secret"]));
        Assert.Throws<ArgumentException>(() => LaunchRequest.Parse(["labelprint://calibrate/anything"]));
    }

    [Theory]
    [InlineData("labelprint://start?file=c:%5Csecret")]
    [InlineData("labelprint://start/anything")]
    [InlineData("labelprint://print")]
    [InlineData("--maintenance-cleanup", "extra")]
    [InlineData("C:\\label.png")]
    public void RejectsProtocolPayloadsFilesAndArbitraryArguments(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => LaunchRequest.Parse(arguments));
    }

    [Fact]
    public void SecondInstanceSignalsExistingInstanceAndDoesNotOwnLifecycle()
    {
        var seam = new FakeSingleInstancePlatform { OwnsMutex = false };
        using var coordinator = new SingleInstanceCoordinator(seam);

        Assert.False(coordinator.TryAcquire());
        Assert.Equal(1, seam.SignalCalls);
        Assert.False(coordinator.IsPrimary);
    }

    [Fact]
    public void MaintenanceAcquisitionDoesNotSignalOrRaceAnActiveInstance()
    {
        var seam = new FakeSingleInstancePlatform { OwnsMutex = false };
        using var coordinator = new SingleInstanceCoordinator(seam);
        Assert.False(coordinator.TryAcquire(signalExisting: false));
        Assert.Equal(0, seam.SignalCalls);
    }

    [Fact]
    public void ActivationRequestedBeforeTrayExistsIsDeliveredAfterTargetAttaches()
    {
        var calls = 0;
        var activation = new DeferredActivation();
        activation.Request();
        activation.SetTarget(() => calls++);
        Assert.Equal(1, calls);
    }

    [Fact]
    public void ScopedShutdownUsesItsOwnPerUserSignal()
    {
        var seam = new FakeSingleInstancePlatform();
        using var coordinator = new SingleInstanceCoordinator(seam);
        coordinator.SignalShutdown();
        Assert.Equal(SingleInstanceCoordinator.ShutdownEventName, seam.LastSignal);
    }

    [Fact]
    public void CalibrationLaunchSignalsItsOwnPerUserActivation()
    {
        var seam = new FakeSingleInstancePlatform();
        using var coordinator = new SingleInstanceCoordinator(seam);

        coordinator.SignalCalibration();

        Assert.Equal(SingleInstanceCoordinator.CalibrationEventName, seam.LastSignal);
    }

    [Fact]
    public async Task MaintenanceDeletesOnlyProductDataAndInvokesProductCertificateCleanup()
    {
        Directory.CreateDirectory(root);
        var product = Path.Combine(root, "LabelPrintHelper");
        var unrelated = Path.Combine(root, "OtherApp");
        Directory.CreateDirectory(Path.Combine(product, "jobs"));
        Directory.CreateDirectory(unrelated);
        await File.WriteAllTextAsync(Path.Combine(product, "jobs", "label.png"), "bitmap");
        await File.WriteAllTextAsync(Path.Combine(product, "profiles.json"), "keep calibration");
        await File.WriteAllTextAsync(Path.Combine(unrelated, "keep.txt"), "keep");
        var certificates = new FakeCertificateCleanup();

        var result = await new MaintenanceService(certificates, new ProductDataCleaner(product)).CleanupAsync();

        Assert.Equal(2, result.RemovedCertificates);
        Assert.Equal(1, certificates.Calls);
        Assert.False(Directory.Exists(Path.Combine(product, "jobs")));
        Assert.True(File.Exists(Path.Combine(product, "profiles.json")));
        Assert.True(File.Exists(Path.Combine(unrelated, "keep.txt")));
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    private sealed class FakeSingleInstancePlatform : ISingleInstancePlatform
    {
        public bool OwnsMutex { get; init; }
        public int SignalCalls { get; private set; }
        public string? LastSignal { get; private set; }
        public bool TryAcquire(string mutexName) => OwnsMutex;
        public void Signal(string eventName) { SignalCalls++; LastSignal = eventName; }
        public IDisposable Listen(string eventName, Action onSignal) => new EmptyDisposable();
        public void Release() { }
        public void Dispose() { }
        private sealed class EmptyDisposable : IDisposable { public void Dispose() { } }
    }
    private sealed class FakeCertificateCleanup : IProductCertificateCleanup
    {
        public int Calls { get; private set; }
        public int RemoveProductCertificates() { Calls++; return 2; }
    }
}
