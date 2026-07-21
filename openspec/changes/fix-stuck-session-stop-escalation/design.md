# Design — fix-stuck-session-stop-escalation

## Context

Stop button → bridge `abort()` → pi `agent.abort()` fires an `AbortSignal`, but pi's agent loop (`pi-agent-core/agent-loop.js`, `executePreparedToolCall`) awaits `tool.execute(...)` with no race against the signal — the `signal?.aborted` check runs only after the tool returns. Tools that ignore the signal hang the turn indefinitely.

Force Stop → server `handleForceKill` (`packages/server/src/browser-handlers/session-action-handler.ts`) has four verified holes:
1. `session.pid` undefined → closes WS, stamps `ended`, returns `success: true` — process keeps running.
2. POSIX `killProcess` (`packages/shared/src/platform/process.ts`) signals the single pi PID. pi spawns bash tools `detached: true` in their own process groups (`pi-coding-agent/dist/core/tools/bash.js:41`) — children survive as orphans. Windows `taskkill /F /T` already tree-kills.
3. `force_kill_result` has zero client consumers; no server-side logging of kill attempts.
4. `status: "ended"` stamped before death verified.

Existing building blocks reused:
- `packages/extension/src/abort-latch.ts` — per-session abort latch, cleared on new prompt / terminal `agent_end`.
- `packages/extension/src/process-scanner.ts` — `captureChildPgids`, `scanChildProcesses`, `killProcessByPgid`.
- `packages/shared/src/platform/process-identify.ts` — `findPidByMarker`, `isPiCommandLine`.
- `packages/shared/src/platform/process.ts` — `killProcess`, `isProcessAlive`, `killPidWithGroup`.
- Client stop state machine in `CommandInput.tsx` (`StopState = "idle" | "aborting" | "killing"`), `useSessionActions.ts` senders, `SessionBanner.tsx` + `deriveBannerState`.

## Goals / Non-Goals

**Goals:**
- Force Stop terminates the pi process AND every descendant process on all platforms, or honestly reports failure.
- Kill outcome is visible: client toast on failure, button state revert, server log line per attempt.
- Session status flips to `ended` only after death is verified.
- User abort that pi cannot honor (hung tool) self-heals within ~10 s via bridge child-kill watchdog.
- Stuck sessions are visible before the user reaches for Stop (stall banner).

