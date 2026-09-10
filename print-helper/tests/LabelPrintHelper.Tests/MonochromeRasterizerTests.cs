using System.Drawing;
using System.Drawing.Imaging;
using LabelPrintHelper.Printing;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Tests;

public sealed class MonochromeRasterizerTests
{
    [Fact]
    public void Pack_PacksEightHorizontalPixelsMostSignificantBitFirst()
    {
        var packed = MonochromeRasterizer.Pack(
            [true, false, true, false, false, false, false, true],
            widthDots: 8,
            heightDots: 1);

        Assert.Equal(1, packed.BytesPerRow);
        Assert.Equal(new byte[] { 0b1010_0001 }, packed.Data);
    }

    [Fact]
    public void Pack_PadsEachNonByteAlignedRowWithoutCarryingPixelsIntoTheNextRow()
    {
        var packed = MonochromeRasterizer.Pack(
            [
                true, false, false, false, false, false, false, false, true, false,
                false, true, false, false, false, false, false, false, false, true,
            ],
            widthDots: 10,
            heightDots: 2);

        Assert.Equal(2, packed.BytesPerRow);
        Assert.Equal(new byte[] { 0b1000_0000, 0b1000_0000, 0b0100_0000, 0b0100_0000 }, packed.Data);
    }

    [Fact]
    public void Rasterize_DecodesPngCompositesAlphaOntoWhiteAndUsesTrueForBlackDots()
    {
        using var bitmap = new Bitmap(800, 600, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.White);
        }
        bitmap.SetPixel(0, 0, Color.FromArgb(255, 0, 0, 0));
        bitmap.SetPixel(1, 0, Color.FromArgb(255, 255, 255, 255));
        bitmap.SetPixel(2, 0, Color.FromArgb(0, 0, 0, 0));
        bitmap.SetPixel(3, 0, Color.FromArgb(128, 0, 0, 0));

        var packed = MonochromeRasterizer.Rasterize(CreateAsset(ToPngBase64(bitmap)), threshold: 127);

        Assert.Equal(800, packed.WidthDots);
        Assert.Equal(600, packed.HeightDots);
        Assert.Equal(100, packed.BytesPerRow);
        Assert.Equal(60_000, packed.Data.Length);
        Assert.Equal(0b1001_0000, packed.Data[0]);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(256)]
    public void Rasterize_RejectsThresholdOutsideByteRange(int threshold)
    {
        var exception = Assert.Throws<ArgumentOutOfRangeException>(() =>
            MonochromeRasterizer.Rasterize(CreateAsset("not-used"), threshold));

        Assert.Equal("threshold", exception.ParamName);
    }

    [Fact]
    public void Rasterize_RejectsNonPngPayloadBeforeDecoding()
    {
        var asset = CreateAsset(Convert.ToBase64String("not a png"u8));

        Assert.Throws<InvalidDataException>(() => MonochromeRasterizer.Rasterize(asset, 127));
    }

    [Fact]
    public void Rasterize_RejectsCorruptPngPayload()
    {
        var corruptPng = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0 };
        var asset = CreateAsset(Convert.ToBase64String(corruptPng));

        Assert.Throws<InvalidDataException>(() => MonochromeRasterizer.Rasterize(asset, 127));
    }

    [Fact]
    public void Rasterize_RejectsDecodedDimensionsOtherThanEightHundredBySixHundred()
    {
        using var bitmap = new Bitmap(1, 1, PixelFormat.Format32bppArgb);
        bitmap.SetPixel(0, 0, Color.Black);

        var exception = Assert.Throws<InvalidDataException>(() =>
            MonochromeRasterizer.Rasterize(CreateAsset(ToPngBase64(bitmap)), 127));

        Assert.Contains("800", exception.Message, StringComparison.Ordinal);
        Assert.Contains("600", exception.Message, StringComparison.Ordinal);
    }

    private static PrintAssetUpload CreateAsset(string pngBase64) => new(
        AssetId: "asset-1",
        LabelId: "label-1",
        WidthDots: 800,
        HeightDots: 600,
        Rotation: 0,
        PngBase64: pngBase64,
        Sha256: new string('a', 64));

    private static string ToPngBase64(Bitmap bitmap)
    {
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return Convert.ToBase64String(stream.ToArray());
    }
}
