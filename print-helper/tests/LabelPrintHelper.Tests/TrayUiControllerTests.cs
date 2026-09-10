using LabelPrintHelper.Tray;
using System.Windows.Forms;

namespace LabelPrintHelper.Tests;

public sealed class TrayUiControllerTests
{
    [Fact]
    public void BackgroundActivationAndShutdownAlwaysMarshalThroughUiDispatcher()
    {
        var dispatcher = new QueuedDispatcher();
        var diagnostics = new FakeDiagnosticsWindow();
        var exits = 0;
        var controller = new TrayUiController(dispatcher, diagnostics, () => exits++);

        controller.FocusDiagnostics();
        controller.RequestExit();

        Assert.Equal(2, dispatcher.PendingCount);
        Assert.Equal(0, diagnostics.FocusCalls);
        Assert.Equal(0, exits);
        dispatcher.Drain();
        Assert.Equal(1, diagnostics.FocusCalls);
        Assert.Equal(1, exits);
    }

    [Fact]
    public void UserCloseHidesReusableDiagnosticsButApplicationExitAllowsDisposal()
    {
        var dispatcher = new QueuedDispatcher();
        var diagnostics = new FakeDiagnosticsWindow();
        var controller = new TrayUiController(dispatcher, diagnostics, () => { });
        diagnostics.UserClose();
        Assert.False(diagnostics.Visible);
        Assert.False(diagnostics.Disposed);

        controller.FocusDiagnostics();
        dispatcher.Drain();
        Assert.True(diagnostics.Visible);
        Assert.False(diagnostics.Disposed);

        diagnostics.PrepareForExit();
        diagnostics.UserClose();

        Assert.True(diagnostics.Disposed);
    }

    private sealed class QueuedDispatcher : IUiDispatcher
    {
        private readonly Queue<Action> actions = new();
        public int PendingCount => actions.Count;
        public void Post(Action action) => actions.Enqueue(action);
        public void Drain() { while (actions.TryDequeue(out var action)) action(); }
        public void Dispose() { }
    }
    private sealed class FakeDiagnosticsWindow : IDiagnosticsWindow
    {
        public int FocusCalls { get; private set; }
        public bool Visible { get; private set; } = true;
        public bool Disposed { get; private set; }
        private readonly DiagnosticsWindowLifecycle lifecycle = new();
        public event EventHandler<string>? SelectedPrinterChanged { add { } remove { } }
        public void FocusDiagnostics() { FocusCalls++; Visible = true; }
        public void FocusCalibration() { }
        public void FocusTestPrint() { }
        public void PrepareForExit() => lifecycle.BeginExit();
        public void UserClose() { if (lifecycle.ShouldHide(CloseReason.UserClosing)) Visible = false; else Dispose(); }
        public void Dispose() { Disposed = true; Visible = false; }
    }
}
