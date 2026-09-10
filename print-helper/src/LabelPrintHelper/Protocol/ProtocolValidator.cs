using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LabelPrintHelper.Protocol;

public static partial class ProtocolValidator
{
    public const int ProtocolVersion = 1;
    public const string ProfileId = "xp420b-100x75-203dpi";
    public const int WidthMm = 100;
    public const int HeightMm = 75;
    public const int WidthDots = 800;
    public const int HeightDots = 600;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    private static readonly string[] RootFields = ["protocolVersion", "jobId", "createdAtUtc", "websiteVersion", "printerId", "printerName", "profileId", "printerProfileVersion", "widthMm", "heightMm", "widthDots", "heightDots", "layout", "range", "copies", "collate", "horizontalOffsetMm", "verticalOffsetMm", "threshold", "expectedLabels", "assets", "sequence"];
    private static readonly string[] RangeFields = ["from", "to"];
    private static readonly string[] AssetFields = ["assetId", "labelId", "widthDots", "heightDots", "rotation", "pngBase64", "sha256"];
    private static readonly string[] SequenceFields = ["ordinal", "assetId", "labelId", "sourcePageNumber", "copyNumber"];

    public static PrintJobManifest DeserializeAndValidateManifest(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            ValidateJsonContract(document.RootElement);
        }
        catch (JsonException)
        {
            throw new ProtocolValidationException("打印任务 JSON 格式无效");
        }

