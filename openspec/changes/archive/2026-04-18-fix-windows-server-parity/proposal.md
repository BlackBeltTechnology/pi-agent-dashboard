## Why

On Windows, the dashboard server fails to auto-start with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because four separate launchers pass raw Windows paths (e.g. `B:\...\jiti-register.mjs`) to `node --import`, which Node ≥ 20 rejects — it parses the drive letter (`B:`) as a URL protocol. This breaks the `pi install` + `pi` workflow, `pi-dashboard start`, and the Electron app whenever a global `tsx` is absent. A codebase audit surfaced additional Windows gaps in the same surface: `/api/restart` shells out to `sh -c` with `lsof`/`curl`, `findPortHolders` is a no-op because it uses `lsof`, the extension's server launcher discards stderr, and `server.log` is truncated on every retry. These gaps compound: the primary crash is silent (`stdio: "ignore"`), and the diagnostics that would surface it are themselves broken on Windows.

## What Changes

- Convert every `--import` argument to a `file://` URL via `pathToFileURL().href` so Node's ESM loader accepts it on Windows (works identically on Linux/macOS). Affects:
  - `packages/shared/src/resolve-jiti.ts` (`resolveJitiImport`) — used by cli and extension
  - `packages/electron/src/lib/server-lifecycle.ts` (`resolveJitiFromAnchor`) — duplicated electron resolver
  - `packages/server/src/cli.ts` — `tsx` fallback path (`esm/index.mjs`)
- Replace the `sh -c` restart script in `POST /api/restart` with a cross-platform Node-based restart helper (poll port + spawn via `process.execPath` + HTTP health poll). Removes dependency on `sh`, `lsof`, and `curl`.
- Make `findPortHolders` in `packages/server/src/cli.ts` cross-platform (use `netstat -ano` + PID parse on win32; keep `lsof` on Unix). Stale server processes holding the port after a crash are then killable on Windows.
- Harden server-launch diagnostics (fixes silent-failure class observed on Windows but beneficial everywhere):
  - `packages/extension/src/server-launcher.ts`: capture stderr to `~/.pi/dashboard/server.log` instead of `stdio: "ignore"`
  - `packages/server/src/cli.ts`: open `server.log` with `"a"` (append) instead of `"w"` (truncate) so crash history is preserved across retries
  - Surface the log path in the extension's `ui.notify` message when auto-start fails
- Minor Windows cleanups surfaced by the same audit:
  - `packages/server/src/editor-detection.ts`: replace direct `which ${name}` with `ToolResolver.which` (uses `where` on Windows)
  - `packages/server/src/session-diff.ts`: replace `execSync("cat ...")` for untracked-file diff with `fs.readFileSync`
  - `packages/server/src/browser-handlers/session-action-handler.ts` (`isPiProcess`): guard the Unix-only `ps`/`/proc` path behind `platform !== "win32"` (currently reachable on Windows and always throws)

## Capabilities

### New Capabilities
_(none — this is a fix that hardens existing capabilities)_

### Modified Capabilities
- `dashboard-server`: Server startup, `/api/restart`, and stale-port cleanup become cross-platform (no `sh`/`lsof`/`curl`/`cat` assumptions); the TypeScript loader is passed as a `file://` URL.
- `bridge-extension`: The extension's server launcher passes a `file://` URL to `--import` and captures stderr to a log file for crash diagnosis.
- `editor-detection`: Binary lookup uses the unified `ToolResolver.which` so Windows (`where`) is covered.

## Impact

- **Files**:
  - `packages/shared/src/resolve-jiti.ts`
  - `packages/server/src/cli.ts` (cmdStart tsx fallback, restart route, findPortHolders, log open mode)
  - `packages/server/src/routes/system-routes.ts` (`/api/restart` rewrite)
  - `packages/extension/src/server-launcher.ts` (stderr capture, URL conversion already picked up via shared)
  - `packages/electron/src/lib/server-lifecycle.ts` (resolveJitiFromAnchor URL conversion)
  - `packages/server/src/editor-detection.ts`
  - `packages/server/src/session-diff.ts`
  - `packages/server/src/browser-handlers/session-action-handler.ts`
- **APIs**: `POST /api/restart` contract unchanged (still `{ ok: true }`), implementation rewritten.
- **Dependencies**: None added. Removes implicit runtime dependency on `sh`, `lsof`, `curl`, `cat`.
- **Risk**: Low–medium. The URL fix is a one-liner per site and cross-platform safe. The restart rewrite is the highest-risk piece (requires verifying port-free + health-poll logic works on all three OSes) and warrants an integration test.
- **Scope boundary**: This change does NOT address WSL spawn paths in `process-manager.ts`, ARM64 native-module availability (node-pty prebuilds), or the duplication between the shared and Electron jiti resolvers. Those are tracked as separate explore items.
