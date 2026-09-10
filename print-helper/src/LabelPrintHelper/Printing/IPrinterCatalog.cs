namespace LabelPrintHelper.Printing;

public sealed record PrinterDescriptor(string Id, string DisplayName, bool IsDefault, bool IsCompatible, string QueueStatus, bool IsAvailable);
public interface IPrinterCatalog
{
    Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default);
}
public interface IVerifiedPrinterProfileProvider
{
    PrinterProfile? GetVerifiedProfile(string printerId, string profileId, string version);
}
public sealed class UnverifiedPrinterProfileProvider : IVerifiedPrinterProfileProvider
{
    public PrinterProfile? GetVerifiedProfile(string printerId, string profileId, string version) => null;
}
