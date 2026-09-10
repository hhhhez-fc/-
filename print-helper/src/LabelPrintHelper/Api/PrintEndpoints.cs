using System.Text.Json;
using System.Text.Json.Serialization;
using LabelPrintHelper.Jobs;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace LabelPrintHelper.Api;

public sealed record HelperHealthResponse(int ProtocolVersion, string HelperVersion, string Status);
public sealed record PrinterListResponse(IReadOnlyList<PrinterDescriptor> Printers);
public sealed record PrintErrorResponse(string Code, string Message);

public static class PrintEndpoints
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = false,
        NumberHandling = JsonNumberHandling.Strict,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
    public static IEndpointRouteBuilder MapPrintEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/v1/health", (Delegate)HealthAsync).Produces<HelperHealthResponse>();
        endpoints.MapGet("/v1/printers", PrintersAsync).Produces<PrinterListResponse>();
        endpoints.MapPost("/v1/jobs", CreateJobAsync).Accepts<PrintJobManifest>("application/json").Produces<PrintJobStatus>();
        endpoints.MapPut("/v1/jobs/{jobId}/assets/{assetId}", UploadAssetAsync).Accepts<PrintAssetUpload>("application/json").Produces<PrintJobStatus>();
        endpoints.MapPost("/v1/jobs/{jobId}/commit", CommitJobAsync).Produces<PrintJobStatus>();
        endpoints.MapGet("/v1/jobs/{jobId}", GetJobAsync).Produces<PrintJobStatus>();
        return endpoints;
    }
    public static Task HealthAsync(HttpContext context) => WriteAsync(context, new HelperHealthResponse(1, "0.1.0", "ready"));
    public static Task PrintersAsync(HttpContext context, IPrinterCatalog catalog) => ExecuteAsync(context, async () => new PrinterListResponse(await catalog.GetPrintersAsync(context.RequestAborted)));
    public static Task CreateJobAsync(HttpContext context, PrintJobService service) => ExecuteAsync(context, async () =>
    {
        var manifest = ProtocolValidator.DeserializeAndValidateManifest(await ReadJsonAsync(context));
        return await service.CreateAsync(manifest, context.RequestAborted);
    });
    public static Task UploadAssetAsync(HttpContext context, string jobId, string assetId, PrintJobService service) => ExecuteAsync(context, async () =>
    {
        var json = await ReadJsonAsync(context);
        using var document = JsonDocument.Parse(json);
        string[] fields = ["assetId", "labelId", "widthDots", "heightDots", "rotation", "pngBase64", "sha256"];
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new ProtocolValidationException("打印资产 JSON 格式无效");
        var names = document.RootElement.EnumerateObject().Select(property => property.Name).ToArray();
        if (names.Length != fields.Length || names.Distinct(StringComparer.Ordinal).Count() != fields.Length || fields.Any(field => !names.Contains(field, StringComparer.Ordinal))) throw new ProtocolValidationException("打印资产缺少字段或包含不支持的字段");
        var upload = JsonSerializer.Deserialize<PrintAssetUpload>(json, JsonOptions) ?? throw new ProtocolValidationException("打印资产不能为空");
        return await service.UploadAsync(jobId, assetId, upload, context.RequestAborted);
    });
    public static Task CommitJobAsync(HttpContext context, string jobId, PrintJobService service) => ExecuteAsync(context, () => service.CommitAsync(jobId, context.RequestAborted));
    public static Task GetJobAsync(HttpContext context, string jobId, PrintJobService service) => ExecuteAsync(context, () => service.GetAsync(jobId, context.RequestAborted));
    private static Task<string> ReadJsonAsync(HttpContext context) => RequestBodyLimits.ReadJsonAsync(context);
    private static async Task ExecuteAsync<T>(HttpContext context, Func<Task<T>> action)
    {
        try { await WriteAsync(context, await action()); }
        catch (PrintJobConflictException exception) { await ErrorAsync(context, 409, "conflict", exception.Message); }
        catch (PrintJobNotFoundException exception) { await ErrorAsync(context, 404, "notFound", exception.Message); }
        catch (ProtocolValidationException exception) { await ErrorAsync(context, 422, "validation", exception.Message); }
        catch (RequestBodyTooLargeException) { await ErrorAsync(context, 413, "payloadTooLarge", "打印请求内容过大"); }
        catch (JsonException) { await ErrorAsync(context, 422, "validation", "请求 JSON 格式无效"); }
        catch (IOException) { await ErrorAsync(context, 503, "unavailable", "打印任务存储暂不可用，请查询原任务状态"); }
    }
    private static Task ErrorAsync(HttpContext context, int code, string name, string message)
    {
        context.Response.StatusCode = code;
        return WriteAsync(context, new PrintErrorResponse(name, message));
    }
    private static async Task WriteAsync<T>(HttpContext context, T response)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(context.Response.Body, response, JsonOptions, context.RequestAborted);
    }
}
