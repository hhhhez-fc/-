using LabelPrintHelper.Api;

namespace LabelPrintHelper.Tray;

public sealed class PairingApprovalForm : Form
{
    public PairingApprovalForm(string exactOrigin)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(exactOrigin);
        Text = "网站打印配对";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(520, 220);
        AccessibleName = "网站打印配对确认";

        var title = new Label
        {
            AutoSize = true,
            Font = new Font((SystemFonts.MessageBoxFont ?? Control.DefaultFont).FontFamily, 13, FontStyle.Bold),
            Location = new Point(24, 22),
            Text = "允许此网站使用本机打印机？",
        };
        var explanation = new Label
        {
            AutoSize = false,
            Location = new Point(24, 62),
            Size = new Size(472, 42),
            Text = "仅在确认来源完全正确时允许。授权后，该网站可以向打印助手提交标签任务。",
        };
        var origin = new TextBox
        {
            Location = new Point(24, 112),
            Size = new Size(472, 28),
            ReadOnly = true,
            TabStop = true,
            Text = exactOrigin,
            AccessibleName = "申请配对的网站来源",
        };
        var deny = new Button { Text = "拒绝", DialogResult = DialogResult.Cancel, Location = new Point(326, 164), Size = new Size(80, 32) };
        var approve = new Button { Text = "允许", DialogResult = DialogResult.OK, Location = new Point(416, 164), Size = new Size(80, 32) };
        AcceptButton = approve;
        CancelButton = deny;
        Controls.AddRange([title, explanation, origin, deny, approve]);
    }
}

public sealed class PairingApprovalPrompt : IPairingApprovalPrompt
{
    public Task<bool> RequestApprovalAsync(string exactOrigin, CancellationToken cancellationToken = default)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                using var form = new PairingApprovalForm(exactOrigin);
                using var registration = cancellationToken.Register(() =>
                {
                    if (form.IsHandleCreated) form.BeginInvoke(form.Close);
                });
                completion.TrySetResult(!cancellationToken.IsCancellationRequested && form.ShowDialog() == DialogResult.OK);
            }
            catch (Exception exception) { completion.TrySetException(exception); }
        })
        {
            IsBackground = true,
            Name = "LabelPrintHelper pairing approval",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }
}
