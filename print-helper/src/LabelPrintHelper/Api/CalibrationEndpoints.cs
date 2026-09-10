using System.Text.Json;
using LabelPrintHelper.Printing;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace LabelPrintHelper.Api;

public sealed record CalibrationActionRequest(
    string? Action,
    string? PrinterId,
    string? PrinterName = null,
    string? MediaType = null,
    decimal? MediaHeightMillimeters = null,
    decimal? MediaOffsetMillimeters = null,
    int? ReferenceX = null,
    int? ReferenceY = null,
    bool? TestAccepted = null,
    string? TestAttemptId = null);

public static class CalibrationEndpoints
{
    public static IEndpointRouteBuilder MapCalibrationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/v1/calibration", GetStatusAsync);
        endpoints.MapPost("/v1/calibration", CalibrateAsync).Accepts<CalibrationActionRequest>("application/json");
        return endpoints;
    }

    public static async Task GetStatusAsync(HttpContext context, CalibrationService service)
    {
        try
        {
            var printerId = context.Request.Query["printerId"].ToString();
            if (string.IsNullOrWhiteSpace(printerId) || context.Request.Query.Count != 1) throw new ArgumentException("必须提供唯一的打印机标识");
            await WriteAsync(context, await service.GetStatusAsync(printerId, context.RequestAborted));
        }
        catch (ArgumentException exception) { await ErrorAsync(context, 422, exception.Message); }
        catch (InvalidDataException exception) { await ErrorAsync(context, 422, exception.Message); }
    }

    public static async Task CalibrateAsync(HttpContext context, CalibrationService service)
    {
        try
        {
            var json = await RequestBodyLimits.ReadJsonAsync(context, 4096);
            var request = JsonSerializer.Deserialize<CalibrationActionRequest>(json, PrintEndpoints.JsonOptions) ?? throw new ArgumentException("校准请求不能为空");
            object response = request.Action switch
            {
                "calibrate" when HasOnlyCalibrationFields(request) => await service.CalibrateAsync(ToCalibrationRequest(request), context.RequestAborted),
                "testPrint" when HasOnlyTestFields(request) => await service.PrintBorderTestAsync(Require(request.PrinterId, "打印机标识"), context.RequestAborted),
                "confirmTestPrint" when HasOnlyConfirmationFields(request) => await service.ConfirmBorderTestAsync(Require(request.PrinterId, "打印机标识"), Require(request.TestAttemptId, "测试尝试标识"), request.TestAccepted!.Value, context.RequestAborted),
                _ => throw new ArgumentException("校准操作或字段无效"),
            };
            await WriteAsync(context, response);
        }
        catch (RequestBodyTooLargeException) { context.Response.StatusCode = 413; await WriteAsync(context, new PrintErrorResponse("payloadTooLarge", "校准请求内容过大")); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or InvalidDataException or JsonException)
        {
            await ErrorAsync(context, 422, exception is JsonException ? "请求 JSON 格式无效" : exception.Message);
        }
        catch (RawPrintException exception) { await ErrorAsync(context, 503, exception.Message); }
    }

    private static CalibrationRequest ToCalibrationRequest(CalibrationActionRequest request)
    {
        var printerId = Require(request.PrinterId, "打印机标识");
        var printerName = Require(request.PrinterName, "打印机名称");
        var mediaType = Require(request.MediaType, "介质类型");
        if (request.MediaHeightMillimeters is null || request.MediaOffsetMillimeters is null || request.ReferenceX is null || request.ReferenceY is null) throw new ArgumentException("校准字段不完整");
        return new(printerId, printerName, mediaType, request.MediaHeightMillimeters.Value, request.MediaOffsetMillimeters.Value, request.ReferenceX.Value, request.ReferenceY.Value);
    }

    private static bool HasOnlyTestFields(CalibrationActionRequest request) => request.PrinterName is null && request.MediaType is null && request.MediaHeightMillimeters is null && request.MediaOffsetMillimeters is null && request.ReferenceX is null && request.ReferenceY is null && request.TestAccepted is null && request.TestAttemptId is null;
    private static bool HasOnlyConfirmationFields(CalibrationActionRequest request) => request.PrinterName is null && request.MediaType is null && request.MediaHeightMillimeters is null && request.MediaOffsetMillimeters is null && request.ReferenceX is null && request.ReferenceY is null && request.TestAccepted is not null && request.TestAttemptId is not null;
    private static bool HasOnlyCalibrationFields(CalibrationActionRequest request) => request.TestAccepted is null && request.TestAttemptId is null && request.PrinterId is not null && request.PrinterName is not null && request.MediaType is not null && request.MediaHeightMillimeters is not null && request.MediaOffsetMillimeters is not null && request.ReferenceX is not null && request.ReferenceY is not null;
    private static string Require(string? value, string name) => !string.IsNullOrWhiteSpace(value) ? value : throw new ArgumentException(name + "不能为空");
    private static Task ErrorAsync(HttpContext context, int status, string message) { context.Response.StatusCode = status; return WriteAsync(context, new PrintErrorResponse("validation", message)); }
    private static async Task WriteAsync<T>(HttpContext context, T value)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(context.Response.Body, value, PrintEndpoints.JsonOptions, context.RequestAborted);
    }
}
