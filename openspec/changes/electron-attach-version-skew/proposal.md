# Proposal

## Why

When the Electron app starts and a dashboard server already answers on its port, `selectLaunchSource()` attaches to it without comparing versions. A server left running by an older app version (or by a standalone/bridge launch) therefore keeps serving after an app update, with old code and stale in-process state. A field report on 0.10.0 showed the Gmail plugin failing with `Cannot find package 'oauth4webapi'` — the exact failure of the 0.9.0 bundle, while every 0.10.0 artifact (arm64/x64 DMG, runtime tgz) contains and resolves the package. The only existing signal is the Doctor's passive "Attached server version" warning row, which users do not open.

## What Changes

- On the attach arm, the app computes the **expected runtime version**: the version of the runtime it would launch itself (active overlay, else bundle), read from that source's `runtime-manifest.json`. A **read-only** dry resolution produces it, writing no runtime-overlay state. The app compares it with `/api/health.version`.
- **Server launched by an Electron app** (`launchSourceEffective === "electron"`) and the versions differ: modal with **Restart with v<expected>** / **Leave running**. Restart is the default unless the server's boot parent is still alive. Restart goes through the existing in-app launch routine: graceful `/api/shutdown` first. If the old server still answers, the app re-checks its identity, sends SIGTERM then SIGKILL, and confirms the process is gone before spawning (fail-closed). Afterwards it reports the version actually running if a runtime fallback changed it.
- **Zombie AND skewed**: the zombie-adoption modal and the skew modal merge into one modal: **Restart with v<expected>** (default) / **Take ownership** / **Leave running**. A zombie whose version matches keeps today's three-button modal unchanged.
- **Server not launched by Electron** (`standalone`, `bridge`, `bridge-orphaned`, or launch source unknown) and the versions differ: informational modal that reuses the Doctor's fix text for that launch source, with **OK** / **Don't show again for this version pair**. It never stops the server. Dismissals are stored per `(serverVersion, expectedVersion, launchSource)` in a dedicated `~/.pi-dashboard/version-skew-dismissals.json`; a new pair prompts again.
- No prompt when the app is unpackaged, when the expected version is unknown (`devMonorepo`, `localLink`, unreadable manifest, resolution error), or when the server reports no version. Remote mode never reaches the attach arm. `--no-zombie-prompt` also suppresses the skew modals; the decision is still logged.
- The Doctor "Attached server version" row is unchanged: it stays based on the shell version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `electron-launch-source`: adds a read-only resolution of the runtime the app would spawn and its expected version; scopes "record the failure reason" to cold launches.
- `electron-shell`: adds the attach-time version-skew check, the restart and info modals; the zombie-adoption modal gains the merged variant; the force branch of "Idempotent server launch routine" waits for the old PID to be gone (escalating when needed) and never reports a surviving server as started.
- `electron-server-supervision`: "Zombie server detection and adoption" gains the skewed variant, and stopping a zombie is confirmed by a liveness probe (fail-closed).
- `electron-qa-coverage`: adds `_electron` coverage for the skew modals; zombie fixtures follow the bundled manifest version.

## Impact

- `packages/electron/src/main.ts`: the attach arm calls one `evaluateAttachedServer()` (zombie + skew); restart reuses `requestServerLaunch({ force: true })`.
- `packages/electron/src/lib/runtime-overlay.ts` / `runtime-overlay-main.ts`: read-only `peekColdLaunch()` (`planColdLaunch` becomes peek + persist) and `resolveExpectedRuntime()`.
- `packages/electron/src/lib/server-lifecycle.ts`: pure `decideAttachAction()` beside `decideIsZombie()`; `requestServerLaunch` force branch tightened (fixes a latent false `started`).
- `packages/electron/src/lib/zombie-adoption-dialog.ts`: merged / skew / info / outcome dialogs; `stopZombieServer` confirms the PID is gone.
- `packages/shared/src/doctor-core.ts`: extract the suggestion text of `checkAttachedServerVersion` (Doctor output stays byte-identical).
- New file `~/.pi-dashboard/version-skew-dismissals.json`; `dashboard-settings.json` is untouched, so first-run detection is unaffected.
- `tests/e2e-electron/`: the zombie fixture's version must match the expected runtime, and the skew modals get coverage.
- No server, protocol, or client changes; `/api/health` already exposes `version`, `launchSourceEffective`, `pid`.

## Discipline Skills

- `review-code` — non-trivial Electron startup-path change; run before commit.
- `doubt-driven-review` — the restart action kills a running server process; validate the gating (Electron-launched only, packaged only, release versions only) before it stands.
