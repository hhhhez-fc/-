using System.Text;
using System.Text.RegularExpressions;
using LabelPrintHelper.Printing;

namespace LabelPrintHelper.Tests;

public sealed class TsplEncoderTests
{
    [Fact]
    public void EncodePage_EmitsOneExactHundredBySeventyFiveMillimeterLabel()
    {
        var bitmap = White800By600();

        var encoded = TsplEncoder.EncodePage(bitmap, GapFixture());

        var header = Encoding.ASCII.GetBytes(
            "SIZE 100 mm,75 mm\r\n" +
            "GAP 2 mm,0 mm\r\n" +
            "DIRECTION 1\r\n" +
            "REFERENCE 0,0\r\n" +
            "CLS\r\n" +
            "BITMAP 0,0,100,600,0,");
        var suffix = Encoding.ASCII.GetBytes("\r\nPRINT 1,1\r\n");

        Assert.Equal(header, encoded[..header.Length]);
        Assert.Equal(bitmap.Data, encoded.AsSpan(header.Length, 60_000).ToArray());
        Assert.Equal(suffix, encoded[^suffix.Length..]);
        Assert.Equal(header.Length + 60_000 + suffix.Length, encoded.Length);
        Assert.Single(Regex.Matches(Encoding.Latin1.GetString(encoded), "PRINT 1,1"));
        Assert.DoesNotContain("PRINT 2", Encoding.Latin1.GetString(encoded), StringComparison.Ordinal);
    }

    [Fact]
    public void EncodePage_UsesBlackMarkSensingFromImmutableProfile()
    {
        var profile = GapFixture() with
        {
            MediaSensing = new BlackMarkMediaSensing(HeightMillimeters: 3m, OffsetMillimeters: 1.5m),
            Direction = 0,
            ReferenceX = 4,
            ReferenceY = 8,
        };

        var encoded = TsplEncoder.EncodePage(White800By600(), profile);
        var text = Encoding.Latin1.GetString(encoded);

        Assert.Contains("BLINE 3 mm,1.5 mm\r\n", text, StringComparison.Ordinal);
        Assert.Contains("DIRECTION 0\r\n", text, StringComparison.Ordinal);
        Assert.Contains("REFERENCE 4,8\r\n", text, StringComparison.Ordinal);
        Assert.DoesNotContain("GAP ", text, StringComparison.Ordinal);
    }

    [Fact]
    public void EncodePage_RejectsBitmapGeometryThatCouldSpanTheWrongPhysicalLabel()
    {
        var wrong = new PackedMonochromeBitmap(799, 600, 100, new byte[60_000]);

        Assert.Throws<ArgumentException>(() => TsplEncoder.EncodePage(wrong, GapFixture()));
    }

    [Fact]
    public async Task OneEncodedPhysicalLabelCrossesOneSpoolSubmissionBoundary()
    {
        var fake = new RecordingRawPrintSpooler();
        var encoded = TsplEncoder.EncodePage(White800By600(), GapFixture());

        var jobId = await fake.SubmitAsync("XP-420B", encoded, "label-1", CancellationToken.None);

        Assert.Equal(73, jobId);
        var submission = Assert.Single(fake.Submissions);
        Assert.Equal("XP-420B", submission.PrinterName);
        Assert.Equal("label-1", submission.DocumentName);
        Assert.Equal(encoded, submission.Document);
        Assert.Single(Regex.Matches(Encoding.Latin1.GetString(submission.Document), "PRINT 1,1"));
    }

    private static PackedMonochromeBitmap White800By600() =>
        new(800, 600, 100, new byte[60_000]);

    private static PrinterProfile GapFixture() => new(
        WidthMillimeters: 100,
        HeightMillimeters: 75,
        WidthDots: 800,
        HeightDots: 600,
        MediaSensing: new GapMediaSensing(HeightMillimeters: 2m, OffsetMillimeters: 0m),
        Direction: 1,
        ReferenceX: 0,
        ReferenceY: 0);

    private sealed class RecordingRawPrintSpooler : IRawPrintSpooler
    {
        public List<Submission> Submissions { get; } = [];

        public Task<int> SubmitAsync(
            string printerName,
            ReadOnlyMemory<byte> document,
            string documentName,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Submissions.Add(new Submission(printerName, document.ToArray(), documentName));
            return Task.FromResult(73);
        }
    }

    private sealed record Submission(string PrinterName, byte[] Document, string DocumentName);
}
