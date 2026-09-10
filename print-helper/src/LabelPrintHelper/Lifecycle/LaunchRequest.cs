namespace LabelPrintHelper.Lifecycle;

public enum LaunchMode { Background, FocusDiagnostics, FocusCalibration, MaintenanceCleanup, Shutdown }

public sealed record LaunchRequest(LaunchMode Mode)
{
    public static LaunchRequest Parse(IReadOnlyList<string> arguments)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        if (arguments.Count == 0) return new(LaunchMode.Background);
        if (arguments.Count != 1) throw new ArgumentException("打印助手不接受多个启动参数", nameof(arguments));
        return arguments[0] switch
        {
            "labelprint://start" => new(LaunchMode.FocusDiagnostics),
            "labelprint://calibrate" => new(LaunchMode.FocusCalibration),
            "--maintenance-cleanup" => new(LaunchMode.MaintenanceCleanup),
            "--shutdown" => new(LaunchMode.Shutdown),
            _ => throw new ArgumentException("不支持的打印助手启动参数", nameof(arguments)),
        };
    }
}
