using System.Text;
using System.Text.Json;
using LabelPrintHelper.Api;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace LabelPrintHelper.Tests;

public sealed class PrintEndpointsTests
{
    [Fact]
    public async Task MapsAllSixRoutesWithoutStartingListener()
    {
        using var fixture = new JobFixture();
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddSingleton(fixture.Service);
        builder.Services.AddSingleton<LabelPrintHelper.Printing.IPrinterCatalog>(fixture.Catalog);
        await using var app = builder.Build();
        app.MapPrintEndpoints();
        var routes = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints).OfType<RouteEndpoint>().ToArray();
        Assert.Equal(6, routes.Length);
        Assert.Contains(routes, route => route.RoutePattern.RawText == "/v1/jobs/{jobId}/commit");
    }

    [Fact]
    public async Task EndpointReturnsJsonAndMapsValidationConflictAndMissing()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        var valid = JsonSerializer.Serialize(manifest, PrintEndpoints.JsonOptions);
        var created = await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), valid);
        Assert.Equal(200, created.Response.StatusCode);
        Assert.StartsWith("application/json", created.Response.ContentType);
        var duplicate = await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), valid);
        Assert.Equal(200, duplicate.Response.StatusCode);
        var changed = await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), valid.Replace("\"websiteVersion\":\"1\"", "\"websiteVersion\":\"2\"", StringComparison.Ordinal));
        Assert.Equal(409, changed.Response.StatusCode);
        Assert.Equal(422, (await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), "{}")).Response.StatusCode);
        Assert.Equal(404, (await Invoke(context => PrintEndpoints.GetJobAsync(context, "absent", fixture.Service))).Response.StatusCode);
        Assert.Equal(422, (await Invoke(context => PrintEndpoints.UploadAssetAsync(context, "job-1", "asset-1", fixture.Service), "{}")).Response.StatusCode);
    }

    [Fact]
    public async Task EndpointRoundTripExposesOnlyQueueSubmissionOutcome()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        var health = await Invoke(PrintEndpoints.HealthAsync);
        Assert.Contains("\"protocolVersion\":1", Body(health));
        var printers = await Invoke(context => PrintEndpoints.PrintersAsync(context, fixture.Catalog));
        Assert.Contains("\"isCompatible\":true", Body(printers));
        await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), JsonSerializer.Serialize(manifest, PrintEndpoints.JsonOptions));
        var upload = await Invoke(context => PrintEndpoints.UploadAssetAsync(context, "job-1", "asset-1", fixture.Service), JsonSerializer.Serialize(manifest.Assets![0], PrintEndpoints.JsonOptions));
        Assert.Equal(200, upload.Response.StatusCode);
        var commit = await Invoke(context => PrintEndpoints.CommitJobAsync(context, "job-1", fixture.Service));
        Assert.Contains("\"status\":\"submitted\"", Body(commit));
        Assert.Contains("\"windowsJobId\":1", Body(commit));
        Assert.DoesNotContain("pngBase64", Body(commit));
        Assert.DoesNotContain("manifest\":", Body(commit));
        Assert.Equal(1, fixture.Spooler.Calls);
    }
    private static string Body(DefaultHttpContext context) => Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray());
    [Fact]
    public async Task UploadRejectsNumericStrings()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        await fixture.Service.CreateAsync(manifest);
        var json = JsonSerializer.Serialize(manifest.Assets![0], PrintEndpoints.JsonOptions).Replace("\"widthDots\":800", "\"widthDots\":\"800\"", StringComparison.Ordinal);
        var response = await Invoke(context => PrintEndpoints.UploadAssetAsync(context, "job-1", "asset-1", fixture.Service), json);
        Assert.Equal(422, response.Response.StatusCode);
        Assert.Empty(Directory.GetFiles(fixture.Root, "*.png", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ReorderedJsonPropertiesHaveIdenticalManifestIdentity()
    {
        using var fixture = new JobFixture();
        var manifest = fixture.Manifest();
        var json = JsonSerializer.Serialize(manifest, PrintEndpoints.JsonOptions);
        using var document = JsonDocument.Parse(json);
        var reordered = "{" + string.Join(",", document.RootElement.EnumerateObject().Reverse().Select(property => JsonSerializer.Serialize(property.Name) + ":" + property.Value.GetRawText())) + "}";
        var first = await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), json);
        var retry = await Invoke(context => PrintEndpoints.CreateJobAsync(context, fixture.Service), reordered);
        Assert.Equal(200, retry.Response.StatusCode);
        Assert.Equal(Body(first), Body(retry));
    }
    private static async Task<DefaultHttpContext> Invoke(Func<HttpContext, Task> action, string? body = null)
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        context.Request.ContentType = "application/json";
        if (body is not null) context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        await action(context);
        return context;
    }
}
