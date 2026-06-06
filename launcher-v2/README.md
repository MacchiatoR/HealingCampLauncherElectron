# HealingCamp Launcher V2

This is the new two-process launcher architecture.

## Process Model

```text
HealingCamp.exe       -> small updater/bootstrapper
installed launcher    -> actual Electron launcher with splash/login/game UI
```

The updater starts first. It checks a manifest, downloads a versioned launcher zip,
verifies SHA-256, extracts it under LocalAppData, updates `current.json`, and then
starts the real launcher.

By default it checks:

```text
https://github.com/MacchiatoR/HealingCampLauncherElectron/releases/download/launcher-v2/manifest.json
```

`HEALINGCAMP_MANIFEST_URL` or `--manifest` can override that URL for local tests.

## Runtime Layout

```text
%LOCALAPPDATA%\HealingCamp\LauncherV2\
  current.json
  packages\
    launcher-0.1.0.zip
  versions\
    0.1.0\
      HealingCampLauncher.exe
      resources\
```

## Updater Manifest

```json
{
  "version": "0.1.0",
  "packageUrl": "https://example.com/launcher-0.1.0.zip",
  "sha256": "hex sha256",
  "entrypoint": "HealingCampLauncher.exe"
}
```

## Commands

Build updater:

```powershell
dotnet build launcher-v2\updater\HealingCamp.Updater.csproj
```

Run launcher shell in development:

```powershell
cd launcher-v2\launcher
npm run dev
```

Build the real launcher payload:

```powershell
cd launcher-v2\launcher
npm install
npm run pack:dir
```

Run updater against a local manifest:

```powershell
launcher-v2\updater\bin\Debug\net9.0-windows\HealingCamp.exe --manifest C:\path\to\manifest.json
```

Create a local launcher release zip and manifest:

```powershell
launcher-v2\tools\package-launcher.ps1 `
  -Version 0.1.0 `
  -LauncherDir launcher-v2\launcher\dist\win-unpacked `
  -Entrypoint HealingCampLauncher.exe `
  -OutputDir C:\tmp\healingcamp-v2-release
```

## Design Notes

- The updater should stay small and rarely change.
- The real launcher owns Minecraft login, game launch, mods, settings, and UI.
- Launcher updates should be user-writable under LocalAppData to avoid UAC.
- The updater can show the update progress before the real launcher process starts.
- The real launcher does not use `electron-updater`; update checks belong to the updater process.
