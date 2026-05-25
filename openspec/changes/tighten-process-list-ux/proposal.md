## Why

Session-card process list shows three kinds of noise that drown the signal:

1. **Self-spawned infrastructure.** When a bridge auto-starts the dashboard server or the RPC keeper sidecar, those `node` / keeper PIDs land in the tracked PGID set and stay there forever. Users see their own dashboard plumbing listed as "long-running child processes".
2. **Slow surfacing.** The 30 s `minElapsedMs` floor + 10 s scan tick means a real bash subprocess often finishes before it ever appears. The list feels stale.
3. **Card thrash.** `ProcessList` returns `null` at 0 processes and grows row-by-row from 1 upward. The session card height jumps every time a process appears/disappears, which is visually loud and breaks scroll position in dense layouts.

## What Changes

- **Bridge tracks its own self-spawned PIDs.** Add a `selfSpawnedPgids: Set<number>` to bridge state. Populate from the two known sites: dashboard server auto-start (`server-launcher.ts`) and RPC keeper spawn (`keeper-manager.ts` on the server, but bridges may also start one). Reap entries when their PIDs die.
- **Process scanner accepts an exclusion set.** Extend `captureChildPgids` and `scanChildProcesses` to take an optional `excludedPgids: Set<number>` parameter. Excluded PGIDs are refused at *capture* time (never added to `trackedPgids`) so the tracked set stays clean.
- **Drop the Unix scan tick to 5 s.** `PROCESS_SCAN_INTERVAL` in `bridge.ts` becomes platform-aware: 5000 on Unix, 10000 on Windows (unchanged, due to `wmic`/PowerShell cost + console-flash concerns).
- **Drop `DEFAULT_MIN_ELAPSED_MS` to 5 s on Unix.** Windows keeps 30 s. Threaded through `scanChildProcesses` so the bridge picks the right floor per platform.
- **`ProcessList` enforces a floor of 5 visible slots when non-empty.** When `processes.length > 0` and `< 5`, render invisible skeleton rows (matching row height, no content) to pad to 5. Returns `null` unchanged at length 0.
- **`ProcessList` caps at 5 with "+N more" tail.** When `processes.length > 5`, show the first 5 (most recently captured / longest-running — define in design) and a single trailing row reading "+N more processes". Tooltip on the tail row lists the hidden command lines.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-process-tracking`: Adds self-spawned PID exclusion, retunes scan-tick + min-elapsed defaults per platform, and tightens the session-card render contract with floor=5 / ceiling=5+overflow.

## Impact

**Code touched**
- `packages/extension/src/process-scanner.ts` — add `excludedPgids` parameter; lower `DEFAULT_MIN_ELAPSED_MS` to 5000 (Unix) while keeping a 30000 path for Windows.
- `packages/extension/src/bridge.ts` — platform-aware `PROCESS_SCAN_INTERVAL`; pass `selfSpawnedPgids` through to scanner; pass platform-correct `minElapsedMs`.
- `packages/extension/src/bridge-context.ts` — new `selfSpawnedPgids: Set<number>` field.
- `packages/extension/src/server-launcher.ts` — register spawned dashboard-server PID into bridge state.
- `packages/server/src/rpc-keeper/keeper-manager.ts` — register spawned keeper PIDs (when invoked from bridge context; on server it's already isolated).
- `packages/client/src/components/ProcessList.tsx` — floor 5 / ceiling 5+overflow rendering.

**Specs touched**
- `openspec/specs/session-process-tracking/spec.md` — modified requirements.

**No impact on**
- Windows code paths (intentionally unchanged: scan tick + min-elapsed stay at 10 s / 30 s).
- Server-side event wiring, message protocol (`process_list` shape unchanged).
- Kill semantics (`killProcessByPgid` unchanged).
- Storage / persistence (none — bridge state is in-memory).

**Risk**
- Faster scan tick → 2× more `ps -eo …` invocations per bridge per minute on Unix. `ps` is cheap; negligible.
- Exclusion set growing unbounded if PIDs aren't reaped. Mitigated by reaping in the same loop that walks tracked PGIDs (skip-then-prune pattern).