        try
        {
            var manifest = JsonSerializer.Deserialize<PrintJobManifest>(json, JsonOptions)
                ?? throw new ProtocolValidationException("打印任务不能为空");
            ValidateManifest(manifest);
            return manifest;
        }
        catch (JsonException)
        {
            throw new ProtocolValidationException("打印任务包含不支持的字段");
        }
    }

    public static void ValidateManifest(PrintJobManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        if (manifest.ProtocolVersion != ProtocolVersion)
        {
            throw new ProtocolValidationException("不支持的打印协议版本");
        }
        if (manifest.ProfileId != ProfileId || manifest.WidthMm != WidthMm || manifest.HeightMm != HeightMm
            || manifest.WidthDots != WidthDots || manifest.HeightDots != HeightDots)
        {
            throw new ProtocolValidationException("打印任务必须使用 XP-420B 100 × 75 mm 配置");
        }

        RequireText(manifest.JobId, "任务标识");
        RequireUtc(manifest.CreatedAtUtc);
        RequireText(manifest.WebsiteVersion, "网站版本");
        RequireText(manifest.PrinterId, "打印机标识");
        RequireText(manifest.PrinterName, "打印机名称");
        RequireText(manifest.PrinterProfileVersion, "打印机配置版本");
        if (manifest.Layout is not ("landscape" or "portrait"))
        {
            throw new ProtocolValidationException("打印布局必须为 landscape 或 portrait");
        }
        if (manifest.Copies is < 1 or > 100)
        {
            throw new ProtocolValidationException("打印份数必须在 1–100 之间");
        }
        RequireOffset(manifest.HorizontalOffsetMm, "水平偏移");
        RequireOffset(manifest.VerticalOffsetMm, "垂直偏移");
        ValidateThreshold(manifest.Threshold);

        var range = manifest.Range ?? throw new ProtocolValidationException("打印范围不能为空");
        if (range.From < 1 || range.To < range.From)
        {
            throw new ProtocolValidationException("打印范围必须是正整数且起始页不大于结束页");
        }

        var assets = manifest.Assets ?? throw new ProtocolValidationException("打印资产不能为空");
        var sequence = manifest.Sequence ?? throw new ProtocolValidationException("打印序列不能为空");
        if (sequence.Count == 0 || manifest.ExpectedLabels != sequence.Count)
        {
            throw new ProtocolValidationException("预期标签数必须与打印序列一致");
        }

        var assetsById = new Dictionary<string, PrintAssetUpload>(StringComparer.Ordinal);
        foreach (var asset in assets)
        {
            ValidateAsset(asset);
            var assetId = asset.AssetId!;
            if (!assetsById.TryAdd(assetId, asset))
            {
                throw new ProtocolValidationException("打印资产标识必须唯一");
            }
        }

        var pageCount = (long)range.To - range.From + 1;
        if (pageCount <= 0 || pageCount * manifest.Copies != sequence.Count)
        {
            throw new ProtocolValidationException("打印序列必须完整覆盖每个源页和副本");
        }

        var appearances = assetsById.Keys.ToDictionary(key => key, _ => 0, StringComparer.Ordinal);
        var sourceReferences = new Dictionary<int, (string AssetId, string LabelId)>();
        var sourceCopyPairs = new HashSet<(int SourcePageNumber, int CopyNumber)>();
        for (var index = 0; index < sequence.Count; index++)
        {
            var entry = sequence[index];
            if (entry is null)
            {
                throw new ProtocolValidationException("打印序列项不能为空");
            }
            if (entry.Ordinal != index + 1)
            {
                throw new ProtocolValidationException("打印序列序号必须从 1 连续递增");
            }
            if (entry.CopyNumber is < 1 or > 100 || entry.CopyNumber > manifest.Copies)
            {
                throw new ProtocolValidationException("打印序列副本号必须在有效份数内");
            }
            if (entry.SourcePageNumber < range.From || entry.SourcePageNumber > range.To)
            {
                throw new ProtocolValidationException("打印序列源页必须在打印范围内");
            }
            if (string.IsNullOrWhiteSpace(entry.AssetId) || string.IsNullOrWhiteSpace(entry.LabelId)
                || !assetsById.TryGetValue(entry.AssetId, out var asset) || asset.LabelId != entry.LabelId)
            {
                throw new ProtocolValidationException("打印序列存在缺口");
            }
            appearances[entry.AssetId]++;
            if (sourceReferences.TryGetValue(entry.SourcePageNumber, out var reference)
                && (reference.AssetId != entry.AssetId || reference.LabelId != entry.LabelId))
            {
                throw new ProtocolValidationException("同一源页必须引用同一打印资产和标签");
            }
            sourceReferences[entry.SourcePageNumber] = (entry.AssetId, entry.LabelId);
            if (!sourceCopyPairs.Add((entry.SourcePageNumber, entry.CopyNumber)))
            {
                throw new ProtocolValidationException("打印序列必须完整覆盖每个源页和副本");
            }
        }
        for (var index = 0; index < sequence.Count; index++)
        {
            var entry = sequence[index]!;
            var expectedSourcePageNumber = manifest.Collate
                ? range.From + index % (int)pageCount
                : range.From + index / manifest.Copies;
            var expectedCopyNumber = manifest.Collate
                ? index / (int)pageCount + 1
                : index % manifest.Copies + 1;
            if (entry.SourcePageNumber != expectedSourcePageNumber || entry.CopyNumber != expectedCopyNumber)
            {
                throw new ProtocolValidationException("打印序列顺序与逐份打印设置不一致");
            }
        }
        if (appearances.Values.Any(count => count == 0))
        {
            throw new ProtocolValidationException("每个打印资产必须在序列中出现一次");
        }
        for (var sourcePageNumber = range.From; sourcePageNumber <= range.To; sourcePageNumber++)
        {
            for (var copyNumber = 1; copyNumber <= manifest.Copies; copyNumber++)
            {
                if (!sourceCopyPairs.Contains((sourcePageNumber, copyNumber)))
                {
                    throw new ProtocolValidationException("打印序列必须完整覆盖每个源页和副本");
                }
            }
        }
    }

    public static void ValidateAsset(PrintAssetUpload? asset)
    {
        if (asset is null)
        {
            throw new ProtocolValidationException("打印资产不能为空");
        }
        RequireText(asset.AssetId, "打印资产标识");
        RequireText(asset.LabelId, "打印资产标签标识");
        if (asset.WidthDots != WidthDots || asset.HeightDots != HeightDots)
        {
            throw new ProtocolValidationException("打印资产必须为 800 × 600 dots");
        }
        if (asset.Rotation is not (0 or 90 or 180 or 270))
        {
            throw new ProtocolValidationException("打印资产旋转角度无效");
        }
        if (string.IsNullOrWhiteSpace(asset.PngBase64) || !IsBase64(asset.PngBase64))
        {
            throw new ProtocolValidationException("打印资产 PNG 数据不是有效的 Base64");
        }
        var bytes = Convert.FromBase64String(asset.PngBase64);
        if (!HasCompletePngStructure(bytes))
        {
            throw new ProtocolValidationException("打印资产必须是完整的 PNG 图像");
        }
        if (string.IsNullOrWhiteSpace(asset.Sha256) || !Sha256Pattern().IsMatch(asset.Sha256))
        {
            throw new ProtocolValidationException("打印资产 SHA-256 格式无效");
        }
    }

    private static void ValidateThreshold(ThresholdOptions? threshold)
    {
        if (threshold is null || threshold.Mode is not ("text" or "auto" or "custom"))
        {
            throw new ProtocolValidationException("阈值模式必须为 text、auto 或 custom");
        }
        if (threshold.Mode == "custom" && (threshold.Value is < 0 or > 255 || threshold.Value is null))
        {
            throw new ProtocolValidationException("自定义阈值必须在 0–255 之间");
        }
        if (threshold.Mode != "custom" && threshold.Value is not null)
        {
            throw new ProtocolValidationException("仅自定义阈值模式可设置阈值");
        }
    }

    private static void RequireText(string? value, string subject)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ProtocolValidationException($"{subject}不能为空");
        }
    }

    private static void RequireUtc(string? value)
    {
        var match = value is null ? null : UtcTimestampPattern().Match(value);
        if (match is null || !match.Success)
        {
            throw new ProtocolValidationException("创建时间必须是有效的 UTC 日期时间");
        }
        try
        {
            _ = new DateTime(
                int.Parse(match.Groups["year"].Value, CultureInfo.InvariantCulture),
                int.Parse(match.Groups["month"].Value, CultureInfo.InvariantCulture),
                int.Parse(match.Groups["day"].Value, CultureInfo.InvariantCulture),
                int.Parse(match.Groups["hour"].Value, CultureInfo.InvariantCulture),
                int.Parse(match.Groups["minute"].Value, CultureInfo.InvariantCulture),
                int.Parse(match.Groups["second"].Value, CultureInfo.InvariantCulture),
                DateTimeKind.Utc);
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new ProtocolValidationException("创建时间必须是有效的 UTC 日期时间");
        }
        catch (FormatException)
        {
            throw new ProtocolValidationException("创建时间必须是有效的 UTC 日期时间");
        }
        catch (OverflowException)
        {
            throw new ProtocolValidationException("创建时间必须是有效的 UTC 日期时间");
        }
    }

    private static void RequireOffset(double value, string axis)
    {
        if (!double.IsFinite(value) || value is < -10 or > 10)
        {
            throw new ProtocolValidationException($"{axis}必须在 -10–10 mm 之间");
        }
    }

    private static bool IsBase64(string value)
    {
        return Base64Pattern().IsMatch(value);
    }

    private static bool HasCompletePngStructure(ReadOnlySpan<byte> bytes)
    {
        ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.Length < signature.Length || !bytes[..signature.Length].SequenceEqual(signature))
        {
            return false;
        }
        var offset = signature.Length;
        var chunkIndex = 0;
        while (offset + 12 <= bytes.Length)
        {
            var length = ReadBigEndianUInt32(bytes[offset..]);
            if (length > int.MaxValue || offset + 12L + length > bytes.Length)
            {
                return false;
            }
            var type = Encoding.ASCII.GetString(bytes.Slice(offset + 4, 4));
            if (chunkIndex == 0 && (type != "IHDR" || length != 13))
            {
                return false;
            }
            offset += checked((int)(12 + length));
            if (type == "IEND")
            {
                return length == 0 && offset == bytes.Length;
            }
            chunkIndex++;
        }
        return false;
    }

    private static uint ReadBigEndianUInt32(ReadOnlySpan<byte> value) =>
        ((uint)value[0] << 24) | ((uint)value[1] << 16) | ((uint)value[2] << 8) | value[3];

    [GeneratedRegex("^[A-Fa-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    [GeneratedRegex("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})(?:\\.[0-9]+)?Z$", RegexOptions.CultureInvariant)]
    private static partial Regex UtcTimestampPattern();

    [GeneratedRegex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$", RegexOptions.CultureInvariant)]
    private static partial Regex Base64Pattern();

    private static void ValidateJsonContract(JsonElement root)
    {
        ValidateRequiredObject(root, RootFields, RootFields);
        var range = root.GetProperty("range");
        ValidateRequiredObject(range, RangeFields, RangeFields);

        var threshold = root.GetProperty("threshold");
        ValidateRequiredObject(threshold, ["mode"], ["mode", "value"]);
        var thresholdModeElement = threshold.GetProperty("mode");
        if (thresholdModeElement.ValueKind != JsonValueKind.String)
        {
            throw new ProtocolValidationException("打印任务 JSON 格式无效");
        }
        var thresholdMode = thresholdModeElement.GetString();
        var hasThresholdValue = threshold.TryGetProperty("value", out var thresholdValue);
        if (thresholdMode == "custom" && (!hasThresholdValue || thresholdValue.ValueKind == JsonValueKind.Null))
        {
            throw new ProtocolValidationException("自定义阈值必须在 0–255 之间");
        }
        if (thresholdMode is "text" or "auto" && hasThresholdValue)
        {
            throw new ProtocolValidationException("仅自定义阈值模式可设置阈值");
        }

        ValidateJsonArray(root.GetProperty("assets"), AssetFields);
        ValidateJsonArray(root.GetProperty("sequence"), SequenceFields);
    }

    private static void ValidateJsonArray(JsonElement array, string[] fields)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            throw new ProtocolValidationException("打印任务 JSON 格式无效");
        }
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Null)
            {
                continue;
            }
            ValidateRequiredObject(item, fields, fields);
        }
    }

    private static void ValidateRequiredObject(JsonElement element, string[] requiredFields, string[] allowedFields)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ProtocolValidationException("打印任务 JSON 格式无效");
        }
        var seenFields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!seenFields.Add(property.Name))
            {
                throw new ProtocolValidationException("打印任务包含重复字段");
            }
        }
        foreach (var requiredField in requiredFields)
        {
            if (!element.TryGetProperty(requiredField, out _))
            {
                throw new ProtocolValidationException("打印任务缺少必填字段");
            }
        }
        foreach (var property in element.EnumerateObject())
        {
            if (!allowedFields.Contains(property.Name, StringComparer.Ordinal))
            {
                throw new ProtocolValidationException("打印任务包含不支持的字段");
            }
        }
    }
}
