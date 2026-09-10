namespace LabelPrintHelper.Tests;

public sealed class InstallerContractTests
{
    [Fact]
    public void UninstallChecksScopedHelperExitCodesAndHasNoBroadProcessKill()
    {
        var script = File.ReadAllText(ProjectFile("installer", "LabelPrintHelper.iss"));

        Assert.DoesNotContain("[UninstallRun]", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("taskkill", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("InitializeUninstall", script, StringComparison.Ordinal);
        Assert.Contains("procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);", script, StringComparison.Ordinal);
        Assert.Contains("CurUninstallStep <> usUninstall", script, StringComparison.Ordinal);
        Assert.Contains("'--shutdown'", script, StringComparison.Ordinal);
        Assert.Contains("ShutdownCode <> 0", script, StringComparison.Ordinal);
        Assert.Contains("'--maintenance-cleanup'", script, StringComparison.Ordinal);
        Assert.Contains("CleanupCode <> 0", script, StringComparison.Ordinal);
        Assert.Contains("RaiseException", script, StringComparison.Ordinal);
        var shutdown = script.IndexOf("'--shutdown'", StringComparison.Ordinal);
        var shutdownGate = script.IndexOf("ShutdownCode <> 0", shutdown, StringComparison.Ordinal);
        var cleanup = script.IndexOf("'--maintenance-cleanup'", StringComparison.Ordinal);
        var cleanupGate = script.IndexOf("CleanupCode <> 0", cleanup, StringComparison.Ordinal);
        Assert.True(shutdown >= 0 && shutdown < shutdownGate && shutdownGate < cleanup && cleanup < cleanupGate);
    }

    private static string ProjectFile(params string[] segments)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var helper = Path.Combine(current.FullName, "print-helper");
            if (Directory.Exists(helper)) return Path.Combine([helper, .. segments]);
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("无法定位 print-helper");
    }
}
