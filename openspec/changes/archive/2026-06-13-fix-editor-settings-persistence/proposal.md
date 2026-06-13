## Why

Each code-server instance gets a deterministic per-cwd `--user-data-dir`
(`~/.pi/dashboard/editors/<sha256(cwd):12>/`), so in principle VS Code's
workspaceStorage already persists open tabs, layout, and scroll state across
restarts. In practice users see a fresh-looking editor every time:

- Workspace Trust dialog re-prompts.
- Open tabs do not auto-restore in the iframe.
- Update / telemetry / welcome banners reappear.
- Dirty buffers occasionally lost because `stop()` SIGKILLs the process group
  2s after SIGTERM — VS Code's hot-exit flush sometimes does not complete.

Fix this with two cheap changes: (1) seed the right `settings.json` keys at
spawn time, (2) extend the graceful-stop window so workspaceStorage flushes.

## What Changes

- Extend `writeVscodeThemeSettings` (rename → `writeVscodeUserSettings`) to
  also seed persistence-related keys:
  - `window.restoreWindows: "all"`
  - `workbench.editor.restoreViewState: true`
  - `files.hotExit: "onExitAndWindowClose"`
  - `security.workspace.trust.enabled: false`
  - `update.mode: "none"`
  - `extensions.autoCheckUpdates: false`
- Continue to merge with existing `settings.json` so user customizations win.
- Increase graceful-stop timeout in `editor-manager.stop()` from 2000 ms to
  5000 ms so VS Code finishes flushing workspaceStorage before SIGKILL.
  (Already satisfied by the keeper sidecar's `STOP_GRACE_MS = 5000`; no
  `killProcess` call remains in `stop()`.)
- Dedup concurrent `start(cwd)` calls so multiple browser tabs/iframes opening
  the same folder (or post-restart heartbeat re-starts) cannot spawn two
  code-servers on one locked `--user-data-dir` (stalled-instance race).
- Harden the client: `EditorView` suppresses a second concurrent
  `/api/editor/start` from the same tab (StrictMode double-mount, rapid
  remount, heartbeat re-start) via an in-flight ref. Defense-in-depth atop the
  server dedup.
- No behavioural change for users who have customized any of the seeded keys
  — existing values pass through unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `editor-manager`: settings seeding contract extended; graceful-stop window
  is 5 s (via keeper); concurrent `start(cwd)` for one folder deduped to a
  single spawn.

## Impact

- `packages/server/src/editor-manager.ts` — `writeVscodeThemeSettings` body
  + `stop()` `killProcess({ timeoutMs })`.
- Existing per-cwd data dirs under `~/.pi/dashboard/editors/<hash>/User/`
  get new keys merged on next spawn; no migration needed.
- No API / protocol / config changes. No client work.
