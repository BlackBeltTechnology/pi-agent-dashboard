# Fix stuck-session stop escalation

## Why

When an agent turn gets stuck (a tool call that never returns, a wedged provider stream, or a blocked event loop), the user cannot reliably stop the session:

1. **Stop is cooperative and silently ineffective.** The Stop button routes to `cachedCtx.abort()` → pi's `agent.abort()`, which fires an `AbortSignal`. But pi's agent loop (`pi-agent-core/agent-loop.js`) does `await tool.execute(...)` with **no race against the signal** — the `signal?.aborted` check only runs after the tool returns. Any tool that ignores its `signal` argument (most MCP tools, custom tools, hung fetches) runs forever. The user's report — "the stop only executes at the next step" — is exactly this design.
2. **Force Stop (force_kill) is a leaky safety net.** Traced in `packages/server/src/browser-handlers/session-action-handler.ts#handleForceKill`, four holes:
   - **No-PID = fake kill.** When `session.pid` is undefined, the handler closes the WebSocket, stamps the card `ended`, and reports `success: true` — while the pi process keeps running.
   - **Unix kill is not a tree kill.** `killProcess` SIGTERM→SIGKILLs the single pi PID. pi spawns bash tools `detached: true` in their **own process groups** — killing pi orphans the hung child (`npm test`, `docker build`, …), which keeps running. (Windows `taskkill /F /T` is a genuine tree kill; POSIX has no equivalent here.)
   - **Result is dropped.** `force_kill_result` is sent by the server but no client code consumes it. The button shows "Killing…" from optimistic local state; a failed kill is invisible. Nothing is logged server-side.
   - **`ended` is stamped blind.** Status flips before death is verified.
3. **No stall visibility.** Nothing tells the user a session looks stuck; they discover it only when a dead Stop button doesn't respond, then a dead Force Stop doesn't either.

Observed in production: session stuck in an infinite tool-call state; Stop did nothing; Force Stop appeared but also did nothing.

## What Changes

Three layers, ordered by urgency (E → D → B). Auto-resume-after-kill (C) is deferred to a follow-up change; the upstream cooperative-abort fix (A) is an out-of-repo note.

### E — Make force_kill actually kill (server)

- **Tree kill on POSIX.** Before killing the pi PID, enumerate its descendant processes / process groups (`ps` walk, pattern exists in `packages/extension/src/process-scanner.ts`) and SIGKILL each **group** (`kill(-pgid)`) so detached bash children die with pi. Windows path (`taskkill /F /T`) unchanged.
- **No-PID fallback.** When `session.pid` is missing, locate the pi process by session-file marker via existing `findPidByMarker` / `isPiCommandLine` (`packages/shared/src/platform/process-identify.ts`) before falling back to WebSocket-close-only. WS-close-only result message must say the process may still be running (`success: false`).
- **Verify before stamping.** After kill, confirm with `isProcessAlive`; only then set `status: "ended"`. On verification failure send `force_kill_result { success: false }` and leave status untouched.
- **Log every force_kill** attempt + outcome to the server log.

### D — Surface kill results + stall detection (client)

- **Consume `force_kill_result`.** On `success: false`, show an error toast with the message and revert the button from "Killing…" back to the Force Stop state so the user can retry.
- **Stall detector.** When a session is `streaming` and no forwarded event (message delta, tool event, heartbeat) has arrived for a threshold (default 120 s, configurable), surface a "session may be stuck" line on the existing `SessionBanner` with a one-click escalation (Stop → Force Stop).
- **Post-abort escalation hint.** After Stop is pressed and streaming has not ended within the existing grace period, visually emphasize the Force Stop button (it exists today but users don't know it's the next move).

### B — Bridge abort watchdog with child kill (extension)

- When an abort has been latched (`abort-latch.ts`) and the session is **still streaming N seconds later** (default 10 s), the bridge scans its child process groups (existing `captureChildPgids` / `scanChildProcesses` in `process-scanner.ts`) and SIGTERM→SIGKILLs them. A hung bash tool then errors out, pi's `signal?.aborted` check runs, and the abort completes without killing the session process.
- Watchdog disarms on `agent_end`, on new user prompt, and on latch clear — same lifecycle as the abort latch.
- Does not fire for non-tool stalls (nothing to kill); those escalate via D → E.

### Out of scope (tracked separately)

- **C — force-kill + auto-resume**: respawn `pi --resume <sessionFile>` after a kill so the session card survives. Follow-up change; depends on E's verified-kill result.
- **A — upstream cooperative abort**: `Promise.race([tool.execute(...), abortPromise])` in pi-agent-core so abort lands mid-tool-call. Belongs in pi-mono (github.com/badlogic/pi-mono); file an issue/PR referencing this change. The dashboard layers above remain necessary regardless (defense in depth, and class-3 event-loop blocks are unreachable by any in-process fix).

## Capabilities

### New Capabilities

- `stuck-session-escalation`: stall detection, verified force-kill with tree kill and no-PID fallback, kill-result feedback, bridge abort watchdog with child-process kill.

### Modified Capabilities

- `play-stop-controls`: Force Stop button consumes `force_kill_result` (failure toast + state revert); post-abort escalation emphasis. Existing Stop/Force Stop/Killing state machine otherwise unchanged.

## Impact

- **Server**: `packages/server/src/browser-handlers/session-action-handler.ts` (`handleForceKill` rewrite), new descendant-enumeration helper in `packages/shared/src/platform/process.ts` (or sibling), uses `process-identify.ts` for no-PID fallback. Logging added.
- **Shared**: `killProcess` gains (or is joined by) a `killProcessTree` POSIX variant; `force_kill_result` schema unchanged (already carries `success` + `message`).
- **Extension (bridge)**: new abort-watchdog module wired to `abort-latch.ts` lifecycle + `process-scanner.ts`; after change, run `npm run reload`.
- **Client**: `useSessionActions.ts` / message handler consumes `force_kill_result`; `CommandInput.tsx` stop-state revert; `SessionBanner` stall line; toast on failure.
- **Tests**: `force-kill-handler.test.ts` + `session-kill-e2e.test.ts` extended (tree-kill, no-PID fallback, verify-before-stamp); new bridge watchdog unit tests; client stop-state revert tests.
- **Risk**: tree kill must never target PIDs outside the session's descendant set (PID-reuse guard via `isPiCommandLine` check before group kill). Watchdog must not kill children of a *healthy* long-running tool — it only fires after an explicit user abort is latched.
