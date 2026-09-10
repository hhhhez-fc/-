using System.Text.Json;
using LabelPrintHelper.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace LabelPrintHelper.Security;

public sealed class OriginPolicy
{
    public const string ProductionOrigin = "https://label-printing-workbench.pages.dev";
    private readonly HashSet<string> allowedOrigins = new(StringComparer.Ordinal);

    public OriginPolicy(string? developmentOrigin = null)
    {
        allowedOrigins.Add(ProductionOrigin);
        if (!string.IsNullOrWhiteSpace(developmentOrigin))
        {
            allowedOrigins.Add(NormalizeOrigin(developmentOrigin) ?? throw new ArgumentException("开发来源格式无效", nameof(developmentOrigin)));
        }
    }

    public bool TryAuthorize(string? origin, out string normalized)
    {
        normalized = NormalizeOrigin(origin) ?? string.Empty;
        return normalized.Length > 0 && allowedOrigins.Contains(normalized);
    }

    public static string? NormalizeOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin) || !Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo) ||
            uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return null;
        var builder = new UriBuilder(uri.Scheme.ToLowerInvariant(), uri.IdnHost.ToLowerInvariant(), uri.IsDefaultPort ? -1 : uri.Port);
        return builder.Uri.GetLeftPart(UriPartial.Authority);
    }
}

public sealed class OriginAuthorizationMiddleware(RequestDelegate next, OriginPolicy origins, PairingStore pairings)
{
    private static readonly HashSet<string> AllowedRequestHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization", "content-type", "x-label-print-protocol-version", "x-label-print-request-id",
    };

    public async Task InvokeAsync(HttpContext context)
    {
        var method = context.Request.Method;
        var path = context.Request.Path.Value ?? string.Empty;
        if (method != HttpMethods.Options) context.Response.Headers.CacheControl = "no-store";
        if (method == HttpMethods.Get && path == "/v1/health")
        {
            if (origins.TryAuthorize(context.Request.Headers.Origin, out var healthOrigin)) AddCorsHeaders(context, healthOrigin);
            await next(context);
            return;
        }

        if (!origins.TryAuthorize(context.Request.Headers.Origin, out var origin))
        {
            await RejectAsync(context, StatusCodes.Status403Forbidden, "originDenied", "网站来源未获授权");
            return;
        }

        if (!TryMatchRoute(path, method == HttpMethods.Options ? context.Request.Headers.AccessControlRequestMethod.ToString() : method, out var routeKind))
        {
            await RejectAsync(context, StatusCodes.Status404NotFound, "notFound", "本机打印接口不存在");
            return;
        }

        AddCorsHeaders(context, origin);
        if (method == HttpMethods.Options)
        {
            if (!TryValidatePreflightHeaders(context.Request.Headers.AccessControlRequestHeaders))
            {
                await RejectAsync(context, StatusCodes.Status403Forbidden, "corsDenied", "跨来源请求头未获授权");
                return;
            }
            context.Response.Headers.AccessControlAllowMethods = context.Request.Headers.AccessControlRequestMethod.ToString().ToUpperInvariant();
            context.Response.Headers.AccessControlAllowHeaders = "authorization, content-type, x-label-print-protocol-version, x-label-print-request-id";
            context.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }

        if (routeKind == RouteKind.PairingCreate)
        {
            await next(context);
            return;
        }

        var token = ExtractBearer(context.Request.Headers.Authorization);
        var authorized = routeKind == RouteKind.PairingStatus
            ? token is not null && TryGetPairingRequestId(path, out var pairingRequestId) && pairings.ValidatePollingCapability(origin, pairingRequestId, token)
            : token is not null && pairings.ValidateToken(origin, token);
        if (!authorized)
        {
            context.Response.Headers.WWWAuthenticate = "Bearer";
            await RejectAsync(context, StatusCodes.Status401Unauthorized, "unauthorized", "打印助手需要重新配对");
            return;
        }

        await next(context);
    }

    private static void AddCorsHeaders(HttpContext context, string origin)
    {
        context.Response.Headers.AccessControlAllowOrigin = origin;
        context.Response.Headers.Append("Vary", "Origin");
        context.Response.Headers.AccessControlMaxAge = "600";
    }

    private static string? ExtractBearer(StringValues authorization)
    {
        if (authorization.Count != 1) return null;
        const string prefix = "Bearer ";
        var value = authorization.ToString();
        if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
        var token = value[prefix.Length..];
        return token.Length > 0 && token.Trim() == token && !token.Any(char.IsWhiteSpace) ? token : null;
    }

    private static bool TryValidatePreflightHeaders(StringValues value)
    {
        if (StringValues.IsNullOrEmpty(value)) return true;
        return value.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .All(AllowedRequestHeaders.Contains);
    }

    private static bool TryMatchRoute(string path, string method, out RouteKind kind)
    {
        kind = RouteKind.Protected;
        if (method == HttpMethods.Get && path == "/v1/health") { kind = RouteKind.Health; return true; }
        if (method == HttpMethods.Post && path == "/v1/pairing-requests") { kind = RouteKind.PairingCreate; return true; }
        if (method == HttpMethods.Get && HasSegments(path, "/v1/pairing-requests/", 1)) { kind = RouteKind.PairingStatus; return true; }
        if (method == HttpMethods.Get && path == "/v1/printers") return true;
        if (method == HttpMethods.Post && path == "/v1/jobs") return true;
        if (method == HttpMethods.Get && HasSegments(path, "/v1/jobs/", 1)) return true;
        if (method == HttpMethods.Post && HasSegments(path, "/v1/jobs/", 2, "commit")) return true;
        if (method == HttpMethods.Put && HasAssetRoute(path)) return true;
        if (method == HttpMethods.Post && path == "/v1/calibration") return true;
        if (method == HttpMethods.Get && path == "/v1/calibration") return true;
        return false;
    }

    private static bool HasSegments(string path, string prefix, int count, string? requiredLast = null)
    {
        if (!path.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var segments = path[prefix.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length == count && segments.All(segment => segment is not ("." or "..")) &&
            (requiredLast is null || segments[^1] == requiredLast);
    }

    private static bool HasAssetRoute(string path)
    {
        const string prefix = "/v1/jobs/";
        if (!path.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var segments = path[prefix.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length == 3 && segments[1] == "assets" && segments[0] is not ("." or "..") && segments[2] is not ("." or "..");
    }

    private static bool TryGetPairingRequestId(string path, out string requestId)
    {
        const string prefix = "/v1/pairing-requests/";
        requestId = path.StartsWith(prefix, StringComparison.Ordinal) ? path[prefix.Length..] : string.Empty;
        return requestId.Length > 0 && !requestId.Contains('/');
    }

    private static async Task RejectAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(context.Response.Body, new PrintErrorResponse(code, message), PrintEndpoints.JsonOptions, context.RequestAborted);
    }

    private enum RouteKind { Protected, Health, PairingCreate, PairingStatus }
}
