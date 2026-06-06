namespace HealingCamp.Updater;

internal sealed class UpdaterOptions
{
    private const string DefaultManifestUrl =
        "https://github.com/MacchiatoR/HealingCampLauncherElectron/releases/download/launcher-v2/manifest.json";

    private static readonly string DefaultInstallRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HealingCamp",
            "LauncherV2");

    public string InstallRoot { get; init; } = DefaultInstallRoot;

    public string? Manifest { get; init; }

    public static UpdaterOptions Parse(string[] args)
    {
        var installRoot = DefaultInstallRoot;
        var manifest = Environment.GetEnvironmentVariable("HEALINGCAMP_MANIFEST_URL") ?? DefaultManifestUrl;

        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--manifest" && i + 1 < args.Length)
            {
                manifest = args[++i];
            }
            else if (args[i] == "--install-root" && i + 1 < args.Length)
            {
                installRoot = args[++i];
            }
        }

        return new UpdaterOptions { InstallRoot = installRoot, Manifest = manifest };
    }
}
