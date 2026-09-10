namespace LabelPrintHelper.Printing;

public abstract record MediaSensing;

public sealed record GapMediaSensing(
    decimal HeightMillimeters,
    decimal OffsetMillimeters) : MediaSensing;

public sealed record BlackMarkMediaSensing(
    decimal HeightMillimeters,
    decimal OffsetMillimeters) : MediaSensing;

public sealed record ContinuousMediaSensing : MediaSensing;

public sealed record PrinterProfile(
    int WidthMillimeters,
    int HeightMillimeters,
    int WidthDots,
    int HeightDots,
    MediaSensing MediaSensing,
    int Direction,
    int ReferenceX,
    int ReferenceY);
