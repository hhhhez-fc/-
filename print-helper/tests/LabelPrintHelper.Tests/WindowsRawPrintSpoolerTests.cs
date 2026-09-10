using LabelPrintHelper.Printing;

namespace LabelPrintHelper.Tests;

public sealed class WindowsRawPrintSpoolerTests
{
    [Fact]
    public async Task SubmitAsync_UsesRawWinspoolLifecycleAndReturnsJobId()
    {
        var api = new RecordingWindowsRawPrintApi();
        var spooler = new WindowsRawPrintSpooler(api);

        var jobId = await spooler.SubmitAsync("XP-420B", new byte[] { 1, 2, 3 }, "label-1", CancellationToken.None);

        Assert.Equal(42, jobId);
        Assert.Equal(["OpenPrinter:XP-420B", "StartDoc:label-1:RAW", "StartPage", "Write:3", "EndPage", "EndDoc", "Close"], api.Calls);
        Assert.Equal(new byte[] { 1, 2, 3 }, api.WrittenDocument);
    }

    [Fact]
    public async Task SubmitAsync_PreservesTheUnsignedDwordJobIdBitPattern()
    {
        var api = new RecordingWindowsRawPrintApi { JobId = 0xF000_0001u };
        var spooler = new WindowsRawPrintSpooler(api);

        var jobId = await spooler.SubmitAsync("XP-420B", new byte[] { 1 }, "label-1", CancellationToken.None);

        Assert.Equal(unchecked((int)0xF000_0001u), jobId);
        Assert.Equal(0xF000_0001u, unchecked((uint)jobId));
    }

    [Fact]
    public async Task SubmitAsync_ObservesCancellationBeforeOpeningPrinter()
    {
        var api = new RecordingWindowsRawPrintApi();
        var spooler = new WindowsRawPrintSpooler(api);
        using var source = new CancellationTokenSource();
        source.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            spooler.SubmitAsync("XP-420B", new byte[] { 1 }, "label-1", source.Token));

