using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

[assembly: InternalsVisibleTo("LabelPrintHelper.Tests")]

namespace LabelPrintHelper.Printing;

public sealed class WindowsRawPrintSpooler : IRawPrintSpooler
{
    private readonly IWindowsRawPrintApi api;

    public WindowsRawPrintSpooler()
        : this(NativeWindowsRawPrintApi.Instance)
    {
    }

    internal WindowsRawPrintSpooler(IWindowsRawPrintApi api)
    {
        this.api = api ?? throw new ArgumentNullException(nameof(api));
    }

    public Task<int> SubmitAsync(
        string printerName,
        ReadOnlyMemory<byte> document,
        string documentName,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(printerName);
        ArgumentException.ThrowIfNullOrWhiteSpace(documentName);
        if (document.IsEmpty)
        {
            throw new ArgumentException("打印文档不能为空", nameof(document));
        }
        cancellationToken.ThrowIfCancellationRequested();

        var bytes = document.ToArray();
        nint printerHandle = 0;
        var printerOpened = false;
        var documentStarted = false;
        var documentSubmitted = false;
        uint jobId = 0;
        RawPrintException? failure = null;
        var currentStage = RawPrintFailureStage.OpenPrinter;

        try
        {
            if (!api.OpenPrinter(printerName, out printerHandle))
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.OpenPrinter,
                    PrintSubmissionCertainty.NotSubmitted,
                    windowsJobId: null);
            }
            printerOpened = true;

            currentStage = RawPrintFailureStage.StartDocPrinter;
            jobId = api.StartDocument(printerHandle, documentName, "RAW");
            if (jobId == 0)
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.StartDocPrinter,
                    PrintSubmissionCertainty.NotSubmitted,
                    windowsJobId: null);
            }
            documentStarted = true;

            currentStage = RawPrintFailureStage.StartPagePrinter;
            if (!api.StartPage(printerHandle))
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.StartPagePrinter,
                    PrintSubmissionCertainty.Unknown,
                    jobId);
            }

            currentStage = RawPrintFailureStage.WritePrinter;
            if (!api.Write(printerHandle, bytes, out var bytesWritten))
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.WritePrinter,
                    PrintSubmissionCertainty.Unknown,
                    jobId);
            }
            if (bytesWritten != bytes.Length)
            {
                throw new RawPrintException(
                    RawPrintFailureStage.WritePrinter,
                    PrintSubmissionCertainty.Unknown,
                    jobId,
                    nativeErrorCode: null,
                    $"WritePrinter 仅写入 {bytesWritten} / {bytes.Length} bytes");
            }

            currentStage = RawPrintFailureStage.EndPagePrinter;
            if (!api.EndPage(printerHandle))
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.EndPagePrinter,
                    PrintSubmissionCertainty.Unknown,
                    jobId);
            }

            currentStage = RawPrintFailureStage.EndDocPrinter;
            if (!api.EndDocument(printerHandle))
            {
                throw CreateWin32Exception(
                    RawPrintFailureStage.EndDocPrinter,
                    PrintSubmissionCertainty.Unknown,
                    jobId);
            }
            documentStarted = false;
            documentSubmitted = true;
        }
        catch (RawPrintException exception)
        {
            failure = exception;
        }
        catch (Exception exception)
        {
            failure = new RawPrintException(
                currentStage,
                documentStarted ? PrintSubmissionCertainty.Unknown : PrintSubmissionCertainty.NotSubmitted,
                documentStarted ? jobId : null,
                nativeErrorCode: null,
                $"{OperationName(currentStage)} 失败",
                exception);
        }
        finally
        {
            if (failure is not null && documentStarted)
            {
                TryCleanup(
                    api.Abort,
                    printerHandle,
                    RawPrintFailureStage.AbortPrinter,
                    failure);
            }
            if (printerOpened)
            {
                failure = TryClose(
                    printerHandle,
                    jobId,
                    documentSubmitted,
                    failure);
            }
        }

        if (failure is not null)
        {
            throw failure;
        }
        return Task.FromResult(unchecked((int)jobId));
    }

    private RawPrintException CreateWin32Exception(
        RawPrintFailureStage stage,
        PrintSubmissionCertainty submissionCertainty,
        uint? windowsJobId)
    {
        var errorCode = api.GetLastError();
        return new RawPrintException(
            stage,
            submissionCertainty,
            windowsJobId,
            errorCode,
            $"{OperationName(stage)} 失败",
            new Win32Exception(errorCode));
    }

    private void TryCleanup(
        Func<nint, bool> cleanup,
        nint printerHandle,
        RawPrintFailureStage stage,
        RawPrintException primaryFailure)
    {
        try
        {
            if (!cleanup(printerHandle))
            {
                var errorCode = api.GetLastError();
                primaryFailure.AddCleanupFailure(new RawPrintCleanupFailure(
                    stage,
                    errorCode,
                    $"{OperationName(stage)} 失败"));
            }
        }
        catch (Exception cleanupFailure)
        {
            primaryFailure.AddCleanupFailure(new RawPrintCleanupFailure(
                stage,
                NativeErrorCode: null,
                cleanupFailure.Message));
        }
    }

    private RawPrintException? TryClose(
        nint printerHandle,
        uint jobId,
        bool documentSubmitted,
        RawPrintException? primaryFailure)
    {
        try
        {
            if (api.ClosePrinter(printerHandle))
            {
                return primaryFailure;
            }

            var errorCode = api.GetLastError();
            if (primaryFailure is not null)
            {
                primaryFailure.AddCleanupFailure(new RawPrintCleanupFailure(
                    RawPrintFailureStage.ClosePrinter,
                    errorCode,
                    "ClosePrinter 失败"));
                return primaryFailure;
            }

            return new RawPrintException(
                RawPrintFailureStage.ClosePrinter,
                documentSubmitted ? PrintSubmissionCertainty.Submitted : PrintSubmissionCertainty.Unknown,
                jobId == 0 ? null : jobId,
                errorCode,
                "ClosePrinter 失败",
                new Win32Exception(errorCode));
        }
        catch (Exception closeFailure)
        {
            if (primaryFailure is not null)
            {
                primaryFailure.AddCleanupFailure(new RawPrintCleanupFailure(
                    RawPrintFailureStage.ClosePrinter,
                    NativeErrorCode: null,
                    closeFailure.Message));
                return primaryFailure;
            }

            return new RawPrintException(
                RawPrintFailureStage.ClosePrinter,
                documentSubmitted ? PrintSubmissionCertainty.Submitted : PrintSubmissionCertainty.Unknown,
                jobId == 0 ? null : jobId,
                nativeErrorCode: null,
                "ClosePrinter 失败",
                closeFailure);
        }
    }

    private static string OperationName(RawPrintFailureStage stage) => stage switch
    {
        RawPrintFailureStage.OpenPrinter => "OpenPrinter",
        RawPrintFailureStage.StartDocPrinter => "StartDocPrinter",
        RawPrintFailureStage.StartPagePrinter => "StartPagePrinter",
        RawPrintFailureStage.WritePrinter => "WritePrinter",
        RawPrintFailureStage.EndPagePrinter => "EndPagePrinter",
        RawPrintFailureStage.EndDocPrinter => "EndDocPrinter",
        RawPrintFailureStage.AbortPrinter => "AbortPrinter",
        RawPrintFailureStage.ClosePrinter => "ClosePrinter",
        _ => throw new ArgumentOutOfRangeException(nameof(stage)),
    };
}

