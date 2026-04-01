using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CursorChatBrowser.Services;

public class WorkspacePathResolver
{
    private string? _overridePath;

    public void SetOverridePath(string path) => _overridePath = ExpandTildePath(path);
    public string? GetOverridePath() => _overridePath;

    public string Resolve()
    {
        if (!string.IsNullOrWhiteSpace(_overridePath))
            return _overridePath;

        var envPath = Environment.GetEnvironmentVariable("WORKSPACE_PATH");
        if (!string.IsNullOrWhiteSpace(envPath))
            return ExpandTildePath(envPath);

        return GetDefaultPath();
    }

    public static string GetDefaultPath()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return Path.Combine(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage");

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            return Path.Combine(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage");

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            if (IsWsl())
            {
                var username = GetWindowsUsername() ?? Environment.UserName;
                return $"/mnt/c/Users/{username}/AppData/Roaming/Cursor/User/workspaceStorage";
            }

            var isRemote = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SSH_CONNECTION"))
                        || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("SSH_CLIENT"));
            if (isRemote)
                return Path.Combine(home, ".cursor-server", "data", "User", "workspaceStorage");

            return Path.Combine(home, ".config", "Cursor", "User", "workspaceStorage");
        }

        return Path.Combine(home, "workspaceStorage");
    }

    public static string ExpandTildePath(string inputPath)
    {
        if (inputPath.StartsWith("~/"))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, inputPath[2..]);
        }
        return inputPath;
    }

    private static bool IsWsl()
    {
        try
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return false;
            var release = File.ReadAllText("/proc/version").ToLowerInvariant();
            return release.Contains("microsoft") || release.Contains("wsl");
        }
        catch { return false; }
    }

    private static string? GetWindowsUsername()
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c echo %USERNAME%")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false
            };
            using var proc = Process.Start(psi);
            var output = proc?.StandardOutput.ReadToEnd().Trim();
            proc?.WaitForExit();
            return string.IsNullOrWhiteSpace(output) ? null : output;
        }
        catch { return null; }
    }
}
