using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using LabelPrintHelper.Api;
using LabelPrintHelper.Security;
using Microsoft.AspNetCore.Http;

namespace LabelPrintHelper.Tests;

public sealed class SecurityTests : IDisposable
{
    private const string ProductionOrigin = "https://label-printing-workbench.pages.dev";
    private readonly string root = Path.Combine(Path.GetTempPath(), "label-security-tests-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData("https://label-printing-workbench.pages.dev")]
    [InlineData("HTTPS://LABEL-PRINTING-WORKBENCH.PAGES.DEV:443")]
    public void ExactOriginPolicyAcceptsOnlyNormalizedProductionOrigin(string origin)
    {
        var policy = new OriginPolicy();

        Assert.True(policy.TryAuthorize(origin, out var normalized));
        Assert.Equal(ProductionOrigin, normalized);
    }

    [Theory]
    [InlineData("https://evil-label-printing-workbench.pages.dev")]
    [InlineData("https://label-printing-workbench.pages.dev.evil.example")]
    [InlineData("https://label-printing-workbench.pages.dev@evil.example")]
    [InlineData("https://label-printing-workbench.pages.dev/path")]
    [InlineData("null")]
    public void ExactOriginPolicyRejectsLookalikesSubdomainsAndNonOrigins(string origin)
    {
        Assert.False(new OriginPolicy().TryAuthorize(origin, out _));
    }

    [Fact]
    public void DevelopmentOriginMustBeExplicitAndExact()
    {
        var policy = new OriginPolicy("http://localhost:5173");

        Assert.True(policy.TryAuthorize("http://LOCALHOST:5173", out var normalized));
        Assert.Equal("http://localhost:5173", normalized);
        Assert.False(policy.TryAuthorize("http://localhost:5174", out _));
        Assert.False(policy.TryAuthorize("http://sub.localhost:5173", out _));
    }

    [Fact]
    public async Task MissingOriginIsRejectedOutsideHealth()
    {
        using var fixture = CreatePairingFixture();
        var middleware = new OriginAuthorizationMiddleware(_ => throw new InvalidOperationException("must not run"), new OriginPolicy(), fixture.Store);
        var protectedContext = Context("GET", "/v1/printers");

        await middleware.InvokeAsync(protectedContext);

        Assert.Equal(StatusCodes.Status403Forbidden, protectedContext.Response.StatusCode);

        var called = false;
        var health = new OriginAuthorizationMiddleware(_ => { called = true; return Task.CompletedTask; }, new OriginPolicy(), fixture.Store);
        var healthContext = Context("GET", "/v1/health");
        await health.InvokeAsync(healthContext);
        Assert.True(called);
    }

    [Fact]
    public async Task HealthAddsCorsOnlyForAnExactAllowedOrigin()
    {
        using var fixture = CreatePairingFixture();
        var middleware = new OriginAuthorizationMiddleware(_ => Task.CompletedTask, new OriginPolicy(), fixture.Store);
        var allowed = Context("GET", "/v1/health", ProductionOrigin);
        var denied = Context("GET", "/v1/health", "https://label-printing-workbench.pages.dev.evil.example");

        await middleware.InvokeAsync(allowed);
        await middleware.InvokeAsync(denied);

        Assert.Equal(ProductionOrigin, allowed.Response.Headers.AccessControlAllowOrigin);
        Assert.False(denied.Response.Headers.ContainsKey("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task ProtectedEndpointRequiresValidSameOriginBearerToken()
    {
        using var fixture = CreatePairingFixture();
        var token = ApproveAndClaim(fixture.Store, ProductionOrigin);
        var calls = 0;
        var middleware = new OriginAuthorizationMiddleware(_ => { calls++; return Task.CompletedTask; }, new OriginPolicy(), fixture.Store);

        var accepted = Context("GET", "/v1/printers", ProductionOrigin, token);
        await middleware.InvokeAsync(accepted);
        Assert.Equal(1, calls);
        Assert.Equal(ProductionOrigin, accepted.Response.Headers.AccessControlAllowOrigin);

        var invalid = Context("GET", "/v1/printers", ProductionOrigin, "wrong-token");
        await middleware.InvokeAsync(invalid);
        Assert.Equal(StatusCodes.Status401Unauthorized, invalid.Response.StatusCode);

        var wrongOrigin = Context("GET", "/v1/printers", "https://evil.example", token);
        await middleware.InvokeAsync(wrongOrigin);
        Assert.Equal(StatusCodes.Status403Forbidden, wrongOrigin.Response.StatusCode);
        Assert.False(wrongOrigin.Response.Headers.ContainsKey("Access-Control-Allow-Origin"));

        fixture.Time.Advance(TimeSpan.FromHours(2));
        var expired = Context("GET", "/v1/printers", ProductionOrigin, token);
        await middleware.InvokeAsync(expired);
        Assert.Equal(StatusCodes.Status401Unauthorized, expired.Response.StatusCode);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task PairingStatusRequiresItsOpaqueRequestCapabilityBoundToTheOrigin()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);
        var calls = 0;
        var middleware = new OriginAuthorizationMiddleware(_ => { calls++; return Task.CompletedTask; }, new OriginPolicy(), fixture.Store);

        var missing = Context("GET", "/v1/pairing-requests/" + request.RequestId, ProductionOrigin);
        await middleware.InvokeAsync(missing);
        Assert.Equal(StatusCodes.Status401Unauthorized, missing.Response.StatusCode);

        var wrong = Context("GET", "/v1/pairing-requests/" + request.RequestId, ProductionOrigin, "another-request");
        await middleware.InvokeAsync(wrong);
        Assert.Equal(StatusCodes.Status401Unauthorized, wrong.Response.StatusCode);

        await middleware.InvokeAsync(Context("GET", "/v1/pairing-requests/" + request.RequestId, ProductionOrigin, request.RequestId));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task ApprovedPairingTokenResponseCannotBeStoredByHttpCaches()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Approve(request.RequestId);
        var middleware = new OriginAuthorizationMiddleware(
            context => PairingEndpoints.StatusAsync(context, request.RequestId, fixture.Store),
            new OriginPolicy(),
            fixture.Store);
        var context = Context("GET", "/v1/pairing-requests/" + request.RequestId, ProductionOrigin, request.RequestId);

        await middleware.InvokeAsync(context);

        Assert.Equal("no-store", context.Response.Headers.CacheControl);
        Assert.Contains("\"token\":", Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray()));
    }

    [Fact]
    public async Task ArbitraryJsonPathIsRejectedBeforeItsBodyCanReachApplicationCode()
    {
        using var fixture = CreatePairingFixture();
        var token = ApproveAndClaim(fixture.Store, ProductionOrigin);
        var called = false;
        var middleware = new OriginAuthorizationMiddleware(_ => { called = true; return Task.CompletedTask; }, new OriginPolicy(), fixture.Store);
        var context = Context("POST", "/v1/jobs/job-1/run-anything", ProductionOrigin, token);
        context.Request.ContentType = "application/json";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{\"command\":\"calc\"}"));

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status404NotFound, context.Response.StatusCode);
        Assert.False(called);
    }