        Assert.Empty(api.Calls);
    }

    [Theory]
    [InlineData("", "label", true, "printerName")]
    [InlineData("printer", "", true, "documentName")]
    [InlineData("printer", "label", false, "document")]
    public async Task SubmitAsync_RejectsEmptyArgumentsWithoutNativeSideEffects(
        string printerName,
        string documentName,
        bool hasDocument,
        string parameterName)
    {
        var api = new RecordingWindowsRawPrintApi();
        var spooler = new WindowsRawPrintSpooler(api);

        var exception = await Assert.ThrowsAnyAsync<ArgumentException>(() => spooler.SubmitAsync(
            printerName,
            hasDocument ? new byte[] { 1 } : ReadOnlyMemory<byte>.Empty,
            documentName,
            CancellationToken.None));

        Assert.Equal(parameterName, exception.ParamName);
        Assert.Empty(api.Calls);
    }

    [Fact]
    public async Task SubmitAsync_DetectsShortWritesAndAbortsInsteadOfCompletingThePartialDocument()
    {
        var api = new RecordingWindowsRawPrintApi { WrittenByteCount = 2 };
        var spooler = new WindowsRawPrintSpooler(api);

        var exception = await Assert.ThrowsAsync<RawPrintException>(() =>
            spooler.SubmitAsync("XP-420B", new byte[] { 1, 2, 3 }, "label-1", CancellationToken.None));

        Assert.Equal(RawPrintFailureStage.WritePrinter, exception.Stage);
        Assert.Equal(PrintSubmissionCertainty.Unknown, exception.SubmissionCertainty);
        Assert.Equal(42u, exception.WindowsJobId);
        Assert.Null(exception.NativeErrorCode);
        Assert.Contains("2", exception.Message, StringComparison.Ordinal);
        Assert.Equal(["OpenPrinter:XP-420B", "StartDoc:label-1:RAW", "StartPage", "Write:3", "Abort", "Close"], api.Calls);
    }

    [Theory]
    [InlineData(FailurePoint.OpenPrinter, RawPrintFailureStage.OpenPrinter, PrintSubmissionCertainty.NotSubmitted, null, "OpenPrinter:XP-420B")]
    [InlineData(FailurePoint.StartDoc, RawPrintFailureStage.StartDocPrinter, PrintSubmissionCertainty.NotSubmitted, null, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|Close")]
    [InlineData(FailurePoint.StartPage, RawPrintFailureStage.StartPagePrinter, PrintSubmissionCertainty.Unknown, 42u, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|StartPage|Abort|Close")]
    [InlineData(FailurePoint.Write, RawPrintFailureStage.WritePrinter, PrintSubmissionCertainty.Unknown, 42u, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|StartPage|Write:3|Abort|Close")]
    [InlineData(FailurePoint.EndPage, RawPrintFailureStage.EndPagePrinter, PrintSubmissionCertainty.Unknown, 42u, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|StartPage|Write:3|EndPage|Abort|Close")]
    [InlineData(FailurePoint.EndDoc, RawPrintFailureStage.EndDocPrinter, PrintSubmissionCertainty.Unknown, 42u, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|StartPage|Write:3|EndPage|EndDoc|Abort|Close")]
    [InlineData(FailurePoint.Close, RawPrintFailureStage.ClosePrinter, PrintSubmissionCertainty.Submitted, 42u, "OpenPrinter:XP-420B|StartDoc:label-1:RAW|StartPage|Write:3|EndPage|EndDoc|Close")]
    public async Task SubmitAsync_ClassifiesEachNativeFailureAndUsesDeterministicCleanup(
        FailurePoint failurePoint,
        RawPrintFailureStage expectedStage,
        PrintSubmissionCertainty expectedCertainty,
        uint? expectedJobId,
        string expectedCalls)
    {
        var api = new RecordingWindowsRawPrintApi();
        api.Fail(failurePoint, errorCode: 1234);
        var spooler = new WindowsRawPrintSpooler(api);

        var exception = await Assert.ThrowsAsync<RawPrintException>(() =>
            spooler.SubmitAsync("XP-420B", new byte[] { 1, 2, 3 }, "label-1", CancellationToken.None));

        Assert.Equal(expectedStage, exception.Stage);
        Assert.Equal(expectedCertainty, exception.SubmissionCertainty);
        Assert.Equal(expectedJobId, exception.WindowsJobId);
        Assert.Equal(1234, exception.NativeErrorCode);
        Assert.Empty(exception.CleanupFailures);
        Assert.Equal(expectedCalls.Split('|'), api.Calls);
    }

    [Fact]
    public async Task SubmitAsync_PreservesPrimaryFailureAndImmediatelyCapturedErrorWhenAbortAndCloseAlsoFail()
    {
        var api = new RecordingWindowsRawPrintApi();
        api.Fail(FailurePoint.StartPage, errorCode: 111);
        api.Fail(FailurePoint.Abort, errorCode: 222);
        api.Fail(FailurePoint.Close, errorCode: 333);
        var spooler = new WindowsRawPrintSpooler(api);

        var exception = await Assert.ThrowsAsync<RawPrintException>(() =>
            spooler.SubmitAsync("XP-420B", new byte[] { 1 }, "label-1", CancellationToken.None));

        Assert.Equal(RawPrintFailureStage.StartPagePrinter, exception.Stage);
        Assert.Equal(111, exception.NativeErrorCode);
        Assert.Equal(42u, exception.WindowsJobId);
        Assert.Equal(PrintSubmissionCertainty.Unknown, exception.SubmissionCertainty);
        Assert.Collection(
            exception.CleanupFailures,
            failure =>
            {
                Assert.Equal(RawPrintFailureStage.AbortPrinter, failure.Stage);
                Assert.Equal(222, failure.NativeErrorCode);
            },
            failure =>
            {
                Assert.Equal(RawPrintFailureStage.ClosePrinter, failure.Stage);
                Assert.Equal(333, failure.NativeErrorCode);
            });
        Assert.Equal([111, 222, 333], api.ErrorReads);
        Assert.Equal(["OpenPrinter:XP-420B", "StartDoc:label-1:RAW", "StartPage", "Abort", "Close"], api.Calls);
    }

    public enum FailurePoint
    {
        None,
        OpenPrinter,
        StartDoc,
        StartPage,
        Write,
        EndPage,
        EndDoc,
        Abort,
        Close,
    }

    private sealed class RecordingWindowsRawPrintApi : IWindowsRawPrintApi
    {
        private readonly Dictionary<FailurePoint, int> failures = [];
        private int lastError;

        public uint JobId { get; init; } = 42;
        public int? WrittenByteCount { get; init; }
        public List<string> Calls { get; } = [];
        public List<int> ErrorReads { get; } = [];
        public byte[] WrittenDocument { get; private set; } = [];

        public void Fail(FailurePoint point, int errorCode) => failures.Add(point, errorCode);

        public bool OpenPrinter(string printerName, out nint printerHandle)
        {
            Calls.Add($"OpenPrinter:{printerName}");
            printerHandle = new nint(7);
            return Succeeds(FailurePoint.OpenPrinter);
        }

        public uint StartDocument(nint printerHandle, string documentName, string dataType)
        {
            Calls.Add($"StartDoc:{documentName}:{dataType}");
            return Succeeds(FailurePoint.StartDoc) ? JobId : 0;
        }

        public bool StartPage(nint printerHandle)
        {
            Calls.Add("StartPage");
            return Succeeds(FailurePoint.StartPage);
        }

        public bool Write(nint printerHandle, byte[] document, out int bytesWritten)
        {
            Calls.Add($"Write:{document.Length}");
            WrittenDocument = document.ToArray();
            bytesWritten = WrittenByteCount ?? document.Length;
            return Succeeds(FailurePoint.Write);
        }

        public bool EndPage(nint printerHandle)
        {
            Calls.Add("EndPage");
            return Succeeds(FailurePoint.EndPage);
        }

        public bool EndDocument(nint printerHandle)
        {
            Calls.Add("EndDoc");
            return Succeeds(FailurePoint.EndDoc);
        }

        public bool Abort(nint printerHandle)
        {
            Calls.Add("Abort");
            return Succeeds(FailurePoint.Abort);
        }

        public bool ClosePrinter(nint printerHandle)
        {
            Calls.Add("Close");
            return Succeeds(FailurePoint.Close);
        }

        public int GetLastError()
        {
            ErrorReads.Add(lastError);
            return lastError;
        }

        private bool Succeeds(FailurePoint point)
        {
            if (!failures.TryGetValue(point, out var errorCode))
            {
                return true;
            }
            lastError = errorCode;
            return false;
        }
    }
}
