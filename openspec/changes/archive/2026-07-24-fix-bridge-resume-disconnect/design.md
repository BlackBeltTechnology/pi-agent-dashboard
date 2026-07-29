# Design — Fix Bridge Resume Disconnect

## Status: SPIKE COMPLETE — cause confirmed, fix landed

Root cause of #393 = **candidate hypothesis #1** (a throw in `handleSessionChange`
skips `connect()`), with the concrete throw vector being the `ctx.cwd` guarded
getter. Confirmed by the RED reproduction test (`bridge-resume-disconnect.test.ts`,
test-plan #X1): injecting the documented post-replacement `ctx.cwd` throw into the
`handleSessionChange` path leaves `connection.isConnected === false` on the
unfixed code (connect() skipped), and `=== true` after the fix. See §Fix.

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

**Confirmed mechanism.** On an in-TUI resume/switch/fork, pi awaits
`session_shutdown` to completion — its handler calls `connection.disconnect()`
(`intentionalClose = true`, `ws = null`) — **then** emits `session_start`. The
`session_start` handler calls `handleSessionChange(ctx)` (bridge.ts, ~line 2022)
**before** `connection.connect()` (bridge.ts:2374). `handleSessionChange` →
`_handleSessionChange` (session-sync.ts) reads `ctx.cwd` while building the
`session_register` frame. `ctx.cwd` is a guarded getter on pi's ExtensionRunner
that **throws once the session is replaced** (new/fork/resume/reload — the exact
replacement case; cf. change `fix-stale-ctx-cwd-crash`). The throw propagates out
of `handleSessionChange`; the handler's `safe()` wrapper swallows it, so the rest
of the `session_start` body — **including `connection.connect()`** — never runs.
The socket the `session_shutdown` closed stays terminally down: no fresh socket,
no re-registration, no auto-reconnect (`intentionalClose` suppresses it). That is
#393. The same throw vector also sits in `startGitPollTimer(ctx)` (`cachedCwd =
ctx.cwd`), which `handleSessionChange` calls before `connect()`.

**Fix (minimal, surgical).** Introduce `safeCwd(ctx)` in `bridge-context.ts` — a
defensive read of the guarded getter that falls back to `process.cwd()` on a
throw (mirrors the existing `readEventCwd` pattern in `project-trust.ts`).
Replace every `ctx.cwd` read on the `session_start` / session-change path with
`safeCwd(ctx)`:

- `session-sync.ts` `_handleSessionChange`: register `cwd`, `detectIsGitRepo`,
  `gatherGitInfo` (the pre-`connect()` throw that causes the disconnect).
- `bridge.ts` `startGitPollTimer`: `cachedCwd = safeCwd(ctx)` (second
  pre-`connect()` vector).
- `bridge.ts` `session_start` main body: register `cwd`, `detectIsGitRepo`,
  `sendGitInfoIfChanged`, `sendCwdMissingIfChanged` (post-`connect()`; a throw
  here would leave the resumed session unregistered + without heartbeat/git
  timers — dead in the UI).

With the getter read guarded, `handleSessionChange` completes, `connect()` is
reached, and the buffered `session_register` flushes on the fresh socket — the
connection ends live and re-registered, satisfying the outcome contract in
`specs/bridge-extension/spec.md`. Validated by `bridge-resume-disconnect.test.ts`
(#X1 red→green; #F1–F4/#E1/#X2 regression guards). No test was weakened to reach
green — the code was fixed.

### Doubt-review (D2) — causal claim cross-examined

- *Claim:* the disconnect is caused by a pre-`connect()` throw, not by
  `connect()` never re-running. *Evidence:* #X1 fails ONLY when the throw is
  injected before `connect()`; the happy-path #F1–F3 already pass on the unfixed
  code (connect() re-runs fine when nothing throws). Consistent with the
  "Why the obvious theory is wrong" section.
- *Claim:* `safeCwd` is sufficient. *Evidence:* it removes the throw at its
  source, so `handleSessionChange` runs to completion and every downstream step
  (connect, register, timers) executes. #X1 green confirms recovery + re-register.
- *Residual (M1 backstop):* the L1 model mirrors the `switchSession`
  await-ordering and the session-sync throw vector; the real in-TUI resume path
  fidelity (candidate #3) is verified by the M1 manual test.
