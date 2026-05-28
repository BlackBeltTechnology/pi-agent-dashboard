## Why

Users report sessions getting stuck after clicking stop/abort, where "only server restart helps". Investigation (2026-05-28) traced this to two concrete gaps in the keeper-mediated headless kill path that landed with `add-rpc-stdin-dispatch-with-keeper-sidecar` and survived `enable-rpc-keeper-by-default`:

1. **`headlessPidRegistry.killBySessionId` never escalates SIGTERM to SIGKILL.** From `packages/server/src/headless-pid-registry.ts:345`: the keeper-aware branch sends `killPidWithGroup(piPid, "SIGTERM")` and schedules `killPidWithGroup(keeperPid, "SIGTERM")` 200 ms later. There is no SIGKILL escalation in this path. A pi process hung in a busy loop or a non-cancellable native call ignores SIGTERM and persists indefinitely. This function is the kill step inside `handleShutdown` (`session-action-handler.ts:523`), so even the explicit "Shutdown" action cannot reliably terminate a hung session.

2. **The keeper's `shutdown()` does not kill its `piChild` before `process.exit()`.** From `packages/server/src/rpc-keeper/keeper.cjs:87-101`: shutdown closes the UDS server, unlinks the socket/pid files, then `process.exit(exitCode)`. It relies on pi reading `EOF` on stdin to terminate voluntarily. That contract works for a healthy pi whose event loop ticks — but a hung pi never reads stdin, so when the keeper exits, pi is reparented to init/launchd and keeps running. The keeper's SIGTERM handler at `:104` calls the same `shutdown()`, so receiving SIGTERM from the dashboard does not propagate as SIGKILL (or any kill) to pi.

Together, the two gaps compose: the dashboard's "Shutdown" action SIGTERMs pi (no-op when hung) → 200 ms later SIGTERMs the keeper → the keeper exits cleanly via its handler → pi is orphaned and continues running. Only `handleForceKill` (`session-action-handler.ts:645`) reaches SIGKILL, and only against `session.pid` (pi), via the platform-level `killProcess` SIGTERM → 2 s → SIGKILL ladder. Users who click stop/abort and don't escalate to the red ✕ force-kill button see a perpetually-stuck card.

Server restart "fixes" the symptom because:
- The dashboard server's exit closes the bridge WebSocket; pi's bridge code observes the disconnect and (if its event loop ticks) initiates voluntary shutdown.
- On the new server's startup, `keeper-manager.ts::discoverExistingKeepers` reconciles orphan keeper sockets; orphaned keepers that no longer match a registered session get cleaned up.

Neither mechanism is reliable for a truly-hung pi, but both are more aggressive than the SIGTERM-only `killBySessionId` path.

## What Changes