    [Theory]
    [InlineData("GET", "/v1/printers")]
    [InlineData("POST", "/v1/jobs")]
    [InlineData("PUT", "/v1/jobs/job-1/assets/asset-1")]
    [InlineData("POST", "/v1/jobs/job-1/commit")]
    [InlineData("GET", "/v1/jobs/job-1")]
    [InlineData("POST", "/v1/calibration")]
    [InlineData("GET", "/v1/calibration")]
    public async Task EveryPrinterAssetJobStatusAndCalibrationRouteUsesTheProtectedPipeline(string method, string path)
    {
        using var fixture = CreatePairingFixture();
        var token = ApproveAndClaim(fixture.Store, ProductionOrigin);
        var called = false;
        var middleware = new OriginAuthorizationMiddleware(_ => { called = true; return Task.CompletedTask; }, new OriginPolicy(), fixture.Store);

        await middleware.InvokeAsync(Context(method, path, ProductionOrigin, token));

        Assert.True(called);
    }

    [Fact]
    public async Task AllowedPreflightReturnsOnlyExactCorsOrigin()
    {
        using var fixture = CreatePairingFixture();
        var middleware = new OriginAuthorizationMiddleware(_ => throw new InvalidOperationException("preflight must terminate"), new OriginPolicy(), fixture.Store);
        var context = Context("OPTIONS", "/v1/jobs", ProductionOrigin);
        context.Request.Headers.AccessControlRequestMethod = "POST";
        context.Request.Headers.AccessControlRequestHeaders = "authorization, content-type";

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status204NoContent, context.Response.StatusCode);
        Assert.Equal(ProductionOrigin, context.Response.Headers.AccessControlAllowOrigin);
        Assert.DoesNotContain("*", context.Response.Headers.SelectMany(header => header.Value));
    }

    [Fact]
    public async Task HealthPreflightAllowsTheClientsActualVersionAndRequestHeaders()
    {
        using var fixture = CreatePairingFixture();
        var middleware = new OriginAuthorizationMiddleware(_ => throw new InvalidOperationException("preflight must terminate"), new OriginPolicy(), fixture.Store);
        var context = Context("OPTIONS", "/v1/health", ProductionOrigin);
        context.Request.Headers.AccessControlRequestMethod = "GET";
        context.Request.Headers.AccessControlRequestHeaders = "x-label-print-protocol-version, x-label-print-request-id";

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status204NoContent, context.Response.StatusCode);
        Assert.Equal("GET", context.Response.Headers.AccessControlAllowMethods);
        Assert.Contains("x-label-print-protocol-version", context.Response.Headers.AccessControlAllowHeaders.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("x-label-print-request-id", context.Response.Headers.AccessControlAllowHeaders.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void PairingApprovalReturnsCryptographicTokenExactlyOnceAndPersistsNoPlaintext()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);

        fixture.Store.Approve(request.RequestId);
        var first = fixture.Store.GetRequestStatus(request.RequestId);
        var second = fixture.Store.GetRequestStatus(request.RequestId);

        Assert.Equal("approved", first.Status);
        Assert.NotNull(first.Token);
        Assert.True(Convert.FromBase64String(first.Token.Replace('-', '+').Replace('_', '/') + new string('=', (4 - first.Token.Length % 4) % 4)).Length >= 32);
        Assert.Equal("claimed", second.Status);
        Assert.Null(second.Token);
        var persisted = File.ReadAllText(fixture.Path);
        Assert.DoesNotContain(first.Token, persisted, StringComparison.Ordinal);
        Assert.DoesNotContain(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(first.Token))), persisted, StringComparison.OrdinalIgnoreCase);
        Assert.True(fixture.Store.ValidateToken(ProductionOrigin, first.Token));
        Assert.False(fixture.Store.ValidateToken("https://other.example", first.Token));
    }

    [Fact]
    public async Task ConcurrentApprovalPollingCanExposeOnlyOnePlaintextToken()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Approve(request.RequestId);

        var results = await Task.WhenAll(Enumerable.Range(0, 12)
            .Select(_ => Task.Run(() => fixture.Store.GetRequestStatus(request.RequestId))));

        Assert.Single(results, result => result.Token is not null);
        Assert.Single(results, result => result.Status == "approved");
        Assert.Equal(11, results.Count(result => result.Status == "claimed"));
    }

    [Fact]
    public void ApprovedTokenRemainsUsableAfterStoreRestart()
    {
        var path = Path.Combine(root, "restart.json");
        Directory.CreateDirectory(root);
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 9, 8, 0, 0, 0, TimeSpan.Zero));
        string token;
        using (var store = new PairingStore(path, new PassthroughProtector(), time))
        {
            token = ApproveAndClaim(store, ProductionOrigin);
        }

        using var restarted = new PairingStore(path, new PassthroughProtector(), time);

        Assert.True(restarted.ValidateToken(ProductionOrigin, token));
    }

    [Fact]
    public void ProductionSecretProtectorUsesCurrentUserDpapi()
    {
        var plaintext = Encoding.UTF8.GetBytes("not-a-real-token-hash");
        var protector = new DpapiPairingSecretProtector();

        var protectedData = protector.Protect(plaintext);

        Assert.NotEqual(plaintext, protectedData);
        Assert.Equal(plaintext, protector.Unprotect(protectedData));
    }

    [Fact]
    public void PairingDenialAndExpiryAreStable()
    {
        using var fixture = CreatePairingFixture();
        var denied = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Deny(denied.RequestId);
        Assert.Equal("denied", fixture.Store.GetRequestStatus(denied.RequestId).Status);
        Assert.Equal("denied", fixture.Store.GetRequestStatus(denied.RequestId).Status);

        var expiring = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Time.Advance(TimeSpan.FromMinutes(3));
        Assert.Equal("expired", fixture.Store.GetRequestStatus(expiring.RequestId).Status);
        Assert.Equal("expired", fixture.Store.GetRequestStatus(expiring.RequestId).Status);
    }

    [Fact]
    public void ApprovedRequestCannotIssueATokenAfterItsRequestLifetime()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Approve(request.RequestId);

        fixture.Time.Advance(TimeSpan.FromMinutes(3));
        var status = fixture.Store.GetRequestStatus(request.RequestId);

        Assert.Equal("expired", status.Status);
        Assert.Null(status.Token);
    }

    [Fact]
    public void PollingCapabilityExpiresAfterTheTerminalStatusRetentionWindow()
    {
        using var fixture = CreatePairingFixture();
        var request = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Time.Advance(TimeSpan.FromMinutes(3));

        Assert.True(fixture.Store.ValidatePollingCapability(ProductionOrigin, request.RequestId, request.RequestId));
        Assert.Equal("expired", fixture.Store.GetRequestStatus(request.RequestId).Status);

        fixture.Time.Advance(TimeSpan.FromMinutes(10));
        Assert.False(fixture.Store.ValidatePollingCapability(ProductionOrigin, request.RequestId, request.RequestId));
    }

    [Fact]
    public void PairingAttemptsAreRateLimitedPerOrigin()
    {
        using var fixture = CreatePairingFixture(maxAttempts: 2);
        var first = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Deny(first.RequestId);
        var second = fixture.Store.CreateRequest(ProductionOrigin);
        fixture.Store.Deny(second.RequestId);

        Assert.Throws<PairingRateLimitException>(() => fixture.Store.CreateRequest(ProductionOrigin));

        fixture.Time.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal("pending", fixture.Store.CreateRequest(ProductionOrigin).Status);
    }

    [Fact]
    public void ConcurrentPairingCreationForTheSameOriginReusesOneLiveRequest()
    {
        using var fixture = CreatePairingFixture();

        var requests = Enumerable.Range(0, 12)
            .AsParallel()
            .Select(_ => fixture.Store.CreateRequest(ProductionOrigin))
            .ToArray();

        Assert.Single(requests.Select(request => request.RequestId).Distinct(StringComparer.Ordinal));
        fixture.Store.Approve(requests[0].RequestId);
        Assert.NotNull(fixture.Store.GetRequestStatus(requests[0].RequestId).Token);
        Assert.Equal("claimed", fixture.Store.GetRequestStatus(requests[0].RequestId).Status);
    }

    [Fact]
    public async Task PairingEndpointShowsTheExactHttpOriginAndRejectsBodyMismatch()
    {
        using var fixture = CreatePairingFixture();
        var prompt = new CapturingPrompt();
        var accepted = Context("POST", "/v1/pairing-requests", ProductionOrigin);
        accepted.Request.ContentType = "application/json";
        accepted.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{\"origin\":\"https://label-printing-workbench.pages.dev\"}"));

        await PairingEndpoints.CreateAsync(accepted, fixture.Store, prompt);

        Assert.Equal(ProductionOrigin, prompt.Origin);
        Assert.Contains("\"status\":\"pending\"", Encoding.UTF8.GetString(((MemoryStream)accepted.Response.Body).ToArray()));

        var rejectedPrompt = new CapturingPrompt();
        var rejected = Context("POST", "/v1/pairing-requests", ProductionOrigin);
        rejected.Request.ContentType = "application/json";
        rejected.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{\"origin\":\"https://other.example\"}"));
        await PairingEndpoints.CreateAsync(rejected, fixture.Store, rejectedPrompt);
        Assert.Equal(StatusCodes.Status403Forbidden, rejected.Response.StatusCode);
        Assert.Null(rejectedPrompt.Origin);
    }

    [Fact]
    public async Task ReusedPairingRequestDoesNotLaunchASecondApprovalPrompt()
    {
        using var fixture = CreatePairingFixture();
        var prompt = new BlockingPrompt();
        var first = PairingCreationContext();
        var second = PairingCreationContext();

        await PairingEndpoints.CreateAsync(first, fixture.Store, prompt);
        await PairingEndpoints.CreateAsync(second, fixture.Store, prompt);

        Assert.Equal(1, prompt.CallCount);
        var firstBody = Encoding.UTF8.GetString(((MemoryStream)first.Response.Body).ToArray());
        var secondBody = Encoding.UTF8.GetString(((MemoryStream)second.Response.Body).ToArray());
        using var firstDocument = JsonDocument.Parse(firstBody);
        using var secondDocument = JsonDocument.Parse(secondBody);
        var requestId = firstDocument.RootElement.GetProperty("requestId").GetString()!;
        Assert.Equal(requestId, secondDocument.RootElement.GetProperty("requestId").GetString());
        prompt.Complete(approved: false);
        for (var attempt = 0; attempt < 50 && fixture.Store.GetRequestStatus(requestId).Status != "denied"; attempt++)
        {
            await Task.Delay(10);
        }
        Assert.Equal("denied", fixture.Store.GetRequestStatus(requestId).Status);
    }

    [Fact]
    public async Task OversizedJsonIsRejectedWithoutReadingRequestBody()
    {
        var stream = new CountingStream(new byte[32]);
        var context = Context("POST", "/v1/pairing-requests", ProductionOrigin);
        context.Request.ContentType = "application/json";
        context.Request.ContentLength = 32;
        context.Request.Body = stream;

        await Assert.ThrowsAsync<RequestBodyTooLargeException>(() => RequestBodyLimits.ReadJsonAsync(context, 16));

        Assert.Equal(0, stream.ReadCount);
    }

    [Fact]
    public void ProductCertificateContainsOnlyLoopbackServerIdentityAndMarker()
    {
        using var certificate = LoopbackCertificateManager.CreateForInspection(DateTimeOffset.UtcNow);

        Assert.True(LoopbackCertificateManager.IsProductCertificate(certificate));
        Assert.True(LoopbackCertificateManager.HasExactLoopbackServerShape(certificate));
        Assert.False(LoopbackCertificateManager.IsUsableServerCertificate(certificate));
        Assert.Equal("localhost", certificate.GetNameInfo(X509NameType.DnsName, false));
        var sans = certificate.Extensions["2.5.29.17"]!.Format(false);
        Assert.Contains("localhost", sans, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("127.0.0.1", sans, StringComparison.OrdinalIgnoreCase);
        var eku = Assert.IsType<X509EnhancedKeyUsageExtension>(certificate.Extensions["2.5.29.37"]);
        Assert.Single(eku.EnhancedKeyUsages.Cast<Oid>());
        Assert.Equal("1.3.6.1.5.5.7.3.1", eku.EnhancedKeyUsages[0]!.Value);
    }

    [Fact]
    public void CertificateWithAnAdditionalDnsIdentityIsNotReusable()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, critical: true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, critical: true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            new OidCollection { new("1.3.6.1.5.5.7.3.1") }, critical: true));
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddDnsName("example.com");
        san.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(san.Build());
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddDays(1));

        Assert.False(LoopbackCertificateManager.HasExactLoopbackServerShape(certificate));
    }

    private PairingFixture CreatePairingFixture(int maxAttempts = 5)
    {
        Directory.CreateDirectory(root);
        return new PairingFixture(
            Path.Combine(root, Guid.NewGuid().ToString("N") + ".json"),
            new FakeTimeProvider(new DateTimeOffset(2026, 9, 8, 0, 0, 0, TimeSpan.Zero)),
            maxAttempts);
    }

    private static string ApproveAndClaim(PairingStore store, string origin)
    {
        var request = store.CreateRequest(origin);
        store.Approve(request.RequestId);
        return Assert.IsType<string>(store.GetRequestStatus(request.RequestId).Token);
    }

    private static DefaultHttpContext Context(string method, string path, string? origin = null, string? token = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        if (origin is not null) context.Request.Headers.Origin = origin;
        if (token is not null) context.Request.Headers.Authorization = "Bearer " + token;
        return context;
    }

    private static DefaultHttpContext PairingCreationContext()
    {
        var context = Context("POST", "/v1/pairing-requests", ProductionOrigin);
        context.Request.ContentType = "application/json";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{\"origin\":\"https://label-printing-workbench.pages.dev\"}"));
        return context;
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    private sealed class PairingFixture : IDisposable
    {
        public PairingFixture(string path, FakeTimeProvider time, int maxAttempts)
        {
            Path = path;
            Time = time;
            Store = new PairingStore(path, new PassthroughProtector(), time, new PairingStoreOptions
            {
                RequestLifetime = TimeSpan.FromMinutes(2),
                TokenLifetime = TimeSpan.FromHours(1),
                RateLimitWindow = TimeSpan.FromMinutes(1),
                MaxRequestsPerWindow = maxAttempts,
            });
        }

        public string Path { get; }
        public FakeTimeProvider Time { get; }
        public PairingStore Store { get; }
        public void Dispose() => Store.Dispose();
    }

    private sealed class PassthroughProtector : IPairingSecretProtector
    {
        public byte[] Protect(byte[] plaintext) => plaintext.ToArray();
        public byte[] Unprotect(byte[] protectedData) => protectedData.ToArray();
    }

    private sealed class CapturingPrompt : IPairingApprovalPrompt
    {
        public string? Origin { get; private set; }
        public Task<bool> RequestApprovalAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            Origin = exactOrigin;
            return Task.FromResult(false);
        }
    }

    private sealed class BlockingPrompt : IPairingApprovalPrompt
    {
        private readonly TaskCompletionSource<bool> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int CallCount { get; private set; }
        public Task<bool> RequestApprovalAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return completion.Task;
        }
        public void Complete(bool approved) => completion.TrySetResult(approved);
    }

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; private set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
        public void Advance(TimeSpan amount) => Now += amount;
    }

    private sealed class CountingStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int ReadCount { get; private set; }
        public override int Read(byte[] buffer, int offset, int count)
        {
            ReadCount++;
            return base.Read(buffer, offset, count);
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            ReadCount++;
            return base.ReadAsync(buffer, cancellationToken);
        }
    }
}
