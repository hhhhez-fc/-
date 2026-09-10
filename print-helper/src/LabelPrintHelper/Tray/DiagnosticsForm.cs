using LabelPrintHelper.Configuration;
using LabelPrintHelper.Printing;

namespace LabelPrintHelper.Tray;

public sealed class DiagnosticsForm : Form, IDiagnosticsWindow
{
    private readonly IPrinterCatalog printers;
    private readonly CalibrationService calibration;
    private readonly ComboBox printer = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 360 };
    private readonly ComboBox media = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160 };
    private readonly NumericUpDown mediaHeight = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 20, Value = 2, Width = 80 };
    private readonly NumericUpDown mediaOffset = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 20, Width = 80 };
    private readonly Label state = new() { AutoSize = true, Text = "正在读取打印机状态…" };
    private readonly Button calibrateButton = new() { Text = "执行纸张校准", AutoSize = true };
    private readonly Button testButton = new() { Text = "打印 100 × 75 mm 边框并验证", AutoSize = true };
    private IReadOnlyList<PrinterDescriptor> descriptors = [];
    private readonly DiagnosticsWindowLifecycle lifecycle = new();
    public event EventHandler<string>? SelectedPrinterChanged;

    public DiagnosticsForm(IPrinterCatalog printers, CalibrationService calibration)
    {
        this.printers = printers;
        this.calibration = calibration;
        Text = "Label Print Helper 诊断与校准";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(600, 410);
        Size = new Size(680, 460);
        media.Items.AddRange(["间隙纸", "黑标纸", "连续纸"]);
        media.SelectedIndex = 0;

        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(20), AutoScroll = true };
        panel.Controls.Add(new Label { AutoSize = true, Font = new Font(Font, FontStyle.Bold), Text = "本机打印助手已连接（HTTPS 127.0.0.1）" });
        panel.Controls.Add(state);
        panel.Controls.Add(new Label { AutoSize = true, Text = "打印机" });
        panel.Controls.Add(printer);
        panel.Controls.Add(new Label { AutoSize = true, Text = "介质类型" });
        panel.Controls.Add(media);
        var dimensions = new FlowLayoutPanel { AutoSize = true };
        dimensions.Controls.Add(new Label { AutoSize = true, Text = "间隙/黑标高度 mm" });
        dimensions.Controls.Add(mediaHeight);
        dimensions.Controls.Add(new Label { AutoSize = true, Text = "偏移 mm" });
        dimensions.Controls.Add(mediaOffset);
        panel.Controls.Add(dimensions);
        panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(610, 0), Text = "校准命令不会打印标签。完成后必须单独打印边框测试；XP-420B 传感器命令仍需实机验收。" });
        panel.Controls.Add(calibrateButton);
        panel.Controls.Add(testButton);
        Controls.Add(panel);
        calibrateButton.Click += async (_, _) => await CalibrateAsync();
        testButton.Click += async (_, _) => await TestAsync();
        media.SelectedIndexChanged += (_, _) => { var continuous = media.SelectedIndex == 2; mediaHeight.Enabled = !continuous; mediaOffset.Enabled = !continuous; };
        printer.SelectedIndexChanged += (_, _) => SelectedPrinterChanged?.Invoke(this, printer.SelectedIndex >= 0 ? printer.Items[printer.SelectedIndex]!.ToString()! : "未选择");
        Shown += async (_, _) => await RefreshAsync();
    }

    public void FocusDiagnostics() { if (!Visible) Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); BringToFront(); }
    public void FocusCalibration() { FocusDiagnostics(); calibrateButton.Focus(); }
    public void FocusTestPrint() { FocusDiagnostics(); testButton.Focus(); }
    public void PrepareForExit() => lifecycle.BeginExit();

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (lifecycle.ShouldHide(e.CloseReason))
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    private async Task RefreshAsync()
    {
        try
        {
            descriptors = (await printers.GetPrintersAsync()).Where(item => item.IsCompatible).ToArray();
            printer.Items.Clear();
            foreach (var item in descriptors) printer.Items.Add(item.DisplayName + " — " + item.QueueStatus);
            if (printer.Items.Count > 0) printer.SelectedIndex = Math.Max(0, descriptors.ToList().FindIndex(item => item.IsDefault));
            state.Text = descriptors.Count == 0 ? "未发现兼容的 XP-420B 打印队列" : $"发现 {descriptors.Count} 台兼容打印机";
        }
        catch (Exception exception) { state.Text = "读取打印机失败：" + exception.Message; }
    }

    private PrinterDescriptor SelectedPrinter() => printer.SelectedIndex >= 0 && printer.SelectedIndex < descriptors.Count ? descriptors[printer.SelectedIndex] : throw new InvalidOperationException("请先选择可用的 XP-420B 打印机");
    private async Task CalibrateAsync()
    {
        await RunAsync(async () =>
        {
            var selected = SelectedPrinter();
            var request = media.SelectedIndex switch
            {
                0 => CalibrationRequest.Gap(selected.Id, selected.DisplayName, mediaHeight.Value, mediaOffset.Value, 0, 0),
                1 => CalibrationRequest.BlackMark(selected.Id, selected.DisplayName, mediaHeight.Value, mediaOffset.Value, 0, 0),
                _ => CalibrationRequest.Continuous(selected.Id, selected.DisplayName, 0, 0),
            };
            await calibration.CalibrateAsync(request);
            state.Text = "校准命令已提交；配置尚未验证，请检查走纸后单独打印边框测试。";
        });
    }

    private async Task TestAsync()
    {
        if (MessageBox.Show(this, "将直接向所选打印机发送一张 100 × 75 mm 边框测试标签。确认继续？", "显式测试打印", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
        await RunAsync(async () =>
        {
            var selected = SelectedPrinter();
            var tested = await calibration.PrintBorderTestAsync(selected.Id);
            state.Text = "边框测试已提交，请确认实体边框完整且只占一张 100 × 75 mm 标签。";
            var accepted = MessageBox.Show(this, "实体边框是否完整，并且只打印在一张 100 × 75 mm 标签上？", "确认实体测试结果", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
            await calibration.ConfirmBorderTestAsync(selected.Id, tested.TestAttemptId!, accepted);
            state.Text = accepted ? "实体测试已由用户确认，配置已验证。" : "实体测试未通过，配置保持未验证。";
        });
    }

    private async Task RunAsync(Func<Task> action)
    {
        calibrateButton.Enabled = testButton.Enabled = false;
        try { await action(); }
        catch (Exception exception) { state.Text = "操作失败：" + exception.Message; }
        finally { calibrateButton.Enabled = testButton.Enabled = true; }
    }
}
