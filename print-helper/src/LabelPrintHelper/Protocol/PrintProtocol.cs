using System.Text.Json.Serialization;

namespace LabelPrintHelper.Protocol;

public sealed record PrintRange(int From, int To);

public sealed record ThresholdOptions(string? Mode, int? Value);

public sealed record PrintSequenceEntry(
    int Ordinal,
    string? AssetId,
    string? LabelId,
    int SourcePageNumber,
    int CopyNumber);

public sealed record PrintAssetUpload(
    string? AssetId,
    string? LabelId,
    int WidthDots,
    int HeightDots,
    int Rotation,
    string? PngBase64,
    string? Sha256);

public sealed record PrintJobManifest(
    int ProtocolVersion,
    string? JobId,
    string? CreatedAtUtc,
    string? WebsiteVersion,
    string? PrinterId,
    string? PrinterName,
    string? ProfileId,
    string? PrinterProfileVersion,
    int WidthMm,
    int HeightMm,
    int WidthDots,
    int HeightDots,
    string? Layout,
    PrintRange? Range,
    int Copies,
    bool Collate,
    double HorizontalOffsetMm,
    double VerticalOffsetMm,
    ThresholdOptions? Threshold,
    int ExpectedLabels,
    IReadOnlyList<PrintAssetUpload>? Assets,
    IReadOnlyList<PrintSequenceEntry>? Sequence);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow)]
[JsonSerializable(typeof(PrintJobManifest))]
internal partial class PrintProtocolJsonContext : JsonSerializerContext;

public sealed class ProtocolValidationException(string message) : Exception(message);
