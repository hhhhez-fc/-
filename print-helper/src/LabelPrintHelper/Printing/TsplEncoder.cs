using System.Globalization;
using System.Text;

namespace LabelPrintHelper.Printing;

public static class TsplEncoder
{
    public static byte[] EncodePage(PackedMonochromeBitmap bitmap, PrinterProfile profile)
    {
        ArgumentNullException.ThrowIfNull(bitmap);
        ArgumentNullException.ThrowIfNull(profile);
        ValidateExactLabelGeometry(bitmap, profile);

        var header = string.Concat(
            $"SIZE {profile.WidthMillimeters} mm,{profile.HeightMillimeters} mm\r\n",
            MediaSensingCommand(profile.MediaSensing),
            $"DIRECTION {profile.Direction}\r\n",
            $"REFERENCE {profile.ReferenceX},{profile.ReferenceY}\r\n",
            "CLS\r\n",
            $"BITMAP 0,0,{bitmap.BytesPerRow},{bitmap.HeightDots},0,");
        var headerBytes = Encoding.ASCII.GetBytes(header);
        var suffixBytes = Encoding.ASCII.GetBytes("\r\nPRINT 1,1\r\n");
        var result = new byte[checked(headerBytes.Length + bitmap.Data.Length + suffixBytes.Length)];
        headerBytes.CopyTo(result, 0);
        bitmap.Data.CopyTo(result, headerBytes.Length);
        suffixBytes.CopyTo(result, headerBytes.Length + bitmap.Data.Length);
        return result;
    }

    private static void ValidateExactLabelGeometry(PackedMonochromeBitmap bitmap, PrinterProfile profile)
    {
        if (profile.WidthMillimeters != 100 || profile.HeightMillimeters != 75
            || profile.WidthDots != 800 || profile.HeightDots != 600)
        {
            throw new ArgumentException("打印机配置必须为 100 × 75 mm、800 × 600 dots", nameof(profile));
        }
        if (bitmap.WidthDots != profile.WidthDots || bitmap.HeightDots != profile.HeightDots
            || bitmap.BytesPerRow != 100 || bitmap.Data.Length != 60_000)
        {
            throw new ArgumentException("打印位图必须为 800 × 600 dots 且每行 100 bytes", nameof(bitmap));
        }
        if (profile.Direction is not (0 or 1))
        {
            throw new ArgumentException("打印方向必须为 0 或 1", nameof(profile));
        }
        if (profile.ReferenceX < 0 || profile.ReferenceY < 0)
        {
            throw new ArgumentException("打印参考点不能为负数", nameof(profile));
        }
    }

    private static string MediaSensingCommand(MediaSensing mediaSensing) => mediaSensing switch
    {
        GapMediaSensing gap when gap.HeightMillimeters > 0 && gap.OffsetMillimeters >= 0 =>
            $"GAP {Format(gap.HeightMillimeters)} mm,{Format(gap.OffsetMillimeters)} mm\r\n",
        BlackMarkMediaSensing blackMark when blackMark.HeightMillimeters > 0 && blackMark.OffsetMillimeters >= 0 =>
            $"BLINE {Format(blackMark.HeightMillimeters)} mm,{Format(blackMark.OffsetMillimeters)} mm\r\n",
        ContinuousMediaSensing => "GAP 0 mm,0 mm\r\n",
        GapMediaSensing or BlackMarkMediaSensing =>
            throw new ArgumentException("介质感应尺寸无效", nameof(mediaSensing)),
        null => throw new ArgumentNullException(nameof(mediaSensing)),
        _ => throw new ArgumentException("不支持的介质感应类型", nameof(mediaSensing)),
    };

    private static string Format(decimal value) => value.ToString("0.###", CultureInfo.InvariantCulture);
}