internal interface IWindowsRawPrintApi
{
    bool OpenPrinter(string printerName, out nint printerHandle);
    uint StartDocument(nint printerHandle, string documentName, string dataType);
    bool StartPage(nint printerHandle);
    bool Write(nint printerHandle, byte[] document, out int bytesWritten);
    bool EndPage(nint printerHandle);
    bool EndDocument(nint printerHandle);
    bool Abort(nint printerHandle);
    bool ClosePrinter(nint printerHandle);
    int GetLastError();
}

internal sealed class NativeWindowsRawPrintApi : IWindowsRawPrintApi
{
    public static NativeWindowsRawPrintApi Instance { get; } = new();

    private NativeWindowsRawPrintApi()
    {
    }

    public bool OpenPrinter(string printerName, out nint printerHandle) =>
        OpenPrinterNative(printerName, out printerHandle, 0);

    public uint StartDocument(nint printerHandle, string documentName, string dataType)
    {
        var documentInfo = new DocumentInfo
        {
            DocumentName = documentName,
            OutputFile = null,
            DataType = dataType,
        };
        return StartDocPrinterNative(printerHandle, 1, ref documentInfo);
    }

    public bool StartPage(nint printerHandle) => StartPagePrinterNative(printerHandle);

    public bool Write(nint printerHandle, byte[] document, out int bytesWritten) =>
        WritePrinterNative(printerHandle, document, document.Length, out bytesWritten);

    public bool EndPage(nint printerHandle) => EndPagePrinterNative(printerHandle);

    public bool EndDocument(nint printerHandle) => EndDocPrinterNative(printerHandle);

    public bool Abort(nint printerHandle) => AbortPrinterNative(printerHandle);

    public bool ClosePrinter(nint printerHandle) => ClosePrinterNative(printerHandle);

    public int GetLastError() => Marshal.GetLastWin32Error();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocumentInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string DocumentName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? OutputFile;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string DataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinterNative(
        string printerName,
        out nint printerHandle,
        nint defaults);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint StartDocPrinterNative(
        nint printerHandle,
        int level,
        ref DocumentInfo documentInfo);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartPagePrinterNative(nint printerHandle);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WritePrinterNative(
        nint printerHandle,
        byte[] buffer,
        int bufferLength,
        out int bytesWritten);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPagePrinterNative(nint printerHandle);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDocPrinterNative(nint printerHandle);

    [DllImport("winspool.drv", EntryPoint = "AbortPrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AbortPrinterNative(nint printerHandle);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinterNative(nint printerHandle);
}