**Non-Goals:**
- Auto-resume after force kill (follow-up change C; needs E's verified-kill result first).
- Fixing pi's cooperative abort upstream (A; pi-mono issue, out of repo).
- Killing children of a healthy long-running tool absent user abort — the watchdog only arms on latched abort.
- Steer/follow-up queue semantics — untouched.

## Decisions

### D1. POSIX descendant kill = walk `ps` tree, kill by process group

New shared helper `killProcessTree(pid, opts)` in `packages/shared/src/platform/process.ts`:
1. Snapshot descendants: `ps -eo pid,ppid,pgid` → BFS from root `pid` → set of `{pid, pgid}`.
2. Collect unique PGIDs of descendants **excluding the server's own PGID** (guard: never `kill(-pgid)` for `pgid === process.getpgid(0)`).
3. `kill(-pgid, SIGTERM)` each group, wait ≤ 2 s (reuse existing poll loop), then `kill(-pgid, SIGKILL)` for survivors.
4. Then run the existing single-PID SIGTERM→SIGKILL on the root pid (covers a root that changed group).
5. Windows: delegate to existing `taskkill /F /T` path unchanged.

Rationale: children are `detached: true` (own PGIDs) so parent-PID kill misses them; group kill is the only reliable sweep. Snapshot-then-kill bounds the race with newly-forked grandchildren; a second snapshot pass after SIGTERM catches most stragglers.

Injectable `exec`/`kill` seams like the rest of `process.ts` for unit tests.

### D2. PID-reuse guard before group kill

Before signalling, re-read `ps -o command= -p <pid>` for the **root** pid and require `isPiCommandLine` match (or descendant-of-match). If the root no longer looks like pi, abort the kill and return `{ ok: false, reason: "pid_reused" }`. Descendant PIDs are trusted transitively from a fresh snapshot taken in the same tick — the window is milliseconds, acceptable.

### D3. No-PID fallback = marker search, else honest failure

`handleForceKill` when `session.pid` is undefined:
1. `findPidByMarker(sessionId)` (session file path appears in pi's argv/cmdline; helper exists).
2. Found → proceed with D1 tree kill on that pid.
3. Not found → close WS, but send `force_kill_result { success: false, message: "process not found — it may still be running" }` and do **not** stamp `ended` (the WS close will drive the normal disconnect → status flow if the process is really gone).

This inverts today's lie (`success: true` on WS-close-only).

### D4. Verify-before-stamp

After kill: poll `isProcessAlive(rootPid)` up to 3 s. Dead → stamp `ended`, broadcast, `success: true`. Alive → no status change, `success: false, message: "process survived SIGKILL"` (also log). Windows: `taskkill` exit code decides.

### D5. Every attempt logged

One structured line per attempt on the server logger: `force_kill session=<id> pid=<pid|none> outcome=<killed|tree_killed|not_found|pid_reused|survived> tookMs=<n>`.

### D6. Client consumes `force_kill_result`

`useMessageHandler` (client) handles `force_kill_result`: on `success: false` → `showToast(message, "error")` and reset the per-session stop state so `CommandInput` returns from `killing` to showing Force Stop again. Stop state today is component-local `useState` in `CommandInput` — lift the reset via a `resetStopSignal` prop (incrementing counter or session-scoped key), NOT a global store; smallest change that lets App-level WS handling reach it. On `success: true` nothing extra (session_updated → ended already dismantles the composer).

### D7. Stall detector = client-side, event-driven, banner surface

`deriveBannerState` gains a `stalled` input: session `status === "streaming"` AND `now - lastEventAt > stallThresholdMs` (default 120 000; configurable later, constant now). `lastEventAt` already effectively exists as `lastActivityAt` on the session (server stamps activity events) — reuse it; no new protocol. Banner renders amber line "No activity for 2m — session may be stuck" with buttons wired to the existing abort / force-kill senders. Ticker: reuse the 1 s elapsed-badge interval pattern, gated on a streaming session being selected.

False-positive bound: long silent LLM thinking with no deltas is rare at 120 s; banner is advisory (no auto-action), so cost of a false positive is one dismissible line.

### D8. Bridge abort watchdog

New `packages/extension/src/abort-watchdog.ts`:
- `arm(sessionId)` called from the bridge `abort()` wrapper right after `abortLatch.request(...)`.
- Timer fires at `WATCHDOG_DELAY_MS = 10_000`. Condition to act: latch still active (`abortLatch.isActive(sessionId)`) AND bridge still believes agent is streaming (`isAgentStreaming === true`).
- Action: `scanChildProcesses()` → for each child PGID (excluding own PGID) `killProcessByPgid(pgid, "SIGTERM")`, then 2 s later `SIGKILL` survivors. The dying tool's promise rejects inside pi → `executePreparedToolCall` catches → `signal?.aborted` breaks the loop → abort completes.
- Disarm on: `agent_end`, `noteUserPrompt`, latch clear, session change, extension deactivate. Single timer per session; re-abort re-arms.
- One-shot per latch: after firing once, it does not re-fire until a new abort latches (prevents kill-storms).
- No-op when scan returns zero children (LLM-stream stall class — escalation stays with the user via D7/E).

### D9. Post-abort Force Stop emphasis

`CommandInput` already flips to `aborting` and shows the orange button. Add: while in `aborting` for > 5 s with session still streaming, apply the existing `animate-pulse` + a title hint "Still running — Force Stop kills the process". Pure presentational; no new state machine states.

## Risks / Trade-offs

- **Group kill collateral**: a PGID could theoretically contain non-session processes. Mitigation: PGIDs are collected only from the descendant snapshot of the verified pi root (D2), never from patterns; own-PGID excluded. Residual risk accepted (same trust level as bridge's existing `killProcessByPgid` path).
- **Snapshot race**: children forked between snapshot and kill escape the sweep. Second-pass snapshot after SIGTERM narrows this; a fully race-free kill needs cgroups/job objects — out of scope. Accepted.
- **`lastActivityAt` throttling**: server throttles activity stamping; worst-case staleness adds seconds to the 120 s threshold. Acceptable for an advisory banner.
- **Watchdog kills a tool the user still wanted**: only reachable after the user explicitly pressed Stop (latched abort) — by definition they wanted it dead. The 10 s delay gives pi's cooperative path first chance.
- **Windows watchdog**: `scanChildProcesses` has a PowerShell arm; group-kill semantics differ (`taskkill /T` per child PID instead of PGID). Watchdog uses per-PID tree kill on win32. Slightly weaker, matches existing platform split.
- **Two kill authorities** (bridge watchdog + server force_kill) could overlap: both are idempotent against already-dead PIDs (`isProcessAlive` guards / ESRCH swallowed) — double-kill is harmless.