- **MODIFIED**: `packages/server/src/headless-pid-registry.ts::killBySessionId`. The keeper-aware branch SHALL escalate pi from SIGTERM to SIGKILL via the platform-level `killProcess(piPid, { timeoutMs: 2000 })` helper instead of the bare `killPidWithGroup(piPid, "SIGTERM")`. The 200 ms keeper-fallback SIGTERM stays as-is (the keeper's own SIGTERM handler is reliable; we only need to escalate pi). The function stays synchronous from the caller's perspective by leaving the keeper cleanup as a fire-and-forget timer; the pi-kill escalation becomes an `await killProcess(...)` and the function's signature changes to `Promise<boolean>` (already implicitly async since `setTimeout` makes the side-effect deferred — the change is making the wait explicit). All callers (`handleShutdown`, `handleForceKill`, `handleKillProcess`) are already invoked from `async` browser-handler entrypoints, so the signature change is local.
- **MODIFIED**: `packages/server/src/rpc-keeper/keeper.cjs::shutdown`. Before `process.exit(exitCode)`, SHALL attempt `piChild.kill("SIGKILL")` when `piChild` exists and has not already exited. Wrapped in `try { ... } catch { /* ignore */ }` to preserve the "shutdown never throws" invariant. Defence in depth — when the keeper receives SIGTERM from the dashboard, this guarantees pi dies even if pi's event loop is hung and would never observe stdin EOF.
- **NEW**: `packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts`. Asserts that `killBySessionId` on a keeper-mediated entry routes pi-kill through the SIGTERM→SIGKILL escalator (injected fake `killProcess`) and does NOT call the bare `killPidWithGroup(piPid, "SIGTERM")` path. Covers two scenarios: (a) pi exits cleanly within the SIGTERM grace → no SIGKILL; (b) pi hangs past the timeout → SIGKILL is issued.
- **NEW**: `packages/server/src/rpc-keeper/__tests__/keeper-shutdown-kills-pi.test.ts` (Unix-only, gated by `process.platform !== "win32"`). Spawns a real keeper.cjs child against a fake pi script that traps SIGTERM and busy-loops on stdin (simulating a hung pi). Sends SIGTERM to the keeper, asserts `piChild.pid` is dead within ~1 s via `isProcessAlive`. Windows path verified manually only — the SIGKILL semantics map to `process.kill()` which libuv translates to `TerminateProcess` on Windows; equivalent assertion.
- **NOT INTRODUCED**: Any UX change. The proposal in the investigation thread suggested an "abort didn't take → prompt for ForceKill" affordance; that is left to a separate change because it touches the browser-protocol surface and changes session-action UX patterns. This change is purely server-side defence-in-depth.
- **NOT INTRODUCED**: Any change to the abort path. `handleAbort` remains cooperative (`pi.abort()` via bridge WS). The two fixes above only harden the kill path, which is what users escalate to when abort fails.
- **NOT INTRODUCED**: Any change to `handleHideSession`. "Close card" remains a metadata flip with no kill semantics — that is the documented behavior. Surfacing this distinction to users is a UX change, not in scope here.

## Capabilities

### Modified Capabilities

- `headless-spawn`: the kill-by-session-id requirement adds SIGKILL escalation on the pi PID. The existing keeper-fallback SIGTERM requirement is unchanged. The new requirement makes the "pi survives ignored SIGTERM" behavior an explicit non-permissible outcome.
- `rpc-keeper-sidecar`: a new requirement is added: "Keeper SIGKILLs its pi child on shutdown". The existing "keeper exits cleanly on SIGTERM" requirement is unchanged. The new requirement closes the orphan-pi gap when the keeper's exit precedes pi's voluntary shutdown.

### New Capabilities

(none — this change only modifies existing capabilities)

## Impact

- **MODIFIED files**:
  - `packages/server/src/headless-pid-registry.ts` — `killBySessionId` keeper-branch SIGTERM call becomes `await killProcess(piPid, { timeoutMs: 2000 })`. Import `killProcess` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`. Signature changes to `Promise<boolean>`. Estimated ~10 LOC delta.
  - `packages/server/src/rpc-keeper/keeper.cjs` — `shutdown()` adds `try { piChild?.kill("SIGKILL"); } catch {}` before `process.exit`. Estimated ~3 LOC.
  - `packages/server/src/browser-handlers/session-action-handler.ts` — three call sites become `await headlessPidRegistry.killBySessionId(...)`. Estimated ~3 LOC. The handlers are already async; no caller-of-caller propagation needed.
- **NEW files**:
  - `packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts` — ~60 LOC.
  - `packages/server/src/rpc-keeper/__tests__/keeper-shutdown-kills-pi.test.ts` — ~80 LOC; Unix-only via `describe.runIf(process.platform !== "win32")`.
- **REMOVED files**: none.
- **Backward compatibility**:
  - Pure additive on the kill ladder. Sessions that already terminate cleanly on SIGTERM see no behavior change. Sessions that ignore SIGTERM now die within 2 s instead of surviving until server restart.
  - Keepers running from a pre-this-change server (orphans on disk after upgrade) are unaffected — they continue using their old shutdown path. The new shutdown logic only takes effect for keepers spawned after the upgrade.
  - No bridge-side change. Old bridges work unchanged.
  - No config change. No protocol change.
- **Risk**:
  - SIGKILL on pi loses any in-flight session-state writes pi was doing. Today, the same loss happens on `handleForceKill` and is accepted there. The new path applies the same trade-off to "Shutdown" — graceful shutdown is attempted first (bridge `pi.shutdown()` is sent before `killBySessionId`), so cooperative pi processes still get a clean exit. Only hung pi's are escalated.
  - Keeper's force-kill of `piChild` in its own SIGTERM handler is defence-in-depth. It fires only when the keeper is itself being killed. If pi exited normally and the keeper followed, `piChild.kill("SIGKILL")` is a no-op on an already-dead PID (caught by the try/catch).
  - Test for the keeper.cjs change spawns a real subprocess; CI must not flake. Mitigation: generous 1 s wait, explicit `isProcessAlive` poll loop, deterministic teardown.
- **Durability**: improves it. Today a hung pi requires manual ForceKill (most users don't realize) or a full server restart. After this change, "Shutdown" reliably terminates pi within ~2 s.

## Depends On

This change depends on `enable-rpc-keeper-by-default` (PR #47, currently in review). That change removed the legacy non-keeper spawn paths; without it, the modifications here would need to also cover the legacy `tail -f /dev/null` wrapper kill semantics. With `enable-rpc-keeper-by-default` merged, the only kill path that matters is the keeper-mediated one.

If `enable-rpc-keeper-by-default` is rejected or reverted, this proposal needs to be re-scoped to cover both spawn paths.

## References

### Empirical evidence

- `packages/server/src/headless-pid-registry.ts:345-393` — current `killBySessionId` keeper branch. Lines 357 + 366: SIGTERM-only, no SIGKILL escalation.
- `packages/server/src/rpc-keeper/keeper.cjs:87-101` — current `shutdown()`. Calls `process.exit(exitCode)` without killing `piChild`.
- `packages/server/src/rpc-keeper/keeper.cjs:104` — `process.on("SIGTERM", () => shutdown(0, "SIGTERM"))` — the SIGTERM handler that fires when `killBySessionId` reaches the keeper.
- `packages/server/src/browser-handlers/session-action-handler.ts:517-528` — `handleShutdown`. Currently invokes `killBySessionId` synchronously after bridge shutdown. Needs `await` after the signature change.
- `packages/server/src/browser-handlers/session-action-handler.ts:645-695` — `handleForceKill`. The only path with SIGKILL escalation today, via `killProcess(session.pid, { timeoutMs: 2000 })`. The reference implementation this change mirrors into `killBySessionId`.
- `packages/shared/src/platform/process.ts` — `killProcess(pid, { timeoutMs })` already implements the SIGTERM → wait → SIGKILL ladder cross-platform (Windows `taskkill /F /T /PID`; POSIX kill-tree). No new primitive needed.

### Investigation thread

Session of 2026-05-28: user reported "sessions which can stuck after stopping the prompt and only server restarts help the situation". File-index harvest + targeted source reads of `headless-pid-registry.ts`, `keeper.cjs`, `session-action-handler.ts`, `command-handler.ts` confirmed the gap. Full diagnosis in the conversation thread that produced this proposal.

### Architectural references

- `openspec/specs/headless-spawn/spec.md` — existing keeper-mediated spawn requirements (post-`enable-rpc-keeper-by-default` sync). The kill-by-session-id requirement lives here.
- `openspec/specs/rpc-keeper-sidecar/spec.md` (if it exists; the parent change put it under `headless-spawn`) — keeper lifecycle requirements.
