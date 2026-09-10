namespace LabelPrintHelper.Jobs;

public interface IPrintJobStore
{
    Task<IDisposable> AcquireAsync(string jobId, CancellationToken cancellationToken = default);
    Task<StoredPrintJob?> ReadAsync(string jobId);
    Task SaveAsync(StoredPrintJob job);
    Task<byte[]?> ReadAssetAsync(string jobId, string assetId);
    Task SaveAssetAsync(string jobId, string assetId, byte[] bytes);
    Task DeleteAssetsAsync(string jobId);
    IAsyncEnumerable<string> GetJobIdsAsync();
}
