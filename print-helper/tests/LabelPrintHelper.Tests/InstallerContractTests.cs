namespace LabelPrintHelper.Tests;

public sealed class InstallerContractTests
{
    [Fact]
    public void VersionedBuildUsesRepositoryMetadataAndProducesChecksum()
    {
        var versionPath = ProjectFile("version.json");
        Assert.True(File.Exists(versionPath), "print-helper/version.json must be the shared version source");
        var version = File.ReadAllText(versionPath);
        Assert.Contains("\"helperVersion\": \"0.1.0\"", version, StringComparison.Ordinal);
        Assert.Contains("\"protocolVersion\": 1", version, StringComparison.Ordinal);

        var installer = File.ReadAllText(ProjectFile("installer", "LabelPrintHelper.iss"));
        Assert.Contains("#ifndef MyAppVersion", installer, StringComparison.Ordinal);
        Assert.Contains("#error MyAppVersion must be supplied by build-installer.ps1", installer, StringComparison.Ordinal);
        Assert.DoesNotContain("#define MyAppVersion \"0.1.0\"", installer, StringComparison.Ordinal);

        var build = File.ReadAllText(ProjectFile("scripts", "build-installer.ps1"));
        Assert.Contains("[Parameter(Mandatory = $true)]", build, StringComparison.Ordinal);
        Assert.Contains("[string]$Version", build, StringComparison.Ordinal);
        Assert.Contains("[string]$OutputDirectory", build, StringComparison.Ordinal);
        Assert.Contains("-p:Version=$Version", build, StringComparison.Ordinal);
        Assert.Contains("/DMyAppVersion=$Version", build, StringComparison.Ordinal);
        Assert.Contains("Get-FileHash", build, StringComparison.Ordinal);
        Assert.Contains("LabelPrintHelper-Setup.exe.sha256", build, StringComparison.Ordinal);

        var project = File.ReadAllText(ProjectFile("src", "LabelPrintHelper", "LabelPrintHelper.csproj"));
        Assert.Contains("<AssemblyVersion>$(Version)</AssemblyVersion>", project, StringComparison.Ordinal);
        Assert.Contains("<FileVersion>$(Version)</FileVersion>", project, StringComparison.Ordinal);
        Assert.Contains("<InformationalVersion>$(Version)</InformationalVersion>", project, StringComparison.Ordinal);
    }

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
