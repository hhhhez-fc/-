using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LabelPrintHelper.Security;

public sealed class PairingStoreOptions
{
    public TimeSpan RequestLifetime { get; init; } = TimeSpan.FromMinutes(2);
    public TimeSpan TokenLifetime { get; init; } = TimeSpan.FromDays(90);
    public TimeSpan RateLimitWindow { get; init; } = TimeSpan.FromMinutes(1);
    public TimeSpan TerminalStatusRetention { get; init; } = TimeSpan.FromMinutes(10);
    public int MaxRequestsPerWindow { get; init; } = 5;
}

public sealed record PairingRequestStatus(
    string RequestId,
    string Status,
    DateTimeOffset? ExpiresAtUtc = null,
    string? Token = null);

public sealed class PairingRequestNotFoundException : Exception;
public sealed class PairingRateLimitException : Exception;
public sealed class PairingStateException(string message) : Exception(message);

public interface IPairingSecretProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] protectedData);
}

public sealed class DpapiPairingSecretProtector : IPairingSecretProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("LabelPrintHelper.Pairing.v1");

    public byte[] Protect(byte[] plaintext) =>
        ProtectedData.Protect(plaintext, Entropy, DataProtectionScope.CurrentUser);

    public byte[] Unprotect(byte[] protectedData) =>
        ProtectedData.Unprotect(protectedData, Entropy, DataProtectionScope.CurrentUser);
}

