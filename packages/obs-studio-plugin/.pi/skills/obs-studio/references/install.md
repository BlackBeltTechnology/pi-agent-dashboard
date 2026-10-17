# Install, adopt, provision

`pi-obs doctor` detects OBS first; an installed OBS ≥ 28 is adopted as-is (never reinstalled or moved).

| OS | `pi-obs install` plan | Notes |
|---|---|---|
| macOS | `brew install --cask obs` → `/Applications` | The virtual camera only activates from `/Applications` (a copy in `~/Applications` is usable but doctor warns). No `brew` → manual obsproject.com instruction. Allow the camera system extension when macOS asks (macOS 15+: Login Items & Extensions → Camera Extensions). |
| Windows | `winget install --id OBSProject.OBSStudio -e`, or `--portable` | Portable = GitHub release zip verified against the asset's published SHA-256, extracted to `~/.pi/dashboard/plugins/obs-studio/apps/obs/` + `portable_mode.txt`; zip-slip and symlink entries refuse the whole archive. |
| Linux | `flatpak install --user flathub com.obsproject.Studio` | per-user |

Nothing downloads or installs without confirmation; non-interactive runs need `--yes` (ask the user first).

## Architecture check (macOS)

`lipo -archs /Applications/OBS.app/Contents/MacOS/OBS` — `arm64` is native. The AI background-removal
plugin does not support Rosetta; an Intel-only OBS must be reinstalled natively (scenes survive).

## obs-websocket

Ships inside OBS ≥ 28. `pi-obs provision` handles it:

- OBS **stopped** and websocket disabled → config backed up (0600, 3 kept), written with auth + a
  24-character password, verified by re-reading, password stored via `service secret set` on stdin;
  failure restores the backup.
- OBS **running** and websocket disabled → no file write (OBS rewrites the config on exit). The user
  enables it in Tools → WebSocket Server Settings, then re-runs `provision`.
- Existing password → imported only after explicit consent; shorter than 8 characters is warned and
  rotation offered.

Config: macOS `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`,
Windows `%APPDATA%\obs-studio\…`, Linux `~/.config/obs-studio/…` (flatpak
`~/.var/app/com.obsproject.Studio/config/obs-studio/…`).

## AI background removal (optional)

Plugin: royshil/obs-backgroundremoval (OBS ≥ 31.1.1, native build). Install its `.pkg`/installer,
fully quit and reopen OBS (plugins load only at startup). It registers the filter kind
`background_removal`; `preset apply pip-bgremoval` reports `plugin-missing` until it loads.
