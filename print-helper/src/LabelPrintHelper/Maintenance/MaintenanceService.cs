using LabelPrintHelper.Security;

namespace LabelPrintHelper.Maintenance;

public interface IProductCertificateCleanup
{
    int RemoveProductCertificates();
}

public sealed record MaintenanceResult(int RemovedCertificates, bool RemovedJobData);

public sealed class MaintenanceService(IProductCertificateCleanup certificates, ProductDataCleaner data)
{
    public Task<MaintenanceResult> CleanupAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var removedData = data.RemoveStagedJobs();
        var removedCertificates = certificates.RemoveProductCertificates();
        return Task.FromResult(new MaintenanceResult(removedCertificates, removedData));
    }
}

public sealed class ProductDataCleaner
{
    private readonly string productRoot;
    public ProductDataCleaner(string productRoot) => this.productRoot = Path.GetFullPath(productRoot);

    public bool RemoveStagedJobs()
    {
        var jobs = Path.GetFullPath(Path.Combine(productRoot, "jobs"));
        if (!jobs.StartsWith(productRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("维护路径超出产品目录");
        if (!Directory.Exists(jobs)) return false;
        if ((File.GetAttributes(jobs) & FileAttributes.ReparsePoint) != 0) throw new IOException("维护目录不能是链接");
        Directory.Delete(jobs, recursive: true);
        return true;
    }
}

public sealed class ProductCertificateCleanup(LoopbackCertificateManager manager) : IProductCertificateCleanup
{
    public int RemoveProductCertificates() => manager.RemoveProductCertificates();
}
