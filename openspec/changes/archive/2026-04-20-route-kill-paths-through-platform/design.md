## Context

The dashboard spawns session child processes via one of four mechanisms (`tmux`, `wt`, `wsl-tmux`, `headless`) and additional long-lived subprocesses (`zrok` tunnel, `code-server` editor). Terminating any of them is a cross-OS problem:

- POSIX: children are detached into their own process group; killing the group (`kill -<pgid>`) propagates to every descendant.
- Windows: process groups exist for console control events only; real tree kill requires `taskkill /F /T /PID <pid>`.

`packages/shared/src/platform/process.ts` already implements the correct primitives:

| Helper | POSIX | Windows |
|--------|-------|---------|
| `isProcessAlive(pid)` | `kill(pid, 0)` | `kill(pid, 0)` (same API) |
| `killPidWithGroup(pid, sig)` | `kill(-pid, sig)` | `kill(pid, sig)` ← **leaf only** |
| `killProcess(pid, {timeoutMs})` | SIGTERM → wait → SIGKILL | `taskkill /F /T /PID <pid>` |

The ✕-button path in `session-action-handler.ts::handleForceKill` reimplements the SIGTERM → wait → SIGKILL dance using raw `process.kill(pid, …)`, which on Windows never reaches descendants. Seven other sites across `server/` and `extension/` similarly reimplement liveness checks or raw kills.

Enforcement already exists for `node:child_process` imports (see `command-executor` spec and `no-direct-child-process.test.ts`). The same pattern must be applied to `process.kill`.

## Goals / Non-Goals

**Goals**
- Every termination of a spawned session, editor, tunnel, or tracked PGID goes through `platform/process.ts` helpers.
- ✕-button works identically on Windows, macOS, and Linux (full subtree dies).
- One canonical `isProcessAlive` implementation; three duplicates deleted.
- CI fails if new code introduces direct `process.kill` or `ChildProcess.kill` outside the platform module.
- Electron `doctor` and `dependency-detector` stop depending on shell utilities (`curl`, `where`, `which`) that the platform layer already abstracts.

