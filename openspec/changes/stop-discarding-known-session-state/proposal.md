# Stop discarding what the dashboard already knows

## Why

Session `01a09cef` froze for 28 minutes, showed a normal card the whole time,
died, showed a plain `ended` — and then silently swallowed the prompt sent to
revive it. Facts that would have explained each step were available to the
system at the moment they mattered, and each was dropped instead of surfaced.

**1. A user prompt was discarded in the browser, and the UI blamed the session.**
`packages/client/src/hooks/useWebSocket.ts:115`:

```ts
const send = useCallback((msg: BrowserToServerMessage) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify(msg));
  }
}, []);
```

No `else`, no queue, no return value. When the socket is not `OPEN` — every
exponential-backoff reconnect window — the message is dropped and no caller can
tell. The prompt to revive `01a09cef` never reached the server: its log tail ends
at `grace period expired` with **zero** auto-resume lines. 30 s later
`usePendingPromptTimeout` produced *"No response from session — the prompt may
not have been received."* The client **knew at send time** and discarded it.

**2. The same silent drop exists two hops deeper.** Even when the browser socket
is open, `session-action-handler.ts:417-419` does
`if (!sent) console.error("no bridge connection")` — no `emitCommandFeedback`,
nothing reaches the client, same misleading 30 s timeout. During this incident
the *bridge* was flapping, so this leg is not hypothetical. A third instance:
`:336-340` returns bare on a missing `sessionFile` (16 ended sessions have
`sessionFile: null` and can never be revived by typing).

**3. Death was classified and then dropped.** `01a09cef` ended with
`closedReason: null`, `movedTo: null` — indistinguishable from a clean exit. The
codebase has fought this twice and stopped short: `Session.movedTo` exists
because *"a plain `ended` with no explanation is indistinguishable from a crash,
which is the exact confusion this field exists to remove"*
(`packages/shared/src/types.ts:177`), and `closedReason` already carries
`"manual"` for user shutdown. Every *involuntary* death is unlabelled.

**4. Host pressure was measured, shipped to the browser, and rendered nowhere.**
The bridge sends `ProcessMetrics` on every 15 s heartbeat; the server stores it on
the session record (`pi-gateway.ts:822`), so it is already on the shared `Session`
type (`types.ts:397`) and already rides `sessions_snapshot` / `session_updated` —
**43 live sessions are carrying it on the wire right now**, including
`eventLoopMaxMs` and `loadAvg1m`. Yet `grep -rn "processMetrics"
packages/client/src` → **zero hits**. The data reaches the browser and is thrown
away at the last step. Diagnosis instead required 347k lines of `server.log`,
absent `.ips` files, and `sysctl vm.swapusage` (the real cause: 16.9 GB of
18.4 GB swap, 3.59M pageouts).

The unifying defect: **the dashboard holds the fact that explains the failure and
drops it on the floor.** This also reframes the deferred WebSocket back-pressure
defect as non-cosmetic: saturation destroys **user intent on the reverse path**,
not just transcript display.

## What Changes

### Honest delivery of user intent

Both legs, because a verdict that says "sent" when the prompt dies one hop later
is the same dishonesty relocated:

- **Browser→server.** `send` returns a delivery verdict instead of `void`. A
  prompt never transmitted is marked failed **immediately** rather than after
  30 s with a misleading message.
- **Server→bridge.** The `!sent` path at `:417-419` and the missing-`sessionFile`
  return at `:336-340` emit `emitCommandFeedback`, as the neighbouring
  `liveHolder` guard already does.
- **Outbox invariant — queued means never-sent.** A bounded outbox holds *only*
  messages refused while `readyState !== OPEN`, and pops before flush. It must
  **not** retransmit sent-but-unacked messages: `send_prompt` forwards straight
  to the bridge and is **not idempotent**, so a retransmit duplicates the prompt
  in the transcript. A bridge ack exists (`event-wiring.ts:1600`) and will tempt
  exactly this; the spec forbids it.
- **The 30 s/30 s collision is explicit.** Reconnect backoff caps at `30000`
  (`useWebSocket.ts:69`) and the pending-prompt timeout is `30_000`
  (`usePendingPromptTimeout.ts:3`). A queued prompt can flush at the instant the
  UI declares it failed — then the flush *and* the user's retype both deliver.
  Outbox entries expire before that boundary.
- Vocabulary stays honest about itself: `ws.send()` on an OPEN socket is
  *handed to the OS*, not *delivered*.

### Honest session death

- Extend the **existing** `closedReason` — not a third vocabulary beside
  `movedTo` and `closedReason`.
- **Two seams, not one.** `unregister(id, opts)` has 13 call sites but is **not**
  the only terminal transition: roughly ten set `status: "ended"` via `update()`
  or object spread, including `session-action-handler.ts:269/284` (reload-spawn
  failure — an *involuntary* death, exactly the class this change exists to
  label), `event-wiring.ts:509/1677`, and `terminal-manager.ts:300/418`. The
  design covers both seams or picks a lower one; an earlier draft claimed a
  single chokepoint and was wrong.
- **Persistence routes through `setLiveness`, not the session record.**
  `session-to-meta.ts` does not enumerate `closedReason` and is a documented FULL
  OVERWRITE; the field survives only via `metaPersistence.setLiveness`
  (`:911`, `:1170`) or `writeNow`'s on-disk carry-forward. Setting
  `session.closedReason` and trusting the routine save silently wipes it.
