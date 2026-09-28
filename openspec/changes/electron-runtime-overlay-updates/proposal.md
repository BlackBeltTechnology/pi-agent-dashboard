## Why

The Electron app can only change its dashboard runtime (server, web client, bridge extension, first-party plugins, and the pi/openspec/tsx they depend on) by replacing the whole app through `electron-updater`. `eliminate-electron-runtime-install` made that trade on purpose, but in practice every server or plugin fix now needs a full signed app release, and developers cannot run a local checkout inside the packaged Electron shell. We need a writable **runtime overlay** next to the read-only bundle. The bundle stays untouched and is always the last fallback.

## What Changes

- **Runtime overlay**: Electron can run the dashboard runtime from `~/.pi/dashboard/runtime/` instead of `<resourcesPath>/server/`. The unit of update is one **locked runtime release** X. A `runtime-lock.json`, shipped inside `@blackbelt-technology/pi-dashboard-server@X`, pins the server, web, extension, first-party plugins and pi/openspec/tsx exactly, so installs are deterministic. Every published package is already versioned in lockstep.
- **Selectable update source** (Settings → Updates; local folder from the app menu), persisted under `~/.pi/dashboard/runtime/` (one file written by the server, one by Electron):
  - `bundled`: no overlay (default; today's behaviour).
  - `npm`: install runtime release X from the configured npm registry.
  - `github`: download the runtime release asset attached to the GitHub Release `vX` and verify its sha512.
  - `local`: **link mode only**. Run in place from a local monorepo checkout (server, `packages/client/dist`, `packages/extension`, plugins). Nothing is copied. The folder is set **only from the Electron app menu** (native folder picker). The server API is read-only for local.
- **Channels** for `npm` and `github`: `stable`, `beta`, or a pinned exact version.
- **Staged install + Electron-owned activation**: the server stages version X into `runtime/versions/<X>/` (`npm ci` from the lock, or the GitHub asset, then materializes first-party plugins) and marks it `pending`. Activation writes a nonce to `request.json`. Electron main watches that file, stops the server, re-resolves the launch source, spawns X, runs a health check, and on success commits it as `current` while keeping the previous version. This is a new server → Electron path; nothing like it exists today.
- **Automatic rollback**: if the overlay runtime fails compatibility checks, preflight, or the health deadline, Electron marks it `bad`, falls back to the previous version (or the bundle), and tells the user why.
- **Compatibility gate**: every runtime declares the minimum shell version and the Node major version it needs. The shell refuses a runtime it cannot host and shows "requires app update".
- **Bridge extension follows the runtime**: after the health check passes, `~/.pi/agent/settings.json` is re-pointed at the active runtime's extension, and pi sessions are **auto-reloaded**: the server reloads any bridge whose extension identity differs from the active runtime's, including bridges that reconnect late. Rollback re-points it back.
- **pi/openspec/tsx follow the runtime release** for users who opt in. This deliberately reverses, for the overlay only, the `eliminate-electron-runtime-install` rule that pi bumps ride app releases.
- `/api/runtime/*` mutating routes are Electron-only (403 for Standalone/Bridge).
- `devMonorepo` (unpackaged `electron .`) is **unchanged** and stays a separate mechanism.
- Third-party recommended pi extensions (e.g. `pi-subagents`) keep their **existing pi-install update path**. They are not part of a runtime release.
- `/api/health` gains a `runtime` block (`origin`, `version`, `updatable`, …) that drives only the new Updates UI. Existing pi-core in-place update gates are unchanged, and `add-bundle-immutable-health-flag` is unaffected (an orthogonal concept).

## Capabilities

### New Capabilities

- `electron-runtime-overlay`: runtime release unit, overlay layout and state file, source/channel selection, staging, activation, compatibility gate, health-gated commit, rollback, bridge-extension re-pointing, local-folder link mode and its trust boundary, and the related REST/WS surface.

### Modified Capabilities

- `electron-launch-source`: adds the `overlay` and `localLink` launch-source kinds and where they rank relative to `bundled`.
- `dashboard-starter-identity`: `/api/health` exposes the active runtime (`origin`, `version`, `updatable`), and Electron update routing covers runtime updates as well as whole-app updates.

## Discipline Skills

- `security-hardening`: the change downloads and runs code (npm, GitHub asset) and runs arbitrary local code (local link). This covers lockfile and sha512 integrity, a fixed package allowlist, the Electron-only local-path rule, and Electron-only mutating routes.
- `doubt-driven-review`: the change partly reverses the one-way `eliminate-electron-runtime-install` decision and re-points pi's global `settings.json`. Review it before the design stands.
- `observability-instrumentation`: new external calls (registry, GitHub) and a launch-time activation/rollback state machine that needs structured log lines and user-visible reasons.
- `performance-optimization`: not triggered (no latency budget; the activation check runs once per launch).

## Impact

- **Electron** (`packages/electron/src/lib/`): `launch-source.ts` (new kinds + precedence), new `runtime-overlay.ts` (state, request watcher, activation, rollback, compatibility), `bridge-register.ts` (register the active runtime's extension), `app-menu.ts` (Runtime → Use local folder…), `main.ts` (rollback notice). New `switchRuntime()` in `server-lifecycle.ts` (PID-gated stop, skip-attach, watchdog-aware).
- **Extension** (`packages/extension/`): the bridge reports its extension identity on register.
- **Server** (`packages/server/src/`): new runtime-update checker/stager modelled on `pi-core-checker.ts`/`pi-core-updater.ts`; `/api/runtime/{status,source,update,activate,rollback}` (mutations Electron-only; none can turn local on); `/api/health` `runtime` block.
- **Client**: Settings → Updates section (source, channel/pin, read-only local path, status, pi version, update/activate/rollback) and a runtime update badge. Existing pi-core gates are unchanged.
- **Release pipeline + build**: generate `runtime-lock.json` into the server package; `piDashboard.bundledPlugins` becomes the single plugin list (`bundle-server.mjs` reads it); publish runtime asset(s) + sha512 to GitHub Releases (shape decided by a spike); publish prereleases under the npm `beta` dist-tag; stamp `minShellVersion` / `nodeEngines`.
- **Network**: npm registry (honours the npm registry config) and api.github.com / release asset download.
- **Disk**: 2× runtime size at steady state (current + previous), 3× peak while staging.
- **Compatibility**: with source `bundled` (the default), behaviour is identical to today. Standalone and Bridge arms are unaffected. `electron-updater` whole-app updates keep working and remain the only way to update the shell and its bundled Node.
- **Rollback of this change**: choose source `bundled` in Settings (this also turns a local folder off), or delete `~/.pi/dashboard/runtime/`. The shell then launches the bundled runtime and re-registers the bundled extension.
