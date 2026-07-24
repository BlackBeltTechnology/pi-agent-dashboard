# Fix Bridge Resume Disconnect

## Why

Resuming or switching a session inside the pi TUI **permanently disconnects the
bridge from the dashboard** (GitHub issue #393). It does not auto-reconnect; a
browser refresh, `/reload`, and re-registration all fail to recover it — only a
brand-new `pi` process reconnects. Confirmed by the reporter on
pi-agent-dashboard 0.6.1 / pi 0.81.1.

**The obvious root cause is refuted — the real mechanism is not yet established.**
The issue (and an initial draft of this proposal) blamed the `session_shutdown`
handler calling `connection.disconnect()` unconditionally, with the theory that
`session_register` from the following `session_start` is buffered into a dead
socket "because `connection.connect()` only runs once at bridge init." Source +
pi-core verification **disproves that chain**:

- `connection.connect()` is a single call site at `bridge.ts:2374`, **inside**
  the `session_start` handler (which spans `bridge.ts:2007–2680`) — NOT a
  once-at-init call. Statically there is no handler-level `return` between the
  reason-branch (2016–2023) and 2374, so on a resume where the handler body runs
  to completion, `connect()` is reached. (Whether it is *actually* reached on
  every resume is dynamic — it depends on nothing throwing earlier in the body,
  which is exactly the open question below.)
- pi does **not** interleave shutdown and start. `agent-session-runtime.js`
  `switchSession` does `await teardownCurrent("resume")` — which `await`s the
  bridge `session_shutdown` handler **to completion** (its 100 ms sleep and
  `connection.disconnect()` included) — **before** `createRuntime` emits
  `session_start`. (`emitSessionShutdownEvent` in `extensions/runner.js` awaits
  `extensionRunner.emit`, which fully awaits each handler body.)

So the happy-path sequence is: full shutdown (disconnect, `ws = null`,
`intentionalClose = true`) → **then** `session_start` → `handleSessionChange`
(register, buffered) → `connection.connect()` (fresh socket, buffer flush). **If**
the `session_start` body runs unbroken, resume recovers. Since it does not, the
likeliest explanation is that the body is aborted before `connect()` — turning
the fix from "gate the disconnect" into "find and contain what breaks the resume
re-registration path."

**Leading hypothesis (unproven):** something in `handleSessionChange(ctx)`
(`bridge.ts:2022`, before `connect()` at 2374) throws. A thrown error's own
control-flow abandons the rest of the async body — so `connect()` is skipped and
the shutdown's disconnect stays terminal. (`safe()` only decides whether the
rejection is *logged*; it does not cause the skip — the throw does. So the spike
must instrument the **throw site**, not `safe()`.) Concrete candidate throw sites
in `session-sync.ts` `_handleSessionChange`: `extractFirstMessage`,
`getCurrentModelString`, `replaySessionEntries`, `gatherGitInfo`, `getCommands`,
and `startGitPollTimer(ctx)` reading the guarded-getter `ctx.cwd` that throws
after replacement. Other candidates: the fresh `connect()` succeeds but the
server rejects the re-registration; or the in-TUI resume routes through a
different path than `switchSession`. **This change establishes which, with
evidence, before designing the fix.**

## What Changes

Spike-first — reproduce and instrument to establish the real mechanism, then fix
the identified cause:

1. **Reproduce.** Add a failing regression test that drives the resume/switch
   sequence against a faithful model of the bridge's `session_shutdown` →
   `session_start` handlers wired to the real `ConnectionManager` (with a fake
   WebSocket), asserting the post-resume observable: the connection is live and
   the new session is re-registered. Confirm it FAILS, reproducing #393.
2. **Instrument + identify.** Trace the real resume path (`safe()`-wrapped
   handler outcomes, `handleSessionChange` throw/return, `connect()` reached?,
   socket state transitions) to pin the exact point recovery is lost. Record the
   verified mechanism in `design.md`.
3. **Fix the identified cause (minimal, surgical).** Design deferred to the spike
   result. If the cause is the `handleSessionChange` throw, harden the resume
   re-registration so a fresh `connect()` is always reached (or the throw is
   contained without aborting the connection recovery). The fix is validated by
   the reproduction test going green.

Out of scope until the mechanism is known: prescribing *how* the socket survives
(reason-gated disconnect, idempotent connect, contained throw). The spec contract
below is **outcome-based** (the connection survives replacement and re-registers)
and does not bind the implementation.

## Impact

- **Closes:** #393 — bridge permanently disconnects on TUI resume/switch.
- **Risk:** medium — root cause unconfirmed at proposal time; the spike gates the
  fix. The reproduction test is the guard against shipping a fix for the wrong
  cause.
- **Affected specs:** `bridge-extension` (ADDED requirement — outcome contract:
  connection survives session replacement, re-registers; genuine teardown still
  disconnects).
- **Affected code (likely, pending spike):** `packages/extension/src/bridge.ts`
  (`session_start` / `session_shutdown` handlers), possibly
  `packages/extension/src/session-sync.ts` (`handleSessionChange`) and
  `packages/extension/src/connection.ts`.

## Discipline Skills

- `systematic-debugging` — MANDATORY and load-bearing here: reproduce with a
  failing test and gather evidence for the true mechanism BEFORE any fix. The
  proposal's first-draft cause was refuted by this discipline; do not re-guess.
- `doubt-driven-review` — the fix design (once the spike concludes) asserts a
  causal claim; cross-examine it against the reproduction evidence before it
  stands.
- `node-inspect-debugger` — the resume path is opaque runtime state (jiti-loaded
  extension, awaited teardown, `safe()`-swallowed throws); a breakpoint on
  `handleSessionChange` / `connect()` may be needed to pin the mechanism.
