param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$LauncherDir,

  [string]$Entrypoint = "HealingCampLauncher.exe",

  [string]$OutputDir = ".\release"
)

$ErrorActionPreference = "Stop"

$launcherPath = Resolve-Path -LiteralPath $LauncherDir
if (-not (Test-Path -LiteralPath (Join-Path $launcherPath $Entrypoint))) {
  throw "Entrypoint not found: $Entrypoint"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$resolvedOutput = Resolve-Path -LiteralPath $OutputDir
$zipPath = Join-Path $resolvedOutput "launcher-$Version.zip"
$manifestPath = Join-Path $resolvedOutput "manifest.json"

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $launcherPath "*") -DestinationPath $zipPath -Force
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = [ordered]@{
  version = $Version
  packageUrl = $zipPath
  sha256 = $hash
  entrypoint = $Entrypoint
}

$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8

[PSCustomObject]@{
  Manifest = $manifestPath
  Package = $zipPath
  Sha256 = $hash
}
