using System.Text.Json;
using System.Text.Json.Serialization;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Configuration;

public sealed record StoredPrinterProfile(
    string PrinterId,
    string PrinterName,
    string ProfileId,
    string Version,
    string ProfileRevision,
    int WidthMillimeters,
    int HeightMillimeters,
    int WidthDots,
    int HeightDots,
    string MediaType,
    decimal MediaHeightMillimeters,
    decimal MediaOffsetMillimeters,
    int ReferenceX,
    int ReferenceY,
    string SensorCommandDialect,
    string? TestAttemptId,
    DateTimeOffset? TestPrintSubmittedAtUtc,
    bool IsVerified,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? VerifiedAtUtc);

public interface IPrinterProfileStore
{
    Task SaveAsync(StoredPrinterProfile profile, CancellationToken cancellationToken = default);
    Task<StoredPrinterProfile?> GetAsync(string printerId, CancellationToken cancellationToken = default);
}

public sealed class PrinterProfileStore : IPrinterProfileStore, IVerifiedPrinterProfileProvider
{
    public const string ProductionProfileId = ProtocolValidator.ProfileId;
    public const string ProductionProfileVersion = "xp420b-100x75-v1";
    public const string PendingHardwareDialect = "tspl-xp420b-pending-hardware-verification";
    public const string HardwareConfirmedDialect = "tspl-xp420b-user-confirmed-v1";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };
    private readonly string path;
    private readonly SemaphoreSlim gate = new(1, 1);

    public PrinterProfileStore(string path)
    {
        this.path = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(this.path)!);
    }

    public async Task SaveAsync(StoredPrinterProfile profile, CancellationToken cancellationToken = default)
    {
        Validate(profile);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var profiles = await ReadAllAsync(cancellationToken);
            profiles.RemoveAll(item => string.Equals(item.PrinterId, profile.PrinterId, StringComparison.Ordinal));
            profiles.Add(profile);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(profiles.OrderBy(item => item.PrinterId, StringComparer.Ordinal), JsonOptions);
            await AtomicWriteAsync(bytes, cancellationToken);
        }
        finally { gate.Release(); }
    }

    public async Task<StoredPrinterProfile?> GetAsync(string printerId, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try { return (await ReadAllAsync(cancellationToken)).SingleOrDefault(item => item.PrinterId == printerId); }
        finally { gate.Release(); }
    }

    public PrinterProfile? GetVerifiedProfile(string printerId, string profileId, string version)
    {
        gate.Wait();
        try
        {
            var stored = ReadAllAsync(CancellationToken.None).GetAwaiter().GetResult().SingleOrDefault(item =>
                item.IsVerified && item.PrinterId == printerId && item.ProfileId == profileId && item.Version == version);
            return stored is null ? null : ToPrinterProfile(stored);
        }
        finally { gate.Release(); }
    }

    private static PrinterProfile ToPrinterProfile(StoredPrinterProfile stored) => new(
        stored.WidthMillimeters,
        stored.HeightMillimeters,
        stored.WidthDots,
        stored.HeightDots,
        stored.MediaType switch
        {
            "gap" => new GapMediaSensing(stored.MediaHeightMillimeters, stored.MediaOffsetMillimeters),
            "blackMark" => new BlackMarkMediaSensing(stored.MediaHeightMillimeters, stored.MediaOffsetMillimeters),
            "continuous" => new ContinuousMediaSensing(),
            _ => throw new InvalidDataException("打印机配置介质类型无效"),
        },
        1,
        stored.ReferenceX,
        stored.ReferenceY);

    private async Task<List<StoredPrinterProfile>> ReadAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return [];
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var profiles = await JsonSerializer.DeserializeAsync<List<StoredPrinterProfile>>(stream, JsonOptions, cancellationToken) ?? throw new InvalidDataException("打印机配置文件为空");
        foreach (var profile in profiles) Validate(profile);
        if (profiles.Select(item => item.PrinterId).Distinct(StringComparer.Ordinal).Count() != profiles.Count) throw new InvalidDataException("打印机配置包含重复标识");
        return profiles;
    }

    private async Task AtomicWriteAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static void Validate(StoredPrinterProfile profile)
    {
        if (string.IsNullOrWhiteSpace(profile.PrinterId) || string.IsNullOrWhiteSpace(profile.PrinterName) ||
            profile.ProfileId != ProductionProfileId || profile.Version != ProductionProfileVersion || !IsCanonicalId(profile.ProfileRevision) ||
            profile.WidthMillimeters != 100 || profile.HeightMillimeters != 75 || profile.WidthDots != 800 || profile.HeightDots != 600 ||
            profile.MediaType is not ("gap" or "blackMark" or "continuous") ||
            profile.MediaHeightMillimeters < 0 || profile.MediaHeightMillimeters > 20 ||
            profile.MediaOffsetMillimeters < 0 || profile.MediaOffsetMillimeters > 20 ||
            profile.ReferenceX is < 0 or > 80 || profile.ReferenceY is < 0 or > 80 ||
            profile.SensorCommandDialect is not (PendingHardwareDialect or HardwareConfirmedDialect) || profile.UpdatedAtUtc == default ||
            (profile.IsVerified != profile.VerifiedAtUtc.HasValue) ||
            (profile.TestAttemptId is not null && !IsCanonicalId(profile.TestAttemptId)) ||
            (profile.TestPrintSubmittedAtUtc.HasValue != (profile.TestAttemptId is not null)) ||
            (profile.IsVerified && (profile.TestPrintSubmittedAtUtc is null || profile.SensorCommandDialect != HardwareConfirmedDialect)) ||
            (!profile.IsVerified && profile.SensorCommandDialect != PendingHardwareDialect))
        {
            throw new InvalidDataException("打印机配置字段无效");
        }
        if (profile.MediaType == "continuous" && (profile.MediaHeightMillimeters != 0 || profile.MediaOffsetMillimeters != 0)) throw new InvalidDataException("连续纸配置不能包含间隙尺寸");
        if (profile.MediaType != "continuous" && profile.MediaHeightMillimeters <= 0) throw new InvalidDataException("介质感应高度必须大于零");
    }

    private static bool IsCanonicalId(string value) => Guid.TryParseExact(value, "N", out _);
}
