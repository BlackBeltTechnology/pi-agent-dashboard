# Design — stop-discarding-known-session-state

Four defects, one shape. This document settles the three decisions that are not
obvious from the specs, and states the risks I am accepting rather than burying.

## D1 — Where to stamp the death reason

This is the riskiest decision in the change. A *partially* labelled death is
worse than an unlabelled one: it presents an authoritative reason that may be
wrong, and `movedTo` exists precisely because the codebase has been burned by
ambiguous endings before.

Cycle-2 review disproved the original "single chokepoint" premise.
`sessionManager.unregister(id, opts)` has 13 call sites, but roughly ten terminal
transitions bypass it entirely:

| Site | Nature |
|---|---|
| `session-action-handler.ts:269,284` | reload-spawn failure — **involuntary** |
| `session-action-handler.ts:342` | zombie normalization (already reasoned about) |
| `session-action-handler.ts:1179,1204` | force-kill ladder |
| `event-wiring.ts:509` | non-crash end |
| `event-wiring.ts:1677` | session move (`movedTo` already set) |
| `terminal-manager.ts:300,418` | stale terminal entries |
| `session-scanner.ts:453`, `session-bootstrap.ts:55`, `session-archive.ts:296` | cold-start / archive reconstruction, not live deaths |

### Options

**A. Patch every call site.** Explicit and greppable, but ten edits with no
structural guarantee — the eleventh site added next quarter silently regresses,
and the cold-start reconstruction sites would need care to avoid inventing
reasons for sessions that ended before this feature existed.

**B. Stamp inside the `→ ended` transition.** `update()` and `unregister()` both
converge on the session record. Detecting the transition to `ended` centrally and
defaulting to `unknown` gives a structural guarantee: no path can produce an
unlabelled death. Call sites that know better pass an explicit reason.

**Chosen: B, with A's explicitness on top.** The central transition guarantees
*a* reason exists; the involuntary sites that know their cause (spawn failure,
carrier loss) pass it explicitly. The specs pin this with a test that fails if
any terminal path can produce an `ended` session with no reason.

**Risk accepted:** option B touches a hot, central code path used by every
session mutation. The transition detection must be exact (`status !== "ended"` →
`status === "ended"`), or a no-op update on an already-ended session could
overwrite a good reason with `unknown`. That specific regression gets a test.

**Cold-start sites are excluded from labelling.** `session-scanner`,
`session-bootstrap` and `session-archive` reconstruct history from disk; they are
not deaths happening now. They read whatever reason is already persisted and
SHALL NOT synthesize one.

## D2 — Persistence must not use the obvious path

`session-to-meta.ts` is a documented FULL OVERWRITE and does not enumerate
`closedReason`. The field reaches disk only via `metaPersistence.setLiveness`
(how `"manual"` does it today, at `:911` and `:1170`) or `writeNow`'s on-disk
carry-forward.

So the obvious implementation — set `session.closedReason` and let the 1 s
debounced save handle it — **silently wipes the field**. The proposal's own
Impact table documented this trap and an earlier draft walked into it anyway.

Terminal paths route the reason through `setLiveness`, alongside the eager
`{ live: false }` write the recovery spec already requires. This is convenient:
that write is already eager and atomic on the unregister path, which is exactly
the durability the reason needs.

**Consequence:** the reason and the liveness marker are written together, so a
death that fails to persist liveness also fails to persist its reason. That is
the correct coupling — both describe the same event.

## D3 — Outbox: the tempting design is the wrong one

`send_prompt` forwards straight to the bridge and is **not idempotent**. A bridge
ack exists (`event-wiring.ts:1600`), which makes "retransmit unacked messages on
reconnect" look like the natural robust design. It is a duplicate-prompt
generator: a prompt handed to the OS, received by the server, and acked after the
socket dropped would be sent twice and appear twice in the transcript.

**Invariant: the outbox holds only messages that were never handed to a socket**
— those refused because `readyState !== OPEN`. Entries pop before flush.

### The 30 s/30 s collision

Reconnect backoff caps at `30000` (`useWebSocket.ts:69`); the pending-prompt
timeout is `30_000` (`usePendingPromptTimeout.ts:3`). These are equal, so a
queued prompt can flush at the exact moment the UI declared it failed — the
user retypes, and both deliver.