public sealed class PairingStore : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    private readonly object gate = new();
    private readonly string path;
    private readonly IPairingSecretProtector protector;
    private readonly TimeProvider time;
    private readonly PairingStoreOptions options;
    private readonly Dictionary<string, Queue<DateTimeOffset>> attempts = new(StringComparer.Ordinal);
    private PersistedState state;

    public PairingStore(
        string? path = null,
        IPairingSecretProtector? protector = null,
        TimeProvider? timeProvider = null,
        PairingStoreOptions? options = null)
    {
        this.path = Path.GetFullPath(path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LabelPrintHelper",
            "pairing.json"));
        this.protector = protector ?? new DpapiPairingSecretProtector();
        time = timeProvider ?? TimeProvider.System;
        this.options = options ?? new PairingStoreOptions();
        if (this.options.MaxRequestsPerWindow < 1 || this.options.RequestLifetime <= TimeSpan.Zero ||
            this.options.TokenLifetime <= TimeSpan.Zero || this.options.RateLimitWindow <= TimeSpan.Zero ||
            this.options.TerminalStatusRetention <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(options));
        }

        state = Load();
    }

    public PairingRequestStatus CreateRequest(string origin) => CreateRequest(origin, out _);

    public PairingRequestStatus CreateRequest(string origin, out bool created)
    {
        var normalized = OriginPolicy.NormalizeOrigin(origin) ?? throw new ArgumentException("网站来源格式无效", nameof(origin));
        lock (gate)
        {
            var now = time.GetUtcNow();
            var existing = state.Requests.Values.FirstOrDefault(request =>
                request.Origin == normalized && request.Status is "pending" or "approved" && request.ExpiresAtUtc > now);
            if (existing is not null)
            {
                created = false;
                return new(existing.RequestId, "pending", existing.ExpiresAtUtc);
            }
            ApplyRateLimit(normalized, now);
            var requestId = RandomValue();
            var request = new PersistedRequest(requestId, normalized, "pending", now + options.RequestLifetime);
            state.Requests[requestId] = request;
            Save();
            created = true;
            return ToStatus(request, now, issueToken: false);
        }
    }

    public string GetRequestOrigin(string requestId)
    {
        lock (gate)
        {
            return GetRequest(requestId).Origin;
        }
    }

    public void Approve(string requestId)
    {
        lock (gate)
        {
            var request = GetRequest(requestId);
            var now = time.GetUtcNow();
            if (request.ExpiresAtUtc <= now)
            {
                SetRequestStatus(request, "expired");
                throw new PairingStateException("配对请求已过期");
            }
            if (request.Status == "approved" || request.Status == "claimed") return;
            if (request.Status != "pending") throw new PairingStateException("配对请求已结束");
            SetRequestStatus(request, "approved");
        }
    }

    public void Deny(string requestId)
    {
        lock (gate)
        {
            var request = GetRequest(requestId);
            if (request.Status is "denied" or "expired") return;
            if (request.Status is "approved" or "claimed") throw new PairingStateException("配对请求已批准");
            SetRequestStatus(request, request.ExpiresAtUtc <= time.GetUtcNow() ? "expired" : "denied");
        }
    }

    public PairingRequestStatus GetRequestStatus(string requestId)
    {
        lock (gate)
        {
            var now = time.GetUtcNow();
            var request = GetRequest(requestId);
            if (request.Status is "pending" or "approved" && request.ExpiresAtUtc <= now)
            {
                request = request with { Status = "expired" };
                state.Requests[requestId] = request;
                Save();
            }
            return ToStatus(request, now, issueToken: request.Status == "approved");
        }
    }

    public bool ValidateToken(string origin, string token)
    {
        var normalized = OriginPolicy.NormalizeOrigin(origin);
        if (normalized is null || string.IsNullOrWhiteSpace(token)) return false;
        var candidate = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        try
        {
            lock (gate)
            {
                if (!state.Tokens.TryGetValue(normalized, out var record) || record.ExpiresAtUtc <= time.GetUtcNow()) return false;
                byte[] expected;
                try { expected = protector.Unprotect(Convert.FromBase64String(record.ProtectedHash)); }
                catch (Exception exception) when (exception is CryptographicException or FormatException) { return false; }
                try { return expected.Length == candidate.Length && CryptographicOperations.FixedTimeEquals(expected, candidate); }
                finally { CryptographicOperations.ZeroMemory(expected); }
            }
        }
        finally { CryptographicOperations.ZeroMemory(candidate); }
    }

    public bool ValidatePollingCapability(string origin, string requestId, string token)
    {
        var normalized = OriginPolicy.NormalizeOrigin(origin);
        if (normalized is null || string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(token)) return false;
        lock (gate)
        {
            if (!state.Requests.TryGetValue(requestId, out var request) || request.Origin != normalized ||
                request.ExpiresAtUtc + options.TerminalStatusRetention <= time.GetUtcNow()) return false;
            var expected = Encoding.UTF8.GetBytes(requestId);
            var candidate = Encoding.UTF8.GetBytes(token);
            try { return expected.Length == candidate.Length && CryptographicOperations.FixedTimeEquals(expected, candidate); }
            finally
            {
                CryptographicOperations.ZeroMemory(expected);
                CryptographicOperations.ZeroMemory(candidate);
            }
        }
    }

    public void Dispose()
    {
    }

    private PairingRequestStatus ToStatus(PersistedRequest request, DateTimeOffset now, bool issueToken)
    {
        if (!issueToken)
        {
            return new(request.RequestId, request.Status, request.Status == "pending" ? request.ExpiresAtUtc : null);
        }

        var token = RandomValue();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        try
        {
            var protectedHash = protector.Protect(hash);
            state.Tokens[request.Origin] = new(Convert.ToBase64String(protectedHash), now + options.TokenLifetime);
        }
        finally { CryptographicOperations.ZeroMemory(hash); }
        state.Requests[request.RequestId] = request with { Status = "claimed" };
        Save();
        return new(request.RequestId, "approved", Token: token);
    }

    private void ApplyRateLimit(string origin, DateTimeOffset now)
    {
        if (!attempts.TryGetValue(origin, out var queue)) attempts[origin] = queue = new();
        while (queue.TryPeek(out var attempt) && now - attempt >= options.RateLimitWindow) queue.Dequeue();
        if (queue.Count >= options.MaxRequestsPerWindow) throw new PairingRateLimitException();
        queue.Enqueue(now);
    }

    private PersistedRequest GetRequest(string requestId) =>
        !string.IsNullOrWhiteSpace(requestId) && state.Requests.TryGetValue(requestId, out var request)
            ? request
            : throw new PairingRequestNotFoundException();

    private void SetRequestStatus(PersistedRequest request, string status)
    {
        state.Requests[request.RequestId] = request with { Status = status };
        Save();
    }

    private PersistedState Load()
    {
        if (!File.Exists(path)) return new();
        try
        {
            return JsonSerializer.Deserialize<PersistedState>(File.ReadAllBytes(path), JsonOptions) ?? new();
        }
        catch (Exception exception) when (exception is IOException or JsonException)
        {
            throw new IOException("配对授权存储损坏", exception);
        }
    }

    private void Save()
    {
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions));
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static string RandomValue()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private sealed class PersistedState
    {
        public Dictionary<string, PersistedRequest> Requests { get; init; } = new(StringComparer.Ordinal);
        public Dictionary<string, PersistedToken> Tokens { get; init; } = new(StringComparer.Ordinal);
    }

    private sealed record PersistedRequest(string RequestId, string Origin, string Status, DateTimeOffset ExpiresAtUtc);
    private sealed record PersistedToken(string ProtectedHash, DateTimeOffset ExpiresAtUtc);
}