- **Only provable reasons.** SIGKILL, OOM, crash and a pulled cable are identical
  to the server: silence. Classification probes the known `session.pid` at grace
  expiry. `pid` is bridge-self-reported and **optional**, and pids recycle — so
  the vocabulary includes an explicit `unknown` for no-pid and states the
  recycling caveat. No claim to identify SIGKILL specifically.

### Visible host pressure

- **Freeze detected out-of-band.** A blocked event loop cannot fire its own 15 s
  heartbeat, so self-reported `eventLoopMaxMs` only describes a stall already
  *recovered from*. The primary signal is server-side elapsed silence;
  `eventLoopMaxMs` corroborates retroactively. Both surfaced, each labelled.
- **Zero new transport.** The indicator renders the `processMetrics` already
  present on every session row the client receives. No new endpoint, no new
  polling loop, no added socket load — the bytes are already being sent and
  discarded.
- **No retained history.** An earlier draft proposed a per-session metrics ring
  so the 118 s → 157 s escalation would survive. It is **cut**: it would require
  a new endpoint, server-side storage outliving `listActive()`, and an eviction
  rule — the only item in this change that adds a capability rather than fixing a
  lie. Consequence accepted honestly: metrics remain latest-only and still vanish
  when a session leaves `listActive()`, so a *post-mortem* of a dead session is
  not improved. What improves is seeing pressure **while it is happening**.
- An always-on card health indicator, and `ended` labelled from `closedReason`.

Non-goals:

- **The back-pressure fix itself** (terminating chronically saturated sockets)
  stays a separate change. This change makes its *consequences* honest and
  survivable.
- **Reconnect/backoff tuning.** The outbox tolerates the existing window.
- **Host-pressure remediation.** The dashboard cannot fix an over-committed host,
  only stop hiding it.

## Capabilities

### New Capabilities

- `user-action-delivery-verdict` — the browser→server leg: `send` returns a
  verdict, the never-sent-only outbox invariant, flush/expiry vs the 30 s
  boundary, and how an undelivered action is surfaced.
- `session-death-attribution` — the `closedReason` vocabulary for involuntary
  endings, coverage of BOTH terminal seams, persistence through the
  `session-to-meta` overwrite trap, and the limits of pid-probe classification.
- `session-host-pressure-indicator` — card indicator rendered from the existing
  session-row `processMetrics`, out-of-band silence vs retroactive
  `eventLoopMaxMs`, thresholds, and unknown/absent states (`processMetrics` and
  `eventLoopMaxMs` are both optional; `monitorEventLoopDelay` may be
  unavailable).

### Modified Capabilities

- `shutdown-session-recovery` — owns `closedReason` today (`"manual"`). This adds
  involuntary-death values to its **vocabulary**. `isRecoveryCandidate`
  (`session-meta.ts:249-255`) tests `!== "manual"`, so new values pass through
  unchanged — the predicate is **not** modified. An earlier draft claimed a
  semantics change; that was an overclaim, and touching the predicate would add
  regression surface for no benefit.
- `pending-prompt-safety` — owns the 30 s timeout and its "may not have been
  received" message. A known-undelivered prompt fails immediately instead, and
  that wording is reserved for the genuinely unknown case.
- `auto-resume-on-prompt` — currently specifies the drop *explicitly*: "the
  prompt SHALL be dropped (same as current behavior)". The server→bridge leg and
  the missing-`sessionFile` path must emit user-visible feedback.

## Impact

| Area | Change |
|---|---|
| `packages/client/src/hooks/useWebSocket.ts` | `send` returns a verdict; bounded never-sent-only outbox |
| `packages/client/src/App.tsx` | Prompt path consumes the verdict; honest failure message |
| `packages/client/src/` | Card health indicator; `ended` reads `closedReason` |
| `packages/shared/src/types.ts` | `closedReason` vocabulary extended (`processMetrics` unchanged) |
| `packages/server/src/browser-handlers/session-action-handler.ts` | `:336-340` and `:417-419` emit feedback; `:269/284` stamp a reason |
| `packages/server/src/session/memory-session-manager.ts` | `unregister` stamps a reason (one of two seams) |
| `packages/server/src/event-wiring.ts`, `terminal/terminal-manager.ts` | `update()`-based terminal sites stamp a reason (second seam) |
| `packages/server/src/persistence/meta-persistence.ts` | Reason persists via `setLiveness` — **not** the session record |
| `packages/server/src/pi/pi-gateway.ts` | Grace-expiry pid probe (heartbeat path unchanged) |
| Breaking changes | **None** — `SessionStatus` unchanged, every field optional |

## Discipline Skills

- `observability-instrumentation` — the change exists to make runtime state
  diagnosable.
- `doubt-driven-review` — two cycles applied. Cycle 1 overturned the original
  design; cycle 2 disproved the "single chokepoint" claim, found the second
  silent-drop leg, the `setLiveness` persistence trap, the 30 s/30 s collision,
  and a missing transport. Re-apply before the `closedReason` vocabulary stands.
- `systematic-debugging` — the dropped-prompt defect was found by evidence
  (absent log lines) after two plausible hypotheses were falsified.
- `performance-optimization` — **not** applicable. Root cause was host swap
  thrash, not an in-process bottleneck; treating it as an optimization problem is
  the specific mistake this change avoids.
