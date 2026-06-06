using System.Text.Json.Serialization;

namespace HealingCamp.Updater;

internal sealed class LauncherManifest
{
    [JsonPropertyName("version")]
    public required string Version { get; init; }

    [JsonPropertyName("packageUrl")]
    public required string PackageUrl { get; init; }

    [JsonPropertyName("sha256")]
    public required string Sha256 { get; init; }

    [JsonPropertyName("entrypoint")]
    public string Entrypoint { get; init; } = "HealingCampLauncher.exe";
}

internal sealed class CurrentLauncher
{
    [JsonPropertyName("version")]
    public required string Version { get; init; }

    [JsonPropertyName("entrypoint")]
    public required string Entrypoint { get; init; }
}
