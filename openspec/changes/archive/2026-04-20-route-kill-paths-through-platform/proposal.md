## Why

Clicking the ✕ (force-kill) button on a session only terminates child processes reliably on Linux. On Windows the direct `process.kill(pid, …)` calls used in `session-action-handler.ts` signal the leader PID only and never reach descendant processes (no `taskkill /F /T`), and on macOS the same calls fail to tear down tmux-wrapped session trees. The platform layer (`packages/shared/src/platform/process.ts`) already exposes correct cross-OS primitives (`isProcessAlive`, `killProcess`, `killPidWithGroup`), but eight kill sites across the server and extension packages bypass them. Additional bypass sites in the Electron package (`dependency-detector.ts`, `doctor.ts`) reintroduce shell-dependent logic that the platform layer already replaces.

## What Changes

- Route every process-termination call through `packages/shared/src/platform/process.ts`:
  - `packages/server/src/browser-handlers/session-action-handler.ts` — three sites (lines 32, 241, 260) replace `process.kill(pid, …)` with `killPidWithGroup`.
  - `packages/extension/src/process-scanner.ts:257` — replace `process.kill(-pgid, "SIGTERM")` with `killPidWithGroup(pgid, "SIGTERM", { platform })`.
  - `packages/server/src/tunnel.ts` — delete the local `isProcessAlive` and raw `process.kill` cleanup; call platform helpers. Child timeout kill (line 236) uses `killPidWithGroup`.
  - `packages/server/src/editor-manager.ts:314` — replace `inst.process.kill("SIGTERM")` with `killPidWithGroup` so code-server subprocesses die with their parent.
- Collapse duplicate `isProcessAlive` helpers in `headless-pid-registry.ts:87` and `server-pid.ts:21` into a single re-exported import from the platform layer.
- Replace Electron-side bypasses with existing platform primitives:
  - `packages/electron/src/lib/dependency-detector.ts:158` — `where`/`which` inline shell → `resolver.which("pi-dashboard")` (the `ToolResolver` is already instantiated in that file).
  - `packages/electron/src/lib/doctor.ts:234` — `execSync("curl …")` → `isDashboardRunning(port)` from `health-check.ts`.
- Extend the existing `command-executor` spec with a **no direct `process.kill` outside the platform** requirement, enforced by a repo-level lint test that mirrors the existing direct-`child_process`-import ban.
- Add unit tests for `handleForceKill` and zrok cleanup that inject `{ platform: "win32" | "darwin" | "linux" }` and verify the correct platform branch is taken (no live processes spawned).

## Capabilities

### New Capabilities
*(none — all changes extend existing specs)*

### Modified Capabilities
- `command-executor`: add requirement banning direct `process.kill` / `ChildProcess.kill` outside `packages/shared/src/platform/`, with repo-level enforcement.
- `force-kill-handler`: tighten the existing SIGTERM→wait→SIGKILL requirement so it MUST use the platform's tree-kill primitive, guaranteeing cross-OS behavior.

## Impact

- **Code**: ~8 line-level edits across 6 source files; 1 new lint test under `packages/shared/src/platform/__tests__/` (mirrors `no-direct-child-process.test.ts`); unit tests for force-kill and zrok cleanup.
- **APIs**: no public API changes. `server-pid.ts::isProcessAlive` becomes a re-export; signature and behavior preserved.
- **Behavior**:
  - Windows: ✕ button terminates the full session tree; zrok stale cleanup works; code-server child trees die with their parent.
  - macOS: tmux-wrapped session children die on ✕ instead of leaking.
  - Linux: no behavior change.
- **Dependencies**: none added or removed. Removes a runtime dependency on `curl` being present (Electron doctor).
- **Risk**: low — all three platform helpers are already in use elsewhere; changes are mechanical substitutions guarded by new tests.
