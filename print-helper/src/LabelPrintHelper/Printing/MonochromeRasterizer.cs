using System.Drawing;
using System.Runtime.InteropServices;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Printing;

public sealed record PackedMonochromeBitmap(
    int WidthDots,
    int HeightDots,
    int BytesPerRow,
    byte[] Data);

public static class MonochromeRasterizer
{
    private const int RequiredWidthDots = 800;
    private const int RequiredHeightDots = 600;

    private static ReadOnlySpan<byte> PngSignature => [137, 80, 78, 71, 13, 10, 26, 10];

    public static PackedMonochromeBitmap Rasterize(PrintAssetUpload asset, int threshold)
    {
        ArgumentNullException.ThrowIfNull(asset);
        ArgumentOutOfRangeException.ThrowIfNegative(threshold);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(threshold, byte.MaxValue);

        byte[] pngBytes;
        try
        {
            pngBytes = Convert.FromBase64String(asset.PngBase64 ?? string.Empty);
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException("打印资产不是有效的 PNG 图像", exception);
        }

        if (!pngBytes.AsSpan().StartsWith(PngSignature))
        {
            throw new InvalidDataException("打印资产必须是 PNG 图像");
        }

        try
        {
            using var stream = new MemoryStream(pngBytes, writable: false);
            using var bitmap = new Bitmap(stream, useIcm: false);
            if (bitmap.Width != RequiredWidthDots || bitmap.Height != RequiredHeightDots)
            {
                throw new InvalidDataException("打印资产解码后必须为 800 × 600 dots");
            }

            var blackDots = new bool[RequiredWidthDots * RequiredHeightDots];
            for (var y = 0; y < RequiredHeightDots; y++)
            {
                for (var x = 0; x < RequiredWidthDots; x++)
                {
                    var color = bitmap.GetPixel(x, y);
                    var red = CompositeOntoWhite(color.R, color.A);
                    var green = CompositeOntoWhite(color.G, color.A);
                    var blue = CompositeOntoWhite(color.B, color.A);
                    var luminance = ((299 * red) + (587 * green) + (114 * blue) + 500) / 1000;
                    blackDots[(y * RequiredWidthDots) + x] = luminance <= threshold;
                }
            }

            return Pack(blackDots, RequiredWidthDots, RequiredHeightDots);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception exception) when (exception is ArgumentException or ExternalException)
        {
            throw new InvalidDataException("打印资产 PNG 解码失败", exception);
        }
    }

    public static PackedMonochromeBitmap Pack(
        IReadOnlyList<bool> blackDots,
        int widthDots,
        int heightDots)
    {
        ArgumentNullException.ThrowIfNull(blackDots);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(widthDots);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(heightDots);
        if (blackDots.Count != checked(widthDots * heightDots))
        {
            throw new ArgumentException("黑白像素数量与图像尺寸不匹配", nameof(blackDots));
        }

        var bytesPerRow = checked((widthDots + 7) / 8);
        var data = new byte[checked(bytesPerRow * heightDots)];
        for (var y = 0; y < heightDots; y++)
        {
            for (var x = 0; x < widthDots; x++)
            {
                if (blackDots[(y * widthDots) + x])
                {
                    data[(y * bytesPerRow) + (x / 8)] |= (byte)(0x80 >> (x % 8));
                }
            }
        }

        return new PackedMonochromeBitmap(widthDots, heightDots, bytesPerRow, data);
    }

    private static int CompositeOntoWhite(byte channel, byte alpha) =>
        ((channel * alpha) + (byte.MaxValue * (byte.MaxValue - alpha)) + 127) / byte.MaxValue;
}
