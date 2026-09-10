namespace LabelPrintHelper.Tray;

internal interface IUiDispatcher : IDisposable
{
    void Post(Action action);
}

internal interface IDiagnosticsWindow : IDisposable
{
    event EventHandler<string>? SelectedPrinterChanged;
    void FocusDiagnostics();
    void FocusCalibration();
    void FocusTestPrint();
    void PrepareForExit();
}

internal sealed class WindowsFormsUiDispatcher : IUiDispatcher
{
    private readonly Control anchor;
    private bool disposed;

    public WindowsFormsUiDispatcher()
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA) throw new InvalidOperationException("托盘 UI 调度器必须在 STA 线程创建");
        anchor = new Control();
        _ = anchor.Handle;
    }

    public void Post(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (disposed) return;
        _ = anchor.BeginInvoke(action);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        anchor.Dispose();
    }
}

internal sealed class TrayUiController(IUiDispatcher dispatcher, IDiagnosticsWindow diagnostics, Action exit)
{
    public void FocusDiagnostics() => dispatcher.Post(diagnostics.FocusDiagnostics);
    public void FocusCalibration() => dispatcher.Post(diagnostics.FocusCalibration);
    public void FocusTestPrint() => dispatcher.Post(diagnostics.FocusTestPrint);
    public void RequestExit() => dispatcher.Post(exit);
}

internal sealed class DiagnosticsWindowLifecycle
{
    public bool IsExiting { get; private set; }
    public bool ShouldHide(CloseReason reason) => !IsExiting && reason == CloseReason.UserClosing;
    public void BeginExit() => IsExiting = true;
}
