## Why

The craft-web editors (WordCraft today) are pinned to the registry's verified web version (`webVersion: "0.8.0"`). The `craft-binary-provisioning` spec forbids web builds from ever following the latest release. Users who want ArtCraft's newer WordCraft releases must find each tag themselves and set `WORDCRAFT_WEB_VERSION=<ver>`. Electron users have no easy way to set env vars. There is no opt-in way to track new releases.

## What Changes

- New opt-in **latest channel** for web builds. Pinned stays the default.
  - Plugin setting `plugins["craft-web"].apps.<app>.version`: `"pinned"` (default) | `"latest"`.
  - Env `<APP>_WEB_VERSION=latest` (case-insensitive) selects latest. Works for CLI and plugin.
- `provisionWeb` gains `channel?: "pinned" | "latest"`. Resolution: `<APP>_WEB_DIR` → explicit `<APP>_WEB_VERSION` → latest (when selected) → registry `webVersion`.
- Latest lookup: GitHub `releases/latest`. Counts only when that release has `<app>-web-<ver>.zip`. Cached 24 h in `<web root>/<app>-web/latest.json`. Fallback: newest installed tree for the current shim version, then the registry pin. A warning is logged.
- New web report sources: `latest`, `latest-cached`, `fallback-installed`.
- New export `latestWebVersion(app, opts)`: metadata only, never downloads.
- craft-web plugin `status` in latest mode:
  - starts a background metadata refresh (single-flight, 24 h cache);
  - a known newer version than the prepared build → `not-prepared` with that version (Download gate = update);
  - a failed update keeps the prepared build usable (`ok`).
  - Status rows gain `channel`, `installedVersion` (prepared build) and `latestVersion` (known latest).
- **Settings page section** (`settings-section` claim `CraftWebSettings`, Settings → Plugins → Craft Web Editors): per claimed app an enable switch, a Pinned/Latest version selector (both saved through the host Save Bar via `plugin_config_write`), installed / latest version, status pill, and a Download/Update button (immediate `POST .../prepare/:app`, disabled while unsaved edits exist).

## Capabilities

### Modified Capabilities
- `craft-binary-provisioning`: "Web build provisioning" allows an opt-in latest channel. "Provisioning report" lists the new web sources.
- `craft-web-editor`: "Builds are prepared only on authenticated request and served read-only" gains the per-app version channel and update behavior.

## Impact

- Code:
  - `packages/craft-apps/src/provision.ts`: `provisionWeb`, `resolveWebSource` (now async), `latestWebVersion`;
  - `packages/craft-web-plugin/src/server/{config.ts,service.ts}`, `configSchema.json`;
  - tests, AGENTS.md rows, `docs/craft-apps.md` §3b, `docs/craft-web-plugin.md`.
- Client: new `src/client/CraftWebSettings.tsx` + manifest claim + i18n keys (en/zh-CN/hu); `status-types.ts` parses the new status fields. The editor Download gate is unchanged and shows the new version.
- Compatibility: default behavior is unchanged (pinned). The existing `<APP>_WEB_VERSION=<ver>` pin keeps working.
- Risk: latest builds are not verified against the host shim. A release whose bootstrap shape breaks `postInstall` fails as `extract-failed`, and the previous build stays served. SHA256SUMS verification, the zip guard and the CSP are unchanged.
- Rollback: set `version: "pinned"` or unset the env. Revert the change to restore pin-only. Cached trees and `latest.json` are inert.

## Discipline Skills

- `security-hardening` — the supply-chain trust basis widens from one pinned, verified bundle to any future release. Checksum, zip guard, sandbox and CSP must stay fail-closed.
- `review-code` — before commit.
- UI: follows the shared settings field kit (`SettingsGroup`/`ToggleField`/`SelectField`/`SettingsStatusPill`) like `QuotaSettings`; a11y via the kit (labels, `role=switch`).
