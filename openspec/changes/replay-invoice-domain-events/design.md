# Design — replay-invoice-domain-events

## The one design question: how to make a late subscriber converge

`ib_domain_event` reaches the browser correctly while live, but the server keeps
no memory of it. A surface that mounts/fetches after the delta never catches up.
The fix mirrors the already-proven `plugin_intents` pattern, adapted to the fact
that domain events are **global** (not per-session-subscribe) and are addressed
by **invoice**, not session.

## Decision 1 — retain LATEST-per-key, not a bounded log

**Choice:** cache the single most recent frame per key (a `Map`), exactly like
`PluginIntentCache`.

**Why:** board surfaces want *current truth*, not history. The board renders the
invoice's current state; replaying the latest `ib_invoice_state_changed` per
invoice converges it. A bounded event *log* would (a) grow with churn, (b) force
consumers to fold an ordered sequence at connect, and (c) risk double-application.
Latest-per-key is idempotent to replay: applying it twice yields the same state.

**Cost:** intermediate transitions are not replayable after the fact. Acceptable —
the live stream already delivered them to connected clients, and a late joiner
only needs the *current* resting state, which is the latest frame.

## Decision 2 — key = eventType + best-effort entity id (invoice_id lives in data)

The envelope is `{ type:"ib_domain_event", sessionId, event:{ eventType, data } }`.
It is **not** invoice-addressed at the top level; `invoice_id` lives inside
`event.data`. So the cache key is derived:

```
key = `${eventType}\u0000${entityId}`
entityId = data.invoice_id ?? data.id ?? data.connector_id ?? data.which ?? ""
```

- Invoice lifecycle events (`ib_invoice_state_changed`, `ib_invoice_progress`,
  `ib_invoice_cost_updated`, `ib_approval_*`) key by `invoice_id` → one live entry
  per invoice per type, so each invoice converges independently.
- Non-invoice events (`ib_connector_*`, `ib_intake_*`, `ib_automation_*`,
  `ib_source_*`) key by their own id (or bare eventType) → the latest connector /
  intake / automation state also converges.

Keying is a pure function of the frame; no schema coupling beyond reading a couple
of well-known optional fields, all guarded.

## Decision 3 — bound memory by entry count + session-scoped purge

- Hard cap `MAX_ENTRIES` (500). On overflow, evict the oldest-inserted key
  (insertion-ordered `Map`, delete-then-set to refresh recency on update). 500
  distinct (invoice×type) keys is far beyond any realistic live board and bounds
  worst-case memory at a few hundred small frames.
- `clearForSession(sessionId)` drops entries whose originating `sessionId`
  matches, wired to session removal so a torn-down session's stale frames do not
  replay forever. (The board key is invoice-based, but each entry retains its
  originating `sessionId` for this purge and for the replayed frame.)

## Decision 4 — replay is distinguishable via `replay: true`

Live frames are emitted exactly as today (`replay` **absent**). Replayed frames
carry `replay: true`. Contract for consumers: a `replay:true` frame is an
**idempotent state-set** (converge to it), never an incremental delta — so a
counter/animation driven by live deltas is not advanced twice. This is the
"cannot double-apply" guarantee. The field is optional and additive, so a client
written against the old shape ignores it and still applies the (idempotent) state.

## Decision 5 — replay on browser CONNECT (global), not on session subscribe

`plugin_intents` replays inside `handleSubscribe` because intents are
session-scoped. Domain events are global and the board is not a session
subscription, so replay belongs in the **on-connect snapshot block** of
`browser-gateway.ts` (alongside `sessions_snapshot`, `pinned_dirs_updated`,
`openspec_update`, …). Every newly connected browser receives the current cached
domain-event state immediately, with no subscribe required.

## Decision 6 — one observability log at the choke point

At the `broadcastToSubscribers` interceptor, emit a **rate-limited** info line
(every Nth `ib_domain_event`, e.g. 1/50) naming the eventType + entityId. This is
purely additive logging on the fan-out path — NOT a forward-path change — and
directly answers the prior misdiagnosis where an unlogged happy path read as
"zero events". No happy-path log existed before; now the next incident is
greppable.

## What is deliberately NOT done

- The forward path (engine `__ib_emit_*` → bridge → `plugin_pi_message` →
  `registerPiHandler` → `broadcastToSubscribers`) is unchanged — proved correct.
- No change to automation-plugin or invoicebot-plugin dispatch/fan-out.
- No client rendering logic (board React lives in the UI repo); this change only
  makes the state *recoverable* and *marked*, which the client consumes.
