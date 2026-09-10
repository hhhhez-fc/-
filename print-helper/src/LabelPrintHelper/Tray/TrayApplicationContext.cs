using LabelPrintHelper.Printing;

namespace LabelPrintHelper.Tray;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon icon;
    private readonly DiagnosticsForm diagnostics;
    private readonly ToolStripMenuItem selectedPrinter;
    private readonly IUiDispatcher dispatcher;
    private readonly TrayUiController controller;
    private bool disposed;

    public TrayApplicationContext(IPrinterCatalog printers, CalibrationService calibration, bool showDiagnostics)
    {
        dispatcher = new WindowsFormsUiDispatcher();
        diagnostics = new DiagnosticsForm(printers, calibration);
        controller = new TrayUiController(dispatcher, diagnostics, ExitThread);
        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("状态：网站安全接口已连接") { Enabled = false });
        selectedPrinter = new ToolStripMenuItem("所选打印机：在诊断中选择") { Enabled = false };
        menu.Items.Add(selectedPrinter);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开诊断", null, (_, _) => controller.FocusDiagnostics());
        menu.Items.Add("纸张校准", null, (_, _) => controller.FocusCalibration());
        menu.Items.Add("测试打印", null, (_, _) => controller.FocusTestPrint());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => ExitThread());
        icon = new NotifyIcon
        {
            Text = "Label Print Helper",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true,
        };
        icon.DoubleClick += (_, _) => controller.FocusDiagnostics();
        diagnostics.SelectedPrinterChanged += (_, value) => selectedPrinter.Text = "所选打印机：" + value;
        if (showDiagnostics) controller.FocusDiagnostics();
    }

    public void FocusDiagnostics()
    {
        controller.FocusDiagnostics();
    }

    public void FocusCalibration()
    {
        controller.FocusCalibration();
    }

    public void RequestExit()
    {
        controller.RequestExit();
    }

    protected override void ExitThreadCore()
    {
        icon.Visible = false;
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            icon.Visible = false;
            icon.ContextMenuStrip?.Dispose();
            icon.Dispose();
            diagnostics.PrepareForExit();
            diagnostics.Dispose();
            dispatcher.Dispose();
        }
        base.Dispose(disposing);
    }
}
