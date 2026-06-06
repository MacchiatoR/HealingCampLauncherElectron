using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace HealingCamp.Updater;

internal sealed class LauncherUpdater
{
    private readonly UpdaterOptions options;
    private readonly HttpClient httpClient = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public LauncherUpdater(UpdaterOptions options)
    {
        this.options = options;
    }

    public async Task RunAsync(IProgress<UpdaterProgress> progress, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(options.InstallRoot);
        Directory.CreateDirectory(VersionsPath);
        Directory.CreateDirectory(PackagesPath);

        progress.Report(new UpdaterProgress("업데이트 확인", "런처 manifest를 확인합니다.", 0));

        if (!string.IsNullOrWhiteSpace(options.Manifest))
        {
            var manifest = await LoadManifestAsync(options.Manifest, cancellationToken);
            var current = LoadCurrentLauncher();

            if (current?.Version != manifest.Version)
            {
                await InstallVersionAsync(manifest, progress, cancellationToken);
            }
        }

        progress.Report(new UpdaterProgress("런처 실행", "최신 런처를 시작합니다.", 100));
        LaunchCurrent();
    }

    private string VersionsPath => Path.Combine(options.InstallRoot, "versions");
    private string PackagesPath => Path.Combine(options.InstallRoot, "packages");
    private string CurrentPath => Path.Combine(options.InstallRoot, "current.json");

    private async Task<LauncherManifest> LoadManifestAsync(string manifestLocation, CancellationToken cancellationToken)
    {
        await using Stream stream = await OpenReadAsync(manifestLocation, cancellationToken);
        var manifest = await JsonSerializer.DeserializeAsync<LauncherManifest>(stream, cancellationToken: cancellationToken);
        if (manifest is null)
        {
            throw new InvalidOperationException("manifest를 읽을 수 없습니다.");
        }

        return manifest;
    }

    private async Task InstallVersionAsync(
        LauncherManifest manifest,
        IProgress<UpdaterProgress> progress,
        CancellationToken cancellationToken)
    {
        var packagePath = Path.Combine(PackagesPath, $"launcher-{manifest.Version}.zip");
        progress.Report(new UpdaterProgress("다운로드", $"런처 {manifest.Version} 다운로드 중", 0));
        await DownloadAsync(manifest.PackageUrl, packagePath, progress, cancellationToken);

        progress.Report(new UpdaterProgress("검증", "다운로드한 파일을 검증합니다.", 100));
        await VerifySha256Async(packagePath, manifest.Sha256, cancellationToken);

        var stagingPath = Path.Combine(options.InstallRoot, "staging", $"{manifest.Version}-{Guid.NewGuid():N}");
        var finalPath = Path.Combine(VersionsPath, manifest.Version);
        Directory.CreateDirectory(stagingPath);

        progress.Report(new UpdaterProgress("압축 해제", "새 런처 파일을 준비합니다.", 0));
        await ExtractZipSafeAsync(packagePath, stagingPath, progress, cancellationToken);

        var entrypointPath = Path.Combine(stagingPath, manifest.Entrypoint);
        if (!File.Exists(entrypointPath))
        {
            throw new FileNotFoundException("manifest entrypoint가 패키지에 없습니다.", entrypointPath);
        }

        if (Directory.Exists(finalPath))
        {
            Directory.Delete(finalPath, recursive: true);
        }

        Directory.Move(stagingPath, finalPath);
        var current = new CurrentLauncher
        {
            Version = manifest.Version,
            Entrypoint = manifest.Entrypoint
        };
        await File.WriteAllTextAsync(CurrentPath, JsonSerializer.Serialize(current, JsonOptions), cancellationToken);
    }

    private CurrentLauncher? LoadCurrentLauncher()
    {
        if (!File.Exists(CurrentPath))
        {
            return null;
        }

        var json = File.ReadAllText(CurrentPath);
        return JsonSerializer.Deserialize<CurrentLauncher>(json);
    }

    private void LaunchCurrent()
    {
        var current = LoadCurrentLauncher();
        if (current is null)
        {
            throw new InvalidOperationException("설치된 런처가 없습니다. manifest를 지정해 먼저 설치해야 합니다.");
        }

        var launcherPath = Path.Combine(VersionsPath, current.Version, current.Entrypoint);
        if (!File.Exists(launcherPath))
        {
            throw new FileNotFoundException("현재 런처 실행 파일을 찾을 수 없습니다.", launcherPath);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = launcherPath,
            WorkingDirectory = Path.GetDirectoryName(launcherPath)!,
            UseShellExecute = false
        });
    }

    private async Task DownloadAsync(
        string source,
        string destination,
        IProgress<UpdaterProgress> progress,
        CancellationToken cancellationToken)
    {
        await using var sourceStream = await OpenReadAsync(source, cancellationToken);
        await using var destinationStream = File.Create(destination);
        var buffer = new byte[1024 * 128];
        long totalRead = 0;
        var canReportSize = TryGetLocalFileLength(source, out var totalBytes);

        while (true)
        {
            var read = await sourceStream.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            await destinationStream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            totalRead += read;

            if (canReportSize && totalBytes > 0)
            {
                var percent = (int)Math.Clamp(totalRead * 100 / totalBytes, 0, 100);
                progress.Report(new UpdaterProgress("다운로드", "런처 파일 다운로드 중", percent));
            }
        }

        progress.Report(new UpdaterProgress("다운로드", "런처 파일 다운로드 완료", 100));
    }

    private async Task<Stream> OpenReadAsync(string location, CancellationToken cancellationToken)
    {
        if (Uri.TryCreate(location, UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return await httpClient.GetStreamAsync(uri, cancellationToken);
        }

        var path = location.StartsWith("file://", StringComparison.OrdinalIgnoreCase)
            ? new Uri(location).LocalPath
            : location;
        return File.OpenRead(path);
    }

    private static bool TryGetLocalFileLength(string location, out long length)
    {
        length = 0;
        try
        {
            var path = location.StartsWith("file://", StringComparison.OrdinalIgnoreCase)
                ? new Uri(location).LocalPath
                : location;
            if (!File.Exists(path))
            {
                return false;
            }

            length = new FileInfo(path).Length;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task VerifySha256Async(string filePath, string expectedHash, CancellationToken cancellationToken)
    {
        await using var file = File.OpenRead(filePath);
        var hash = await SHA256.HashDataAsync(file, cancellationToken);
        var actualHash = Convert.ToHexString(hash).ToLowerInvariant();
        if (!string.Equals(actualHash, expectedHash.ToLowerInvariant(), StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"sha256 검증 실패: expected={expectedHash}, actual={actualHash}");
        }
    }

    private static async Task ExtractZipSafeAsync(
        string zipPath,
        string destination,
        IProgress<UpdaterProgress> progress,
        CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        var entries = archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)).ToList();
        for (var i = 0; i < entries.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = entries[i];
            var targetPath = Path.GetFullPath(Path.Combine(destination, entry.FullName));
            var destinationRoot = Path.GetFullPath(destination);

            if (!targetPath.StartsWith(destinationRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"잘못된 zip 경로: {entry.FullName}");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            entry.ExtractToFile(targetPath, overwrite: true);
            var percent = (int)Math.Clamp((i + 1) * 100 / Math.Max(entries.Count, 1), 0, 100);
            progress.Report(new UpdaterProgress("압축 해제", "새 런처 파일 준비 중", percent));
            await Task.Yield();
        }
    }
}

internal sealed record UpdaterProgress(string Title, string Detail, int Percent);
