# Design — Fix Bridge Resume Disconnect

## Status: SPIKE PENDING

The root cause of #393 is **not yet established**. This document records the
verified facts and the candidate hypotheses; the spike (tasks §1–§2) fills in the
confirmed mechanism, after which the fix design (§Fix) is completed and
doubt-reviewed.

## Verified facts (source + pi-core)

- `connection.connect()` at `bridge.ts:2374` is a single call site **inside** the
  `session_start` handler (`bridge.ts:2007–2680`) — NOT a once-at-init call.
  Static fact only: no handler-level `return` between the reason-branch
  (2016–2023) and 2374. Whether `connect()` actually executes on a given resume
  is **dynamic** — an earlier throw in the body would skip it. Do not assert
  "runs on every resume" as established; that is what the spike tests.
- pi awaits the `session_shutdown` handler to completion before emitting
  `session_start`: `agent-session-runtime.js` `switchSession` →
  `await teardownCurrent("resume")` → `await emitSessionShutdownEvent(...)` →
  `await extensionRunner.emit(...)`, THEN `await createRuntime(... session_start
  ...)`. No shutdown/start interleaving.
- `connection.disconnect()` (`connection.ts:63`) sets `intentionalClose = true`,
  clears the reconnect timer, nulls `ws`. `handleDisconnect()` (`connection.ts:229`)
  only reconnects when `!intentionalClose`.
- `connection.connect()` (`connection.ts:57`) has no already-open guard;
  `createConnection()` (`connection.ts:168`) overwrites `this.ws` without closing
  the prior socket. (Latent — relevant only if `connect()` runs while a socket is
  already open.)
- `session_shutdown` reason taxonomy (verified in `agent-session-runtime.js`):
  `"resume"` (switchSession), `"new"` (newSession), `"fork"` (fork), `"quit"`
  (final teardown); `"reload"` in `agent-session.js`.

## Why the obvious theory is wrong

The full disconnect completes before `session_start` (awaited), and the
`session_start` body, if it runs unbroken, reaches `connect()` — a fresh socket
is created and the buffered `session_register` flushes. So the failing chain is
NOT "connect never re-runs." The permanent disconnect must come from the
`session_start` body being **aborted before `connect()`** (a throw), or the fresh
connect/registration being defeated afterward. That is the spike's target.

## Candidate hypotheses (to confirm/refute in the spike)

1. **A throw in `handleSessionChange` skips `connect()`.** `handleSessionChange(ctx)`
   (`bridge.ts:2022`) runs before `connect()` (2374). If it throws, the throw's
   own control-flow abandons the rest of the `session_start` body — `connect()`
   never runs, the disconnect stays terminal. NOTE: `safe()` only decides whether
   the rejection is logged; it does NOT cause the skip. Instrument the **throw
   site**, not `safe()`. Concrete unguarded throw vectors in `session-sync.ts`
   `_handleSessionChange` to check: `extractFirstMessage`, `getCurrentModelString`,
   `replaySessionEntries`, `gatherGitInfo`, `getCommands`; plus
   `startGitPollTimer(ctx)` reading `ctx.cwd` (a guarded getter that throws after
   session replacement — see `bridge.ts:1900`, change `fix-stale-ctx-cwd-crash`).
   (Leading candidate.)
2. **Fresh `connect()` runs but the re-registration is rejected/ignored**
   server-side, so the socket is live but the session never reappears.
3. **In-TUI resume routes through a different path** than `switchSession` (e.g. an
   interactive-mode handler) with different event ordering. The await-ordering
   fact above is verified only for `switchSession`/`newSession`/`fork`; the repro
   must confirm the TUI resume actually routes through one of them.

## Fix

TBD — completed after the spike identifies the mechanism. The fix MUST:

- Satisfy the outcome contract in `specs/bridge-extension/spec.md` (resume ends
  with a live, re-registered connection).
- Be validated by the reproduction test (tasks §1) going green.
- Be minimal and surgical (touch only the confirmed cause).
