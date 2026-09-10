using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;
using System.Text.Json.Serialization;

namespace LabelPrintHelper.Jobs;

public sealed record PrintPageOutcome(int Ordinal, string AssetId, string Sha256, string Status = "received", uint? WindowsJobId = null, RawPrintFailureStage? FailureStage = null, PrintSubmissionCertainty? Certainty = null);
public sealed record PrintJobStatus(string JobId, string ManifestFingerprint, string Status, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc, IReadOnlyList<PrintPageOutcome> Pages)
{
    [JsonIgnore]
    public bool IsTerminal => Status is "submitted" or "partial" or "failed" or "unknown";
}
public sealed record StoredPrintJob(PrintJobStatus Summary, PrintJobManifest? Manifest);
public sealed class PrintJobConflictException(string message) : Exception(message);
public sealed class PrintJobNotFoundException() : Exception("打印任务不存在");
