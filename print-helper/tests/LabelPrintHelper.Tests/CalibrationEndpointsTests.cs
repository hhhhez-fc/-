using System.Text;
using System.Text.Json;
using LabelPrintHelper.Api;
using LabelPrintHelper.Configuration;
using LabelPrintHelper.Printing;
using Microsoft.AspNetCore.Http;

namespace LabelPrintHelper.Tests;

public sealed class CalibrationEndpointsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "label-calibration-api-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task StrictCalibrationJsonRejectsUnknownFieldsBeforeSpooling()
    {
        var (service, spooler) = Service();
        var context = Context("{\"action\":\"calibrate\",\"printerId\":\"printer-1\",\"printerName\":\"XP-420B\",\"mediaType\":\"gap\",\"mediaHeightMillimeters\":2,\"mediaOffsetMillimeters\":0,\"referenceX\":0,\"referenceY\":0,\"command\":\"PRINT 1,1\"}");

        await CalibrationEndpoints.CalibrateAsync(context, service);

        Assert.Equal(422, context.Response.StatusCode);
        Assert.Equal(0, spooler.Calls);
    }

    [Fact]
    public async Task CalibrationRejectsKnownFieldsFromAnotherActionBeforeSpooling()
    {
        var (service, spooler) = Service();
        var context = Context("{\"action\":\"calibrate\",\"printerId\":\"printer-1\",\"printerName\":\"XP-420B\",\"mediaType\":\"gap\",\"mediaHeightMillimeters\":2,\"mediaOffsetMillimeters\":0,\"referenceX\":0,\"referenceY\":0,\"testAccepted\":true}");

        await CalibrationEndpoints.CalibrateAsync(context, service);

        Assert.Equal(422, context.Response.StatusCode);
        Assert.Equal(0, spooler.Calls);
    }

    [Fact]
    public async Task CalibrationAndExplicitTestPrintAreSeparateActions()
    {
        var (service, spooler) = Service();
        var calibrate = Context("{\"action\":\"calibrate\",\"printerId\":\"printer-1\",\"printerName\":\"XP-420B\",\"mediaType\":\"continuous\",\"mediaHeightMillimeters\":0,\"mediaOffsetMillimeters\":0,\"referenceX\":0,\"referenceY\":0}");
        await CalibrationEndpoints.CalibrateAsync(calibrate, service);
        Assert.Equal(200, calibrate.Response.StatusCode);
        Assert.Equal(1, spooler.Calls);

        var test = Context("{\"action\":\"testPrint\",\"printerId\":\"printer-1\"}");
        await CalibrationEndpoints.CalibrateAsync(test, service);

        Assert.Equal(200, test.Response.StatusCode);
        Assert.Equal(2, spooler.Calls);
        Assert.Contains("\"isVerified\":false", ReadBody(test), StringComparison.Ordinal);
        var testJson = ReadBody(test);
        using var testDocument = System.Text.Json.JsonDocument.Parse(testJson);
        var attemptId = testDocument.RootElement.GetProperty("testAttemptId").GetString();
        var confirm = Context($"{{\"action\":\"confirmTestPrint\",\"printerId\":\"printer-1\",\"testAttemptId\":\"{attemptId}\",\"testAccepted\":true}}");
        await CalibrationEndpoints.CalibrateAsync(confirm, service);
        Assert.Equal(200, confirm.Response.StatusCode);
        Assert.Contains("\"isVerified\":true", ReadBody(confirm), StringComparison.Ordinal);
    }

    [Fact]
    public async Task StatusSerializesDateTimeOffsetAsTheWebsiteZeroOffsetFixture()
    {
        var (service, _) = Service();
        var calibrate = Context("{\"action\":\"calibrate\",\"printerId\":\"printer-1\",\"printerName\":\"XP-420B\",\"mediaType\":\"gap\",\"mediaHeightMillimeters\":2,\"mediaOffsetMillimeters\":0,\"referenceX\":0,\"referenceY\":0}");
        await CalibrationEndpoints.CalibrateAsync(calibrate, service);
        Assert.Equal(200, calibrate.Response.StatusCode);

        var status = new DefaultHttpContext();
        status.Request.QueryString = new QueryString("?printerId=printer-1");
        status.Response.Body = new MemoryStream();
        await CalibrationEndpoints.GetStatusAsync(status, service);

        Assert.Equal(200, status.Response.StatusCode);
        using var document = JsonDocument.Parse(ReadBody(status));
        var updatedAtUtc = document.RootElement.GetProperty("updatedAtUtc").GetString();
        Assert.NotNull(updatedAtUtc);
        Assert.EndsWith("+00:00", updatedAtUtc, StringComparison.Ordinal);
        Assert.Equal(TimeSpan.Zero, DateTimeOffset.Parse(updatedAtUtc).Offset);
    }

    private (CalibrationService Service, CountingSpooler Spooler) Service()
    {
        Directory.CreateDirectory(root);
        var spooler = new CountingSpooler();
        return (new CalibrationService(new PrinterProfileStore(Path.Combine(root, "profiles.json")), spooler, new Catalog()), spooler);
    }
    private static DefaultHttpContext Context(string body)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        context.Request.ContentType = "application/json";
        context.Response.Body = new MemoryStream();
        return context;
    }
    private static string ReadBody(DefaultHttpContext context) { context.Response.Body.Position = 0; return new StreamReader(context.Response.Body).ReadToEnd(); }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
    private sealed class Catalog : IPrinterCatalog { public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<PrinterDescriptor>>([new("printer-1", "XP-420B", true, true, "ready", true)]); }
    private sealed class CountingSpooler : IRawPrintSpooler
    {
        public int Calls;
        public Task<int> SubmitAsync(string printerName, ReadOnlyMemory<byte> document, string documentName, CancellationToken cancellationToken) => Task.FromResult(++Calls);
    }
}