Outbox entries therefore expire strictly before the pending-prompt deadline.
Choosing an expiry meaningfully below 30 s (e.g. 10 s) keeps the flush window
clearly inside the period where the UI still considers the prompt live.

**Risk accepted:** a reconnect slower than the expiry loses the prompt. That is
the correct trade — the user sees an honest immediate failure and can retry,
which is strictly better than today (silence, then a lie, then a possible
duplicate).

## D4 — Pressure indicator needs no transport, and why the freeze signal inverts

`processMetrics` is on the shared `Session` type and already rides
`sessions_snapshot` / `session_updated` — 43 live sessions carry it on the wire
today. The client discards it at the last step. The indicator is therefore pure
rendering: no endpoint, no polling, no added socket load.

**The freeze signal must be out-of-band.** A blocked event loop cannot fire its
own 15 s heartbeat, so `eventLoopMaxMs` can only ever describe a stall already
*recovered from*. In the motivating incident the session reported
`silent=122242ms` against a 60 s threshold — the stall was visible only as
server-side silence, never as a self-report. Primary signal: elapsed time since
the last frame. `eventLoopMaxMs` is retroactive corroboration and is labelled as
past, not present.

**Known false-positive, stated rather than hidden:** the client derives staleness
from timestamps in session rows it has received. If back-pressure drops a
`session_updated` frame — the very defect this change does not fix — the row goes
stale and a healthy session can render as unresponsive. This is acceptable
because it errs toward *showing* trouble rather than hiding it, which is the
whole thesis. It also makes the deferred back-pressure fix more visibly
worthwhile.

## What this change deliberately does not do

- **Does not fix WebSocket saturation.** Terminating chronically saturated
  sockets remains a separate change. This one makes saturation's consequences
  honest and survivable.
- **Does not retain metrics history.** Cut deliberately; post-mortem of a dead
  session is not improved. Seeing pressure *while it happens* is.
- **Does not name kill mechanisms.** SIGKILL, OOM, crash and a severed link are
  indistinguishable from the server. The pid probe distinguishes gone from
  unresponsive, admits `unknown` when no pid was reported, and carries the
  pid-recycling caveat. Claiming more would repeat the overclaiming this change
  exists to end.

## Review-round corrections (round 3)

A cross-model adversarial review of the implementation surfaced three blocking
defects, all fixed before landing:

1. **The `Fork instead` exit was impossible.** It sent `resume_session
   mode:"fork"`, but the server's `sessionFile` guard rejects EVERY resume mode
   for a null `sessionFile` (`resume.session_file_unknown`). The action is now a
   fresh spawn in the same folder — the only exit that works — keeping the
   approved `Fork instead` copy.
2. **The `update()` seam did not persist its reason.** The durable write lived
   only in `onUnregister`, so an `update()`-based ending (reload-spawn failure,
   zombie normalization, move) was labelled in memory + broadcast but wiped by
   the next full `.meta.json` overwrite. A shared `onEnded` hook now fires on the
   exact terminal transition from BOTH seams and writes liveness + reason
   eagerly; `onUnregister`'s now-duplicate write was removed.
3. **`classifyCarrierLoss` probed foreign pids.** A remote-origin session's pid
   lives in another host's PID namespace, so a local probe false-`ESRCH`ed and
   asserted `process_gone` about a running remote pi. Remote origin now yields
   `unknown` without probing.

Accepted limitations (flagged by the reviewer, deliberately not fixed):

- **Outbox identity is keyed on `(sessionId, text)` only.** A user who retypes
  the EXACT same prompt (and images) into the same session while the first copy
  is still queued can have the stale expiry mark the second bubble failed.
  Narrow (10 s window, byte-identical text) and it errs toward an honest
  failure, never a silent drop.
- **Non-prompt outbox entries do not expire** (design D3 keeps them until
  capacity eviction), so an `abort`/steer clicked during a long outage replays on
  reconnect. Accepted: expiring intent would silently discard user commands, and
  the risky entries are rare beside idempotent subscriptions.
- **Clock skew.** Staleness is browser `Date.now()` minus server-stamped
  `updatedAt`; a remote dashboard with gross skew could mis-colour every card.
  Same-host and normal-NTP deployments are unaffected, and the error direction
  is toward *showing* trouble.
- **`eventLoopMaxMs` jitter corroboration.** Any positive value renders as
  "stalled earlier", including sub-frame jitter. Cosmetic noise on an already
  flagged card; a threshold would need evidence this change does not have.
