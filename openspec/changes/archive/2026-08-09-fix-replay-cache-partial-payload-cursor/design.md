## Context

`packages/client/src/lib/replay/` implements Strategy A of
`reduce-session-replay-traffic`: a per-session raw event buffer is flushed on a
debounce to IndexedDB as `{sessionId, schemaVersion, maxSeq, payload, lastAccess}`,
and on load `rehydrateSession` re-reduces the payload and hands the caller a
cursor so it delta-subscribes (`lastSeq = maxSeq`) instead of full-replaying.

Two facts collide:

1. `browser-gateway`'s `broadcast()` fans a live `event` to **every** browser
   socket, regardless of which sessions that socket subscribed to.
2. `useMessageHandler` calls `replayPersister.record(sessionId, [{seq, event}])`
   unconditionally on receipt.

So a tab accumulates buffers for sessions it never opened. `replay-persist.ts`
derives the cursor from the buffer itself (`maxSeqOf(buf)`), so such a buffer
persists as `{maxSeq: <high>, payload: [one stray row]}` — self-consistent, but
representing none of the session's history. It is a **cursor without provenance**.

Field case: session `019fd8d5` showed only `/reload completed`. The server was
healthy (`loadAndReplay` → 277 events in <100 ms) and a fresh browser rendered
everything; the affected browser stayed blank across every reload because each
reload re-persisted the same entry. Clearing site data was the only fix.

## Goals / Non-Goals

**Goals:**

- A persisted cursor is only ever derived from a buffer that descends from a
  replay this tab received.
- Already-poisoned browsers self-heal on upgrade, with no user action.
- No regression to the delta-replay traffic reduction for legitimately seeded
  sessions.
- No protocol change, no server change.

**Non-Goals:**

- Changing the broadcast fan-out so live events only reach subscribers. That is a
  server-side change with its own blast radius (plugin events, session cards, and
  the sidebar all rely on unsubscribed fan-out today).
- Detecting gaps that arrive inside `event_replay`. Compaction drops events
  without rewriting seqs, so a replay-path gap is indistinguishable from a
  legitimate compaction hole client-side.
- Any change to `rehydrate-session.ts` semantics.

## Decisions

### D1: Provenance flag, not a sequence-number heuristic

A per-session `descended: boolean` lives beside the buffer in
`createReplayPersister`. `flush()` persists only when `descended` is `true`.

Provenance is established by the **kind of message**, not by its first seq:

- `seed()` (rehydrate hit, and the `shouldReset` replay path) sets it `true`.
- `record()` called with a **replay batch** sets it `true`.
- `record()` called with a **live broadcast event** does not.

This requires distinguishing the two `record()` call sites in
`useMessageHandler` — the `event` case (live) and the `event_replay` non-reset
case (replay) — e.g. via an explicit origin argument. It is deliberately NOT
gated on `shouldReset`: that flag is
`firstSeq === 1 || firstSeq <= maxSeq` (`useMessageHandler.ts:632`), so a cold
subscribe whose replay was compacted or capped begins at `seq > 1`, does not
reset, and takes the `record()` path. Gating provenance on `shouldReset` would
leave those sessions permanently unpersistable — the traffic regression this
design exists to avoid. A replay envelope only ever arrives in answer to this
tab's own subscribe, which is what makes it authoritative.

*Alternative rejected — require the payload to start at `seq 1`.* This was the
first draft and is **wrong**: `replay-compaction.ts` explicitly never rewrites
seq values ("the client's `getEvents` filter tolerates gaps"), `MAX_REPLAY_EVENTS`
may trim a replay to a tail, and the existing scenario *"A healthy cache entry
still delta-rehydrates"* plus `rehydrate-session.poisoned-cache.test.ts` assert
that a payload starting at `seq 5` is healthy. A seq-1 rule would reclassify
correct entries as poison and force permanent full replays — regressing the exact
traffic reduction this capability exists to deliver.

*Alternative rejected — gate `record()` on subscription state in
`useMessageHandler`.* Pushes replay-cache policy into the message handler and
couples it to `subscribedRef` lifetimes; the persister already owns buffer policy.

### D2: Skip the persist; never delete

On a non-descended flush the persister returns without writing. It does **not**
call `cache.delete()`.

The store is shared across tabs while buffers are per-tab. A delete would let a
tab that merely observed a broadcast destroy a sibling tab's valid cursor,
producing avoidable full replays — a self-inflicted version of the very traffic
cost this capability removes.

### D3: Silent skip, no hot-path log

Non-descended flushes are **normal** in multi-session use: every background
session receiving broadcast events hits this path on every debounce. A log line
per skip would be a steady stream, not a signal. The rejection is silent; the
existing `[rehydrate]` warning still covers the genuinely exceptional
re-reduce-failure path.

### D4: Live-path gap voids provenance

`record()` already appends only events with `e.seq > max`. It additionally
compares against `max + 1`: a jump marks the buffer non-descended, so it stops
being persisted until re-seeded.

Live frames are contiguous by construction, so a jump means a lost frame —
`browser-gateway` drops frames under `MAX_WS_BUFFER` back-pressure and counts them
in `droppedBufferedFrames`. A cursor built over a hole would skip those events
permanently. This check is confined to the live path (D-non-goal above covers the
replay path).

### D5: Schema bump for one-shot field repair

`REPLAY_CACHE_SCHEMA_VERSION` is incremented. Pre-change entries carry no
provenance marker, so a poisoned one is indistinguishable from a healthy one;
`replay-cache.get()` already purges on `schemaVersion` mismatch, so the bump
repairs every affected browser on first read at the cost of one full replay per
session per user, once.

*Alternative rejected — a targeted heuristic purge* (e.g. "payload shorter than N
with a high maxSeq"). Unfalsifiable thresholds, and it would still miss entries
that hold a handful of stray rows.

## Risks / Trade-offs

- **One-time traffic spike on upgrade** (every session full-replays once after the
  schema bump) → bounded, identical to the existing schema-bump path, and only
  paid once per browser.
- **Replay-path gaps remain trusted** → accepted; closing this needs a
  server-supplied coverage hint in the replay envelope. Recorded as a known
  limitation, not silently ignored.
- **`flush()` landing after `drop()`** can resurrect a pre-reset entry → existing
  coupling, unchanged by this design; self-heals downstream because
  `lastSeq > server maxSeq` triggers `session_state_reset`.
- **Provenance is per-tab, not per-entry** → a stored entry does not record which
  tab wrote it. Two tabs on the same session both descended is fine (identical
  data); a descended and a non-descended tab no longer conflict because the
  latter never writes.

## Migration Plan

1. Land the persister change plus the `REPLAY_CACHE_SCHEMA_VERSION` bump together
   — the bump is what repairs the field, the persister change is what stops
   re-poisoning.
2. Rollback: revert both. A downgraded client sees a newer `schemaVersion` and
   purges the entries, degrading to full replay — safe, no corrupt state.

## Open Questions

None blocking. The broadcast fan-out narrowing (server-side) is a plausible
follow-up but is deliberately out of scope here.
