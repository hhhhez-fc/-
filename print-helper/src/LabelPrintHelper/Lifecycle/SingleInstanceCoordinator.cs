namespace LabelPrintHelper.Lifecycle;

public interface ISingleInstancePlatform : IDisposable
{
    bool TryAcquire(string mutexName);
    void Signal(string eventName);
    IDisposable Listen(string eventName, Action onSignal);
    void Release();
}

public sealed class SingleInstanceCoordinator : IDisposable
{
    internal const string MutexName = "Local\\LabelPrintHelper.Singleton.v1";
    internal const string ActivationEventName = "Local\\LabelPrintHelper.Activate.v1";
    internal const string CalibrationEventName = "Local\\LabelPrintHelper.Calibrate.v1";
    internal const string ShutdownEventName = "Local\\LabelPrintHelper.Shutdown.v1";
    private readonly ISingleInstancePlatform platform;
    private readonly List<IDisposable> listeners = [];

    public SingleInstanceCoordinator() : this(new WindowsSingleInstancePlatform()) { }
    internal SingleInstanceCoordinator(ISingleInstancePlatform platform) => this.platform = platform;
    public bool IsPrimary { get; private set; }

    public bool TryAcquire(Action? onActivation = null, bool signalExisting = true, Action? onShutdown = null, Action? onCalibration = null)
    {
        if (IsPrimary) return true;
        if (!platform.TryAcquire(MutexName))
        {
            if (signalExisting) platform.Signal(ActivationEventName);
            return false;
        }
        IsPrimary = true;
        listeners.Add(platform.Listen(ActivationEventName, onActivation ?? (() => { })));
        listeners.Add(platform.Listen(CalibrationEventName, onCalibration ?? (() => { })));
        listeners.Add(platform.Listen(ShutdownEventName, onShutdown ?? (() => { })));
        return true;
    }

    public void SignalShutdown() => platform.Signal(ShutdownEventName);
    public void SignalCalibration() => platform.Signal(CalibrationEventName);

    public void Dispose()
    {
        foreach (var listener in listeners) listener.Dispose();
        listeners.Clear();
        if (IsPrimary) platform.Release();
        platform.Dispose();
        IsPrimary = false;
    }
}

public sealed class DeferredActivation
{
    private readonly object gate = new();
    private Action? target;
    private bool pending;

    public void Request()
    {
        Action? action;
        lock (gate) { action = target; if (action is null) pending = true; }
        action?.Invoke();
    }

    public void SetTarget(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        bool activate;
        lock (gate) { target = action; activate = pending; pending = false; }
        if (activate) action();
    }
}

internal sealed class WindowsSingleInstancePlatform : ISingleInstancePlatform
{
    private Mutex? mutex;

    public bool TryAcquire(string mutexName)
    {
        mutex = new Mutex(initiallyOwned: true, mutexName, out var createdNew);
        if (!createdNew) { mutex.Dispose(); mutex = null; }
        return createdNew;
    }

    public void Signal(string eventName)
    {
        try { using var signal = EventWaitHandle.OpenExisting(eventName); signal.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
    }

    public IDisposable Listen(string eventName, Action onSignal)
    {
        var signal = new EventWaitHandle(false, EventResetMode.AutoReset, eventName);
        var registration = ThreadPool.RegisterWaitForSingleObject(signal, (_, timedOut) => { if (!timedOut) onSignal(); }, null, Timeout.Infinite, executeOnlyOnce: false);
        return new Listener(signal, registration);
    }

    public void Release()
    {
        try { mutex?.ReleaseMutex(); }
        catch (ApplicationException) { }
    }

    public void Dispose() { mutex?.Dispose(); mutex = null; }

    private sealed class Listener(EventWaitHandle signal, RegisteredWaitHandle registration) : IDisposable
    {
        public void Dispose() { registration.Unregister(null); signal.Dispose(); }
    }
}
