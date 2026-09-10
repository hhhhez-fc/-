using System.Buffers;
using System.Text;
using System.Text.Json;
using LabelPrintHelper.Protocol;
using LabelPrintHelper.Security;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace LabelPrintHelper.Api;

public interface IPairingApprovalPrompt
{
    Task<bool> RequestApprovalAsync(string exactOrigin, CancellationToken cancellationToken = default);
}

public sealed record PairingRequestBody(string Origin);

public static class PairingEndpoints
{
    public const int MaxPairingBodyBytes = 4096;

    public static IEndpointRouteBuilder MapPairingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/v1/pairing-requests", CreateAsync).Accepts<PairingRequestBody>("application/json").Produces<PairingRequestStatus>();
        endpoints.MapGet("/v1/pairing-requests/{requestId}", StatusAsync).Produces<PairingRequestStatus>();
        return endpoints;
    }

    public static async Task CreateAsync(HttpContext context, PairingStore store, IPairingApprovalPrompt prompt)
    {
        try
        {
            using var document = JsonDocument.Parse(await RequestBodyLimits.ReadJsonAsync(context, MaxPairingBodyBytes));
            if (document.RootElement.ValueKind != JsonValueKind.Object || document.RootElement.EnumerateObject().Count() != 1 ||
                !document.RootElement.TryGetProperty("origin", out var originElement) || originElement.ValueKind != JsonValueKind.String)
            {
                throw new JsonException();
            }
            var bodyOrigin = OriginPolicy.NormalizeOrigin(originElement.GetString());
            var headerOrigin = OriginPolicy.NormalizeOrigin(context.Request.Headers.Origin);
            if (bodyOrigin is null || bodyOrigin != headerOrigin) throw new PairingStateException("配对来源与请求来源不一致");
            var request = store.CreateRequest(bodyOrigin, out var created);
            if (created) _ = ProcessApprovalAsync(store, prompt, request.RequestId, bodyOrigin);
            await WriteAsync(context, request);
        }
        catch (RequestBodyTooLargeException) { await ErrorAsync(context, 413, "payloadTooLarge", "配对请求内容过大"); }
        catch (PairingRateLimitException) { await ErrorAsync(context, 429, "rateLimited", "配对请求过于频繁，请稍后再试"); }
        catch (PairingStateException exception) { await ErrorAsync(context, 403, "originMismatch", exception.Message); }
        catch (Exception exception) when (exception is JsonException or ProtocolValidationException)
        {
            await ErrorAsync(context, 422, "validation", "配对请求 JSON 格式无效");
        }
    }

    public static async Task StatusAsync(HttpContext context, string requestId, PairingStore store)
    {
        try { await WriteAsync(context, store.GetRequestStatus(requestId)); }
        catch (PairingRequestNotFoundException) { await ErrorAsync(context, 404, "notFound", "配对请求不存在"); }
    }

    private static async Task ProcessApprovalAsync(PairingStore store, IPairingApprovalPrompt prompt, string requestId, string exactOrigin)
    {
        try
        {
            if (await prompt.RequestApprovalAsync(exactOrigin)) store.Approve(requestId);
            else store.Deny(requestId);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException and not StackOverflowException)
        {
            try { store.Deny(requestId); }
            catch (PairingStateException) { }
        }
    }

    private static Task ErrorAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        return WriteAsync(context, new PrintErrorResponse(code, message));
    }

    private static async Task WriteAsync<T>(HttpContext context, T value)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(context.Response.Body, value, PrintEndpoints.JsonOptions, context.RequestAborted);
    }
}

public sealed class RequestBodyTooLargeException : Exception;

public static class RequestBodyLimits
{
    public const int MaxPrintJsonBytes = 8 * 1024 * 1024;

    public static async Task<string> ReadJsonAsync(HttpContext context, int maxBytes = MaxPrintJsonBytes)
    {
        if (!context.Request.HasJsonContentType()) throw new ProtocolValidationException("请求必须使用 application/json");
        if (context.Request.ContentLength is > 0 && context.Request.ContentLength > maxBytes) throw new RequestBodyTooLargeException();

        var rented = ArrayPool<byte>.Shared.Rent(Math.Min(maxBytes + 1, 64 * 1024));
        try
        {
            using var output = new MemoryStream(Math.Min(maxBytes, 64 * 1024));
            while (true)
            {
                var remaining = maxBytes - checked((int)output.Length);
                var read = await context.Request.Body.ReadAsync(rented.AsMemory(0, Math.Min(rented.Length, remaining + 1)), context.RequestAborted);
                if (read == 0) break;
                if (read > remaining) throw new RequestBodyTooLargeException();
                output.Write(rented, 0, read);
            }
            return Encoding.UTF8.GetString(output.GetBuffer(), 0, checked((int)output.Length));
        }
        finally { ArrayPool<byte>.Shared.Return(rented, clearArray: true); }
    }
}
