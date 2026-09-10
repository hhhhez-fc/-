using System.Globalization;
using System.Text;
using System.Collections.Concurrent;
using LabelPrintHelper.Configuration;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Printing;

public sealed record CalibrationRequest(
    string PrinterId,
    string PrinterName,
    string MediaType,
    decimal MediaHeightMillimeters,
    decimal MediaOffsetMillimeters,
    int ReferenceX,
    int ReferenceY)
{
    public static CalibrationRequest Gap(string id, string name, decimal height, decimal offset, int x, int y) => new(id, name, "gap", height, offset, x, y);
    public static CalibrationRequest BlackMark(string id, string name, decimal height, decimal offset, int x, int y) => new(id, name, "blackMark", height, offset, x, y);
    public static CalibrationRequest Continuous(string id, string name, int x, int y) => new(id, name, "continuous", 0, 0, x, y);
}

public sealed class CalibrationService(
    IPrinterProfileStore profiles,
    IRawPrintSpooler spooler,
    IPrinterCatalog printers,
    TimeProvider? timeProvider = null)
{
    private readonly TimeProvider time = timeProvider ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> transitions = new(StringComparer.Ordinal);

    public async Task<StoredPrinterProfile> CalibrateAsync(CalibrationRequest request, CancellationToken cancellationToken = default)
    {
        Validate(request);
        return await WithPrinterTransitionAsync(request.PrinterId, async () =>
        {
            var printer = await RequirePrinterAsync(request.PrinterId, request.PrinterName, cancellationToken);
            var command = EncodeCalibration(request);
            if (Encoding.ASCII.GetString(command).Contains("PRINT", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("校准命令不能打印标签");
            var profile = new StoredPrinterProfile(
                request.PrinterId, request.PrinterName, PrinterProfileStore.ProductionProfileId, PrinterProfileStore.ProductionProfileVersion, Guid.NewGuid().ToString("N"),
                100, 75, 800, 600, request.MediaType, request.MediaHeightMillimeters, request.MediaOffsetMillimeters,
                request.ReferenceX, request.ReferenceY, PrinterProfileStore.PendingHardwareDialect, null, null, false, time.GetUtcNow(), null);
            await profiles.SaveAsync(profile, cancellationToken);
            await spooler.SubmitAsync(printer.DisplayName, command, "LabelPrintHelper sensor calibration", cancellationToken);
            return profile;
        }, cancellationToken);
    }

    public async Task<StoredPrinterProfile> PrintBorderTestAsync(string printerId, CancellationToken cancellationToken = default)
    {
        return await WithPrinterTransitionAsync(printerId, async () =>
        {
            var stored = await profiles.GetAsync(printerId, CancellationToken.None) ?? throw new InvalidOperationException("请先完成纸张校准");
            var pending = stored with { IsVerified = false, SensorCommandDialect = PrinterProfileStore.PendingHardwareDialect, TestAttemptId = null, TestPrintSubmittedAtUtc = null, UpdatedAtUtc = time.GetUtcNow(), VerifiedAtUtc = null };
            await profiles.SaveAsync(pending, CancellationToken.None);
            var printer = await RequirePrinterAsync(stored.PrinterId, stored.PrinterName, cancellationToken);
            var document = TsplEncoder.EncodePage(CreateBorderBitmap(), ToProfile(stored));
            if (Count(Encoding.ASCII.GetString(document), "PRINT 1,1") != 1) throw new InvalidOperationException("测试页必须只打印一张标签");
            await spooler.SubmitAsync(printer.DisplayName, document, "LabelPrintHelper 100x75 border verification", cancellationToken);
            var tested = pending with { TestAttemptId = Guid.NewGuid().ToString("N"), TestPrintSubmittedAtUtc = time.GetUtcNow(), UpdatedAtUtc = time.GetUtcNow() };
            await profiles.SaveAsync(tested, cancellationToken);
            return tested;
        }, cancellationToken);
    }

    public async Task<StoredPrinterProfile> ConfirmBorderTestAsync(string printerId, string testAttemptId, bool accepted, CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParseExact(testAttemptId, "N", out _)) throw new ArgumentException("测试尝试标识无效", nameof(testAttemptId));
        return await WithPrinterTransitionAsync(printerId, async () =>
        {
            var stored = await profiles.GetAsync(printerId, cancellationToken) ?? throw new InvalidOperationException("请先完成纸张校准");
            if (stored.TestPrintSubmittedAtUtc is null || !string.Equals(stored.TestAttemptId, testAttemptId, StringComparison.Ordinal)) throw new InvalidOperationException("测试结果已过期，请重新打印边框测试");
            var confirmed = accepted
                ? stored with { IsVerified = true, SensorCommandDialect = PrinterProfileStore.HardwareConfirmedDialect, UpdatedAtUtc = time.GetUtcNow(), VerifiedAtUtc = time.GetUtcNow() }
                : stored with { IsVerified = false, SensorCommandDialect = PrinterProfileStore.PendingHardwareDialect, TestAttemptId = null, TestPrintSubmittedAtUtc = null, UpdatedAtUtc = time.GetUtcNow(), VerifiedAtUtc = null };
            await profiles.SaveAsync(confirmed, cancellationToken);
            return confirmed;
        }, cancellationToken);
    }

    public Task<StoredPrinterProfile?> GetStatusAsync(string printerId, CancellationToken cancellationToken = default) => profiles.GetAsync(printerId, cancellationToken);

    internal static byte[] EncodeCalibration(CalibrationRequest request)
    {
        Validate(request);
        var format = static (decimal value) => value.ToString("0.###", CultureInfo.InvariantCulture);
        var sensing = request.MediaType switch
        {
            "gap" => $"GAP {format(request.MediaHeightMillimeters)} mm,{format(request.MediaOffsetMillimeters)} mm\r\nGAPDETECT\r\n",
            "blackMark" => $"BLINE {format(request.MediaHeightMillimeters)} mm,{format(request.MediaOffsetMillimeters)} mm\r\nBLINEDETECT\r\n",
            "continuous" => "GAP 0 mm,0 mm\r\n",
            _ => throw new ArgumentException("不支持的介质类型", nameof(request)),
        };
        return Encoding.ASCII.GetBytes("SIZE 100 mm,75 mm\r\n" + sensing);
    }

    private async Task<PrinterDescriptor> RequirePrinterAsync(string id, string name, CancellationToken cancellationToken)
    {
        var printer = (await printers.GetPrintersAsync(cancellationToken)).SingleOrDefault(item => item.Id == id && item.DisplayName == name);
        if (printer is null || !printer.IsCompatible || !printer.IsAvailable) throw new InvalidOperationException("所选 XP-420B 打印机不可用");
        return printer;
    }

    private static void Validate(CalibrationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PrinterId) || string.IsNullOrWhiteSpace(request.PrinterName) || request.PrinterName.Length > 256 ||
            request.MediaType is not ("gap" or "blackMark" or "continuous") || request.ReferenceX is < 0 or > 80 || request.ReferenceY is < 0 or > 80 ||
            request.MediaHeightMillimeters < 0 || request.MediaHeightMillimeters > 20 || request.MediaOffsetMillimeters < 0 || request.MediaOffsetMillimeters > 20 ||
            (request.MediaType == "continuous" && (request.MediaHeightMillimeters != 0 || request.MediaOffsetMillimeters != 0)) ||
            (request.MediaType != "continuous" && request.MediaHeightMillimeters <= 0))
        {
            throw new ArgumentException("校准参数无效", nameof(request));
        }
    }

    private static PrinterProfile ToProfile(StoredPrinterProfile stored) => new(100, 75, 800, 600,
        stored.MediaType switch
        {
            "gap" => new GapMediaSensing(stored.MediaHeightMillimeters, stored.MediaOffsetMillimeters),
            "blackMark" => new BlackMarkMediaSensing(stored.MediaHeightMillimeters, stored.MediaOffsetMillimeters),
            _ => new ContinuousMediaSensing(),
        }, 1, stored.ReferenceX, stored.ReferenceY);

    private static PackedMonochromeBitmap CreateBorderBitmap()
    {
        var bytes = new byte[60_000];
        for (var x = 0; x < 800; x++) { Set(bytes, x, 0); Set(bytes, x, 599); }
        for (var y = 0; y < 600; y++) { Set(bytes, 0, y); Set(bytes, 799, y); }
        return new PackedMonochromeBitmap(800, 600, 100, bytes);
    }

    private static void Set(byte[] data, int x, int y) => data[(y * 100) + (x / 8)] |= (byte)(0x80 >> (x % 8));
    private static int Count(string source, string value) => source.Split(value, StringSplitOptions.None).Length - 1;

    private async Task<T> WithPrinterTransitionAsync<T>(string printerId, Func<Task<T>> action, CancellationToken cancellationToken)
    {
        var gate = transitions.GetOrAdd(printerId, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try { return await action(); }
        finally { gate.Release(); }
    }
}
