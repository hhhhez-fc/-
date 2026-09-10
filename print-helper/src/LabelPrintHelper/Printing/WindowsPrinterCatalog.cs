using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace LabelPrintHelper.Printing;

public sealed class WindowsPrinterCatalog : IPrinterCatalog
{
    public Task<IReadOnlyList<PrinterDescriptor>> GetPrintersAsync(CancellationToken cancellationToken = default)
    {
        var defaultName = new PrinterSettings().PrinterName;
        var result = new List<PrinterDescriptor>();
        foreach (string name in PrinterSettings.InstalledPrinters)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (status, available) = QueueStatus(name);
            var id = "win-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(name)));
            result.Add(new(id, name, name == defaultName, name.Contains("XP-420B", StringComparison.OrdinalIgnoreCase), status, available));
        }
        return Task.FromResult<IReadOnlyList<PrinterDescriptor>>(result);
    }
    private static (string Status, bool Available) QueueStatus(string name)
    {
        if (!OpenPrinter(name, out var handle, IntPtr.Zero)) return ("unavailable", false);
        try
        {
            var buffer = Marshal.AllocHGlobal(sizeof(uint));
            try
            {
                if (!GetPrinter(handle, 6, buffer, sizeof(uint), out _)) return ("unknown", false);
                var flags = unchecked((uint)Marshal.ReadInt32(buffer));
                if ((flags & 0x80) != 0) return ("offline", false);
                if ((flags & 1) != 0) return ("paused", false);
                if ((flags & (2 | 8 | 16 | 64 | 0x800 | 0x1000 | 0x40000 | 0x100000 | 0x200000 | 0x400000)) != 0) return ("error", false);
                return flags == 0 ? ("ready", true) : ("busy", true);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { _ = ClosePrinter(handle); }
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPrinter(IntPtr printer, uint level, IntPtr buffer, uint size, out uint needed);
    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinter(IntPtr printer);
}
