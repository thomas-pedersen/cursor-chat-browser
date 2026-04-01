using System.Runtime.InteropServices;

namespace CursorChatBrowser.Services;

public class EnvironmentService
{
    public string GetPlatform()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return "win32";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return "darwin";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return "linux";
        return "unknown";
    }

    public string GetUsername() => Environment.UserName;
}
