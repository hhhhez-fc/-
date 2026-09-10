using LabelPrintHelper.Api;
using LabelPrintHelper.Configuration;
using LabelPrintHelper.Jobs;
using LabelPrintHelper.Lifecycle;
using LabelPrintHelper.Maintenance;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Security;
using LabelPrintHelper.Tray;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace LabelPrintHelper;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        LaunchRequest launch;
        try { launch = LaunchRequest.Parse(args); }
        catch (ArgumentException) { return 2; }

        ApplicationConfiguration.Initialize();
        var applicationData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LabelPrintHelper");
        var certificates = new LoopbackCertificateManager();
        using var instance = new SingleInstanceCoordinator();
        if (launch.Mode == LaunchMode.Shutdown)
        {
            instance.SignalShutdown();
            for (var attempt = 0; attempt < 100; attempt++)
            {
                if (instance.TryAcquire(signalExisting: false)) return 0;
                Thread.Sleep(100);
            }
            return 4;
        }
        if (launch.Mode == LaunchMode.MaintenanceCleanup)
        {
            if (!instance.TryAcquire(signalExisting: false)) return 3;
            new MaintenanceService(certificates, new ProductDataCleaner(applicationData)).CleanupAsync().GetAwaiter().GetResult();
            return 0;
        }

        TrayApplicationContext? tray = null;
        var activation = new DeferredActivation();
        var calibrationActivation = new DeferredActivation();
        var shutdownActivation = new DeferredActivation();
        if (!instance.TryAcquire(
            activation.Request,
            signalExisting: launch.Mode != LaunchMode.FocusCalibration,
            onShutdown: shutdownActivation.Request,
            onCalibration: calibrationActivation.Request))
        {
            if (launch.Mode == LaunchMode.FocusCalibration) instance.SignalCalibration();
            return 0;
        }
        using var certificate = certificates.EnsureTrustedCertificate();
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
            options.Limits.MaxRequestBodySize = RequestBodyLimits.MaxPrintJsonBytes;
            options.ListenLocalhost(17653, listener => listener.UseHttps(certificate));
        });

        builder.Services.AddSingleton(new OriginPolicy(builder.Environment.IsDevelopment()
            ? builder.Configuration["PrintHelper:DevelopmentOrigin"]
            : null));
        builder.Services.AddSingleton(new PairingStore(Path.Combine(applicationData, "pairing.json")));
        builder.Services.AddSingleton<IPairingApprovalPrompt, PairingApprovalPrompt>();
        builder.Services.AddSingleton<IPrintJobStore>(new FilePrintJobStore(Path.Combine(applicationData, "jobs")));
        builder.Services.AddSingleton<IPrinterCatalog, WindowsPrinterCatalog>();
        builder.Services.AddSingleton<IRawPrintSpooler, WindowsRawPrintSpooler>();
        var profileStore = new PrinterProfileStore(Path.Combine(applicationData, "profiles.json"));
        builder.Services.AddSingleton(profileStore);
        builder.Services.AddSingleton<IPrinterProfileStore>(profileStore);
        builder.Services.AddSingleton<IVerifiedPrinterProfileProvider>(profileStore);
        builder.Services.AddSingleton<CalibrationService>();
        builder.Services.AddSingleton<PrintJobService>();

        var app = builder.Build();
        app.UseMiddleware<OriginAuthorizationMiddleware>();
        app.MapPairingEndpoints();
        app.MapPrintEndpoints();
        app.MapCalibrationEndpoints();
        app.StartAsync().GetAwaiter().GetResult();
        try
        {
            tray = new TrayApplicationContext(app.Services.GetRequiredService<IPrinterCatalog>(), app.Services.GetRequiredService<CalibrationService>(), launch.Mode == LaunchMode.FocusDiagnostics);
            activation.SetTarget(tray.FocusDiagnostics);
            calibrationActivation.SetTarget(tray.FocusCalibration);
            shutdownActivation.SetTarget(tray.RequestExit);
            if (launch.Mode == LaunchMode.FocusCalibration) tray.FocusCalibration();
            Application.Run(tray);
        }
        finally
        {
            tray?.Dispose();
            using var shutdown = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            app.StopAsync(shutdown.Token).GetAwaiter().GetResult();
            app.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
        return 0;
    }
}
