using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace LabelPrintHelper.Security;

public sealed class LoopbackCertificateManager : LabelPrintHelper.Maintenance.IProductCertificateCleanup
{
    public const string ProductMarkerOid = "1.3.6.1.4.1.60796.1.1";
    private const string ProductMarkerValue = "LabelPrintHelper.Localhost.TLS.v1";
    private const string ProductKeyPrefix = "LabelPrintHelper-TLS-";

    public X509Certificate2 EnsureTrustedCertificate()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("本机打印助手仅支持 Windows");
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadWrite);
        var existing = store.Certificates.Cast<X509Certificate2>().FirstOrDefault(IsUsableServerCertificate);
        if (existing is not null)
        {
            EnsureTrustedRoot(existing);
            return existing;
        }

        var keyName = ProductKeyPrefix + Guid.NewGuid().ToString("N");
        var creation = new CngKeyCreationParameters
        {
            Provider = CngProvider.MicrosoftSoftwareKeyStorageProvider,
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing,
        };
        using var key = CngKey.Create(CngAlgorithm.ECDsaP256, keyName, creation);
        using var algorithm = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 };
        var certificate = CreateCertificate(algorithm, DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddYears(3));
        store.Add(certificate);
        EnsureTrustedRoot(certificate);
        return certificate;
    }

    public int RemoveProductCertificates()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        var removed = 0;
        var keyNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in new[] { StoreName.My, StoreName.Root })
        {
            using var store = new X509Store(name, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            foreach (var certificate in store.Certificates.Cast<X509Certificate2>().Where(IsProductCertificate).ToArray())
            {
                using var privateKey = name == StoreName.My ? certificate.GetECDsaPrivateKey() : null;
                if (privateKey is ECDsaCng cngPrivateKey && cngPrivateKey.Key.KeyName is { } keyName)
                {
                    keyNames.Add(keyName);
                }
                store.Remove(certificate);
                certificate.Dispose();
                removed++;
            }
        }
        foreach (var keyName in keyNames)
        {
            try
            {
                using var key = CngKey.Open(keyName, CngProvider.MicrosoftSoftwareKeyStorageProvider, CngKeyOpenOptions.UserKey);
                key.Delete();
            }
            catch (CryptographicException) { }
        }
        return removed;
    }

    public static X509Certificate2 CreateForInspection(DateTimeOffset now)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return CreateCertificate(key, now.AddMinutes(-1), now.AddDays(1));
    }

    public static bool IsProductCertificate(X509Certificate2 certificate) =>
        certificate.Extensions.Cast<X509Extension>().Any(extension =>
            extension.Oid?.Value == ProductMarkerOid &&
            CryptographicOperations.FixedTimeEquals(extension.RawData, Encoding.UTF8.GetBytes(ProductMarkerValue)));

    internal static bool IsUsableServerCertificate(X509Certificate2 certificate)
    {
        var now = DateTime.UtcNow;
        if (!IsProductCertificate(certificate) || !certificate.HasPrivateKey ||
            certificate.NotBefore.ToUniversalTime() > now || certificate.NotAfter.ToUniversalTime() <= now.AddDays(14) ||
            !certificate.SubjectName.RawData.AsSpan().SequenceEqual(certificate.IssuerName.RawData) ||
            certificate.SignatureAlgorithm.Value != "1.2.840.10045.4.3.2" || !HasExactLoopbackServerShape(certificate)) return false;
        try
        {
            using var privateKey = certificate.GetECDsaPrivateKey();
            if (privateKey is not ECDsaCng cng) return false;
            var key = cng.Key;
            return !key.IsEphemeral && key.KeySize == 256 &&
                key.Provider == CngProvider.MicrosoftSoftwareKeyStorageProvider &&
                key.ExportPolicy == CngExportPolicies.None && key.KeyUsage == CngKeyUsages.Signing &&
                key.KeyName?.StartsWith(ProductKeyPrefix, StringComparison.Ordinal) == true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    internal static bool HasExactLoopbackServerShape(X509Certificate2 certificate)
    {
        try
        {
            var constraints = certificate.Extensions.OfType<X509BasicConstraintsExtension>().SingleOrDefault();
            if (constraints is null || !constraints.Critical || constraints.CertificateAuthority || constraints.HasPathLengthConstraint) return false;
            var keyUsage = certificate.Extensions.OfType<X509KeyUsageExtension>().SingleOrDefault();
            if (keyUsage is null || !keyUsage.Critical || keyUsage.KeyUsages != X509KeyUsageFlags.DigitalSignature) return false;
            var enhancedKeyUsage = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>().SingleOrDefault();
            if (enhancedKeyUsage is null || !enhancedKeyUsage.Critical || enhancedKeyUsage.EnhancedKeyUsages.Count != 1 ||
                enhancedKeyUsage.EnhancedKeyUsages[0]!.Value != "1.3.6.1.5.5.7.3.1") return false;
            var rawSan = certificate.Extensions["2.5.29.17"];
            if (rawSan is null) return false;
            var san = new X509SubjectAlternativeNameExtension(rawSan.RawData, rawSan.Critical);
            var dnsNames = san.EnumerateDnsNames().ToArray();
            var addresses = san.EnumerateIPAddresses().ToArray();
            return dnsNames.Length == 1 && dnsNames[0] == "localhost" &&
                addresses.Length == 1 && addresses[0].Equals(IPAddress.Loopback);
        }
        catch (Exception exception) when (exception is CryptographicException or InvalidOperationException)
        {
            return false;
        }
    }

    private static X509Certificate2 CreateCertificate(ECDsa key, DateTimeOffset notBefore, DateTimeOffset notAfter)
    {
        var request = new CertificateRequest("CN=localhost, O=Label Print Helper", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, critical: true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, critical: true));
        var usages = new OidCollection { new("1.3.6.1.5.5.7.3.1", "TLS Web Server Authentication") };
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages, critical: true));
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(san.Build(critical: false));
        request.CertificateExtensions.Add(new X509Extension(new Oid(ProductMarkerOid, "Label Print Helper product marker"), Encoding.UTF8.GetBytes(ProductMarkerValue), critical: false));
        return request.CreateSelfSigned(notBefore, notAfter);
    }

    private static void EnsureTrustedRoot(X509Certificate2 certificate)
    {
        using var root = new X509Store(StoreName.Root, StoreLocation.CurrentUser);
        root.Open(OpenFlags.ReadWrite);
        if (root.Certificates.Cast<X509Certificate2>().Any(existing => existing.Thumbprint == certificate.Thumbprint)) return;
        using var publicCertificate = X509CertificateLoader.LoadCertificate(certificate.Export(X509ContentType.Cert));
        root.Add(publicCertificate);
    }
}
