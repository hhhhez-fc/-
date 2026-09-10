namespace LabelPrintHelper.Printing;

public enum RawPrintFailureStage
{
    OpenPrinter,
    StartDocPrinter,
    StartPagePrinter,
    WritePrinter,
    EndPagePrinter,
    EndDocPrinter,
    AbortPrinter,
    ClosePrinter,
}

public enum PrintSubmissionCertainty
{
    NotSubmitted,
    Unknown,
    Submitted,
}

public sealed record RawPrintCleanupFailure(
    RawPrintFailureStage Stage,
    int? NativeErrorCode,
    string Message);

public sealed class RawPrintException : IOException
{
    private readonly List<RawPrintCleanupFailure> cleanupFailures = [];

    internal RawPrintException(
        RawPrintFailureStage stage,
        PrintSubmissionCertainty submissionCertainty,
        uint? windowsJobId,
        int? nativeErrorCode,
        string message,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Stage = stage;
        SubmissionCertainty = submissionCertainty;
        WindowsJobId = windowsJobId;
        NativeErrorCode = nativeErrorCode;
    }

    public RawPrintFailureStage Stage { get; }

    public PrintSubmissionCertainty SubmissionCertainty { get; }

    public uint? WindowsJobId { get; }

    public int? NativeErrorCode { get; }

    public IReadOnlyList<RawPrintCleanupFailure> CleanupFailures => cleanupFailures;

    internal void AddCleanupFailure(RawPrintCleanupFailure cleanupFailure) =>
        cleanupFailures.Add(cleanupFailure);
}

public interface IRawPrintSpooler
{
    // Windows job IDs are DWORD values. The signed return value preserves the
    // exact 32-bit pattern; callers can recover it with unchecked((uint)jobId).
    Task<int> SubmitAsync(
        string printerName,
        ReadOnlyMemory<byte> document,
        string documentName,
        CancellationToken cancellationToken);
}