**Non-Goals**
- Changing the ✕-button protocol or UX.
- Rewriting the `terminal-manager` PTY kill path (node-pty's `pty.kill()` is library-owned and correct on all platforms).
- Introducing new platform helpers — only wiring existing ones.
- Changing `killPidWithGroup`'s Windows behavior in ways that break existing callers (see Decision 3).

## Decisions

### 1. `handleForceKill` delegates to `killProcess`, not `process.kill`

The entire SIGTERM → wait 2s → SIGKILL loop in `handleForceKill` (`session-action-handler.ts:~235-265`) is replaced by a single `await killProcess(pid, { timeoutMs: 2000 })`. This:

- Uses `taskkill /F /T /PID` on Windows — genuine tree kill.
- Preserves exact POSIX semantics (SIGTERM, 2s wait, SIGKILL escalation).
- Returns `{ ok, forced }` which maps cleanly onto the existing `force_kill_result` message.

*Alternative considered*: keep hand-rolled logic and only swap `process.kill` → `killPidWithGroup`. Rejected because `killPidWithGroup` on Windows currently calls `process.kill(pid, sig)` (leaf only), so the ✕-button bug would persist on Windows.

### 2. `killHeadlessBySessionId` fallback is deleted

Line 32 currently wraps a `killPidWithGroup` call in a try/catch and falls back to `process.kill(pid, "SIGTERM")`. If `killPidWithGroup` threw (e.g., ESRCH because process is already dead), a second raw kill does nothing useful. Action: delete the catch body, let errors propagate, and log in the caller.

### 3. `killPidWithGroup` Windows semantics remain unchanged

The existing Windows implementation of `killPidWithGroup` (`kill(pid, sig)` — leaf only) is kept as-is for this change. Callers that need real tree kill on Windows must use `killProcess` (async) instead. Rationale: `headless-pid-registry.ts` uses `killPidWithGroup` inside synchronous cleanup paths (e.g., startup reconciliation) where awaiting `killProcess` would be invasive, and its children on Windows are short-lived. A follow-up change may upgrade `killPidWithGroup` to use `taskkill /T` without `/F`, but that's out of scope here.

### 4. Duplicate `isProcessAlive` helpers collapse to a single re-export

Three files (`headless-pid-registry.ts`, `server-pid.ts`, `tunnel.ts`) each define `function isProcessAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } }`. Each is deleted; each file imports `isProcessAlive` from the platform module. `server-pid.ts` re-exports it so external callers (if any) are unaffected.

### 5. Electron's `dependency-detector` uses the already-instantiated `ToolResolver`

Line 158 shells out to `where pi-dashboard` / `which pi-dashboard`. Line 27 of the same file already creates a `ToolResolver`. Action: replace the inline shell-out with `resolver.which("pi-dashboard")`. No new imports needed.

### 6. Electron's `doctor` uses `isDashboardRunning` instead of `curl`

Line 234 runs `execSync("curl -sf http://localhost:8000/api/health")`. The health check already exists as `isDashboardRunning(port)` in `health-check.ts` (native fetch, no shell dep). Action: import it and `await` it. The enclosing function becomes async; the row-builder in `doctor.ts` already supports async checks.

### 7. Lint enforcement mirrors the existing child_process ban

Add `packages/shared/src/platform/__tests__/no-direct-process-kill.test.ts`. It scans every `.ts` file under `packages/*/src/` (excluding `__tests__/` and `packages/shared/src/platform/`) for:

- `process.kill(` — any usage.
- `\.kill\(` on values of type `ChildProcess` — detected heuristically by the AST; simpler alternative is a curated allow-list of known-correct sites (`terminal-manager.ts` pty.kill, `process.exit` is fine).

The test fails with a list of offending files and line numbers. Mirrors the style of `no-direct-child-process.test.ts`.

### 8. Test-injection strategy

`killProcess` and `killPidWithGroup` both already accept `{ platform, exec, kill }` options. New unit tests for:

- `handleForceKill` — inject `platform: "win32"`, assert `exec` receives a `taskkill …` string; inject `platform: "linux"`, assert SIGTERM→SIGKILL sequence.
- `tunnel.cleanupStaleZrok` — inject `platform` and verify correct branch.

No live child processes are spawned; tests stay fast and deterministic.

## Risks / Trade-offs

- **Risk**: `killProcess` on Windows issues `taskkill /F /T`, which is force-kill without grace period. POSIX semantics preserve a 2s SIGTERM grace window.
  → **Mitigation**: Document the asymmetry in `force-kill-handler/spec.md`. The ✕-button is explicitly a **force**-kill; users who want graceful shutdown use normal session-end flows. The 2s window was never honored on Windows anyway (the old code's SIGTERM was a no-op for descendants).

- **Risk**: Changing `doctor.ts` to an async path may break the existing sync row aggregation.
  → **Mitigation**: `doctor.ts` already awaits other checks (version lookups). Verify in the PR and refactor to a uniform async pipeline if needed.

- **Risk**: The lint test produces false positives for intentional uses in the platform module itself.
  → **Mitigation**: Hard-coded exclusion of `packages/shared/src/platform/` (same pattern as the existing child_process ban).

- **Trade-off**: Deleting `killHeadlessBySessionId`'s fallback means a single failed `killPidWithGroup` no longer retries. Acceptable because the common failure mode (ESRCH) means the process is already dead — a retry accomplishes nothing.

## Migration Plan

1. Land platform-side test utilities first (reuses existing `ProcessOpts` injection, no new code needed).
2. Replace kill sites in order: `session-action-handler` (visible bug fix) → `process-scanner` → `tunnel` → `editor-manager` → duplicate `isProcessAlive` cleanup → Electron `dependency-detector` + `doctor`.
3. Add the `no-direct-process-kill` lint test last, after all in-tree violations are resolved. Enable it in CI.
4. Manual QA matrix (Windows / macOS / Linux): click ✕ on a tmux-wrapped session, a `wt` session (Windows), and a headless session. Verify no zombie child processes remain (Task Manager / `ps -ef` / Activity Monitor).

No rollback plan beyond a git revert; changes are additive-safe and gated by tests.

## Open Questions

- Should `killPidWithGroup` be upgraded on Windows to `taskkill /T <pid>` (no `/F`) in a follow-up? This would give it true tree-kill semantics without forcing. Decision deferred — callers that need it today use `killProcess`.
- Do we want a `killTree(pid)` helper that is always tree-kill on both OSes (SIGTERM-to-group on Unix, `taskkill /T` on Windows)? Possibly cleaner naming than the existing two-primitive split. Deferred.
