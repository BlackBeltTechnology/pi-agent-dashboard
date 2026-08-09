## Context

`memory-event-store.ts` bounds memory with four policies today: a per-string
truncation pass, a per-event serialized-size ceiling, a per-session event-count
trim, and an LRU session eviction. All four are **size-of-one** or
**count-of-many** policies. None of them bounds *bytes across many events*, which
is the axis `tool_execution_update` grows on. The server→browser gate shares the
flaw one layer out: `MAX_WS_BUFFER` is checked against the buffer *before* a
send, never against the bytes of the frame being enqueued (D9).

The measured shape (see `proposal.md`): a single `Agent` tool call emits ~250 ms
ticks, each carrying the cumulative subagent timeline (~187 KB), and the buffer
retains all of them.

An adversarial review of the first draft of this design invalidated three of its
assertions. The corrections are recorded inline (D3, D6, D7) rather than quietly
patched, because two of them were the kind of "obviously true" premise that a
test can be built on and pass vacuously.

## Goals / Non-Goals

**Goals**
- Retain one `tool_execution_update` per `toolCallId` per session buffer in the
  common case, without ever losing client-visible state.
- Zero change to what subscribers receive live.
- Make the replay equivalence an ENFORCED precondition, not an assumption.
- Make the shed path observable.

**Non-Goals**
- Reducing WebSocket bandwidth or client-side memory (bridge-side; separate).
- Changing any existing cap value.
- Changing the subagent-timeline truncation carve-out itself.
- Dropping a completed call's final update on `tool_execution_end` (see D3).

## Decisions

### D1 — Collapse at retention, inside `insertEvent`

`insertEvent` is the single choke point that **all five** event ingresses funnel
through:

| Ingress | Call site |
|---|---|
| Live pi events (bridge) | `event-wiring.ts:717` |
| JSONL cold hydration | `subscription-handler.ts:327` |
| Session actions | `session-action-handler.ts:83` |
| Terminal events | `terminal-handler.ts:35`, `:86` |
| Async attachment resolve | `attachment-resolver.ts:47` |

A policy enforced there holds regardless of ingress. Today only the bridge emits
`tool_execution_update` (the JSONL parser and `shared/state-replay.ts` synthesize
only `tool_execution_start` / `_end` / `message_*` / `turn_end` — verified), so
rehydrated buffers are update-free and collapse only bites the live buffer. Live
and post-restart buffers therefore already differ in update population; this
change widens that difference, which is admissible only because D7 preserves
folded state.

**Alternative rejected — bridge-side suppression.** At send time the successor
does not exist yet, so the bridge cannot tell a needed live tick from a
soon-to-be-superseded one. Suppression there necessarily degrades the streaming
view. It also cannot cover the four non-bridge ingresses. Bandwidth reduction
remains a legitimate but separate change with a real UX trade to weigh.

### D2 — Broadcast is unaffected, by construction

```js
const seq = eventStore.insertEvent(sessionId, prepared.event);
if (!replayingSessions.has(sessionId)) {
  const storedEvent = eventStore.getEvent(sessionId, seq) ?? prepared.event;
  browserGateway.broadcastEvent(sessionId, seq, storedEvent);
}
```

Broadcast re-reads by `seq` after insertion. Collapse only removes *earlier*
entries, so the just-inserted event is always present. Verified to hold on the
other broadcasting ingresses too (`terminal-handler.ts:35-41`,
`session-action-handler.ts:83`). No broadcast-path change is required.

### D3 — Keep the newest update per `toolCallId`, even after `tool_execution_end`

**The first draft justified this with a false premise and it is corrected here.**
The draft asserted that a LIVE `tool_execution_end` carries no `details` and
therefore depends on the `toolDetails` written by the final update. That is
wrong: the bridge explicitly lifts `result.details` onto the live end event
(`packages/extension/src/bridge.ts:1876-1884`, change
`flow-agents-readable-list`) precisely so renderers get a structured payload
live rather than only after a replay. A guard test written against the false
premise would have passed vacuously.

The decision to keep the final update nevertheless stands, on honest grounds:

- It is the conservative default. Dropping on completion is a SECOND retention
  policy with its own ordering edge cases (out-of-order `_end`, `healedBy:
  "superseded"` synthetic ends, non-Agent tools whose `result` carries no
  `details` so the bridge lift is a no-op).
- Its marginal value is one event per completed call once collapse is in place —
  ~187 KB against the ~1.2 GB collapse already reclaims.

"Drop the final update on `_end`" is therefore listed as a deferred follow-up,
gated on verifying that a live end's `details` is equivalent to the final running
snapshot across producer versions.

### D4 — Seq gaps are already legal; the newest event is not droppable

The sync protocol is watermark-based: `getEvents(sessionId, lastSeq + 1)` is a
range query and the client tracks `maxSeq` (`coalesce-live-events.ts:33-42`;
reset rule `firstSeq === 1 || firstSeq <= acc.maxSeq` in
`useSessionState.ts:78-96`). There is no `expectedSeq` or contiguity assertion in
server or client. `trimBufferToLimit` already produces gaps at the head; this
change produces them mid-buffer, which the protocol treats identically.

One invariant must hold explicitly: **the buffer's highest-seq event is never
dropped by collapse**, because `getMaxSeq` feeds the stale-`lastSeq` reset branch
in `handleSubscribe`. Keeping the newest update per `toolCallId` satisfies this
naturally — a collapsed predecessor is by definition not the newest — but D6
records the concrete implementation hazard that could violate it anyway.

### D5 — Key on `toolCallId`; absent key ⇒ retain

Collapse is keyed strictly on `data.toolCallId`. An update without one cannot be
proven superseded and SHALL be retained unconditionally. Fail-open: an
unrecognised shape costs memory, never correctness.

### D6 — Seq-keyed index with a VERIFIED lookup; never an array index

**The first draft proposed `Map<toolCallId, seq|index>` and left the mechanism
undecided. The `index` variant is unsafe and is rejected here.**
`trimBufferToLimit` rebuilds the array wholesale (`buf.events = kept`, `:117`)
and `tool_execution_update` is NOT in `ESSENTIAL_CHAT_EVENT_TYPES` (`:73`), so a
retained update can be dropped by trim at any time. Consequences:

- An array **index** is invalidated by every trim rebuild and every collapse
  splice.
- A **seq** can dangle after trim removes the event it names.
- The naive repair `const i = events.indexOf(target); events.splice(i, 1)` is
  actively dangerous: on a miss `indexOf` returns `-1` and `splice(-1, 1)`
  **deletes the last element** — the max-seq event — violating D4 and regressing
  `getMaxSeq`.

Decision:

1. The index is `Map<toolCallId, seq>` — never an array index.
2. Lookup is **verified before removal**: locate the entry, confirm it exists AND
   is a `tool_execution_update` AND carries the same `toolCallId`. A miss (trim
   already removed it) is a no-op that simply records the new seq. A negative
   index must never reach `splice`.
3. The map is cleared with its buffer on LRU evict and `deleteEventsForSession`,
   AND reconciled with trim — a trim that drops a retained update must not leave
   a dangling entry that a later collapse acts on. The verified lookup in (2) is
   what makes a stale entry harmless rather than corrupting.
4. Clearing on evict/delete is a MEMORY requirement, not merely a correctness
   one. `evictIfNeeded` and `deleteEventsForSession` currently know nothing about
   this index; if it is not cleared alongside `buffers`, it accumulates an entry
   per `toolCallId` of every evicted session for the process lifetime — an
   unbounded leak inside a change whose purpose is bounding memory.

**Cost, stated honestly.** Removing a mid-array element is `O(n)` memmove, so
"amortized O(1)" as first claimed is wrong. Two distinct costs must both be
bounded, and an earlier draft conflated them:

1. **Find cost.** The index stores a `seq`, not a position, so the entry must be
   located in `buf.events`. The existing `getEvent` locates by a FORWARD linear
   scan; reusing that would make collapse `O(buffer length)` per insert —
   precisely what this decision must avoid. The lookup SHALL therefore scan
   BACKWARD from the tail (the superseded predecessor is near it) or binary-search
   on `seq` (the array is seq-sorted). A forward scan is forbidden.
2. **Removal cost.** The splice distance from the tail is roughly the number of
   concurrently-streaming tool calls, not the buffer length.

If profiling shows either bound does not hold, the fallback is a tombstone flag
plus a compaction pass reusing the existing `TRIM_SLACK` hysteresis — recorded
here so it need not be rediscovered.

**The perf scenario must be able to fail.** Inserting many updates for a SINGLE
`toolCallId` keeps the buffer at length ~1 and cannot detect an `O(n)` find. The
scenario must interleave MANY `toolCallId`s against a large non-update tail.

### D7 — Superset gate (the correctness core)

**The first draft's central claim — `replay(u₁…uₙ) ≡ replay(uₙ)` — is false as
stated, and this decision replaces it.**

The reducer's update branch has two targets with different semantics:

| Target | Code | Semantics |
|---|---|---|
| `messages[idx].result` / `.toolDetails` | `event-reducer.ts:1841-1845` | unconditional overwrite — idempotent-latest |
| `next.subagents` | `:1856-1884` + `readSubagentDetails:363-389` | `{...existingSub}` merged with a patch whose every field is extracted CONDITIONALLY |

The second is **accumulative**. A field present in an earlier tick and absent
from the retained one survives the full fold and is lost by a naive collapse.
Two live instances:

- `agentSessionId` (`:385-386`) is v7-producer-only and drives the dual-index in
  `setSubagentState` (`:402-410`). Losing it drops a map key and reintroduces
  the lookup-by-session-id miss.
- The `entries: []` guard (`:369-373`) exists because initial and late/reordered
  frames legitimately arrive empty. Collapsing onto such a tick empties the
  timeline.

Therefore a predecessor `p` is dropped in favour of successor `s` **only when `s`
subsumes `p`**:

1. Resolve each event's subagent `details` as `data.partialResult.details` ONLY.
   This mirrors the reducer exactly: its update branch gates on `if
   (partialResult)` and reads `structured.details` (`:1817-1819`); it NEVER falls
   back to a top-level `data.details` for an update — that path belongs to
   `tool_execution_end` (`:1948`). A gate that resolved `data.details` would
   compare keys the consumer never reads and could drop a predecessor on the
   strength of a field that has no effect.
2. If neither carries `details`, the reducer path is the plain-string overwrite
   branch — collapse unconditionally.
3. Otherwise require ALL of:
   - every key present in `p`'s `details` is present in `s`'s `details` AND holds
     a value of the same JS type. Type matters because `readSubagentDetails`
     extracts each field type-conditionally (`typeof details.activity ===
     "string"` etc.); a key present but type-downgraded is "present" to a
     key-only gate and "absent" to the consumer;
   - if `p.details.entries` is a non-empty array, `s.details.entries` is also a
     non-empty array;
   - if `p` sets the rendered `result`, `s` sets it too (see "result has TWO
     sources" below).
4. If the test fails, retain BOTH. The index advances to `s`, so the
   non-subsuming `p` becomes permanently retained for that call and is shed only
   by the ordinary trim/evict policies.

**`result` has TWO sources, not one — a third review round caught this.** An
earlier draft of this decision claimed `partialResult.content` was "the sole
source of the consumer's rendered result". That is false. The reducer sets
`messages[idx].result` from either:

- the **structured** branch — text extracted from `structured.content`
  (`event-reducer.ts:1832-1841`), a SIBLING of `details` under `partialResult`,
  assigned only `if (text != null)`; or
- the **plain-string** branch — `partialResult` IS the string (`:1889`), no
  `content` involved.

So the condition is expressed over the OUTCOME ("does this event set `result`?"),
applying the reducer's own predicate, rather than over the presence of a
`content` key. That closes the mixed-shape case where `p` is a plain string and
`s` is structured-without-`content`: key comparison alone would subsume, yet the
full fold shows `p`'s string as `result` and the collapsed fold shows none.
Expressing it as `content: []` / `content: [{}]` key-presence would also be
wrong, since both extract nothing.

**The creating tick is retained — `type`/`description` are FIRST-wins.** The
subagent entry is built as
`type: existingSub?.type ?? details.subagentType` followed by `...existingSub`
(`:1872-1880`), so `type` and `description` are supplied by whichever update
FIRST creates the map entry and are never overwritten afterwards. Note
`readSubagentDetails` writes `subagentType`, a DIFFERENT key — it does not feed
`type`. A key-presence gate cannot protect a first-wins field: collapsing the
creating tick hands the role to a later tick, and if the values differ the folds
diverge.

Rather than enumerate the first-wins fields (the coupling this gate exists to
avoid), the policy is structural: **the first update per `toolCallId` that
carries `details.agentId` is retained and never collapsed away.** Retention per
call becomes at most two events (creating + newest) plus any non-subsumed
intermediates — ~374 KB against the ~1.2 GB reclaimed, and it preserves
first-wins semantics whatever those fields happen to be.

**This requires TWO pointers per `toolCallId`, not one.** The pinned creating seq
and the current newest seq are independent: when the creating tick IS the current
newest and a subsuming successor arrives, a single-seq index gives contradictory
instructions (the gate says drop, the pin says keep). The index is therefore
`Map<toolCallId, { creatingSeq, newestSeq }>`, and removal is skipped whenever the
resolved predecessor is the pinned `creatingSeq`. An implementation carrying one
seq per call would collapse the creating tick whenever it happened to be the
indexed predecessor — silently voiding the guarantee the pin exists to provide.

**Pinning does NOT survive the per-session trim, and that is acceptable.** The
pinned update is still a non-essential event, so `trimBufferToLimit` may drop it.
This does not break the equivalence contract (which compares collapsed vs
uncollapsed at equal trim state), and the trim-shift works in our favour: with
collapse the buffer stays under the cap far longer, so the creating tick is
*more* likely to survive than today. Recorded so nobody reads the pin as a
trim-proof guarantee.

**Collapse is conditional on events remaining reducible.** An over-ceiling event
that the truncator cannot reduce becomes the `{__truncated}` placeholder, whose
`data` carries NO `toolCallId` — so per D5 it is retained unconditionally and
never collapses. A workload of unreducible updates therefore gets no memory
benefit. The measured workload (~150–200 KB against a 256 KiB ceiling) does not
hit this, but a perf fixture built entirely from placeholder-producing events
would show no collapse and must not be mistaken for a regression in the policy.
Verified separately: on the NON-placeholder path `reduceSubagentEvent` preserves
every top-level `details` key (it clones `details` and mutates only `entries` and
string values), so truncation cannot flip a subsumption outcome by removing keys.

**Accepted trade-off — `agentSessionId` value churn.** `setSubagentState` only
ever `set`s keys, never deletes (`:402-404`), so a full fold that saw N distinct
`agentSessionId` values leaves N orphaned keys pointing at stale snapshots; a
collapsed fold leaves fewer. Retaining creating + newest captures the first and
last values but not middles. This is accepted, NOT solved, on the stated
assumption that `agentSessionId` is a run-scoped identifier that does not change
mid-run. If that assumption is ever falsified the difference is extra stale
orphan keys in the full fold, not a missing live entry.

The gate is a key-set comparison over a ~10-key object per insert — negligible
against the ~187 KB event it guards.

**Consequence for testing:** the equivalence test is only meaningful when it (a)
includes a NON-subsuming tick (missing `agentSessionId`, empty `entries`, absent
`content`), (b) asserts `type`/`description` VALUES rather than mere presence,
and (c) folds an update-only subsequence. Point (c) is not optional: a
`tool_execution_end` carrying `result`/`details` OVERWRITES both
(`event-reducer.ts:1948-1960`), so a fixture ending in one satisfies the
equivalence from the end event alone and proves nothing about the collapsed
updates — the same vacuous-pass shape D3 was corrected for.

### D8 — Collapse shifts which events trim selects

Removing thousands of non-essential updates keeps `buf.events.length` under
`cap + TRIM_SLACK` far longer, so `trimBufferToLimit` fires later and a
*different* set of events survives — e.g. `tool_execution_end` events that would
previously have been trimmed now persist. This is a strict improvement in
retained signal, but it is a behavioural change to a second policy, not a no-op,
and is called out so it is verified rather than assumed. The essential-head
guarantee (`message_start` / `message_end`) is unaffected: collapse never touches
essential types.

### D9 — The catch-up replay frame is a second consumer; collapse helps it but does not bound it

D2 establishes that *live broadcast* is unaffected. That is a statement about one
path and must not be read as covering the transport generally, because a second
path reads the same buffer and is affected:

```js
clearReplaying(targetWs, sessionId, lastReplayedSeq) {
  const catchUp = eventStore.getEvents(sessionId, lastReplayedSeq + 1); // no limit
  sendTo(targetWs, { type: "event_replay", events: catchUp.map(...), isLast: true });
}                                          //  ↑ ALL of it, in ONE frame
```

The main replay path chunks (`isLast: false` batches); this catch-up tail does
not. `sendTo` gates on `ws.bufferedAmount` *before* the send and never on the
frame's own bytes, so the gate cannot stop a single oversized frame — measured
peak `224 897 855` B against a `4 194 304` B limit (see `proposal.md`).

Collapse changes this **only as a consequence**: the buffer it reads gets
smaller, so the frame gets smaller — from ~1 400 updates to one per in-flight
`toolCallId`. Two things follow, and the second is the one that matters:

1. The freeze is removed at its source for the measured shape, so no transport
   change is required to realise the win.
2. The frame is still **unbounded in principle** — `N toolCallIds × ~190 KB`.
   Collapse lowers `N` dramatically but sets no ceiling. Anything that raises
   concurrent-call count, or introduces the next fat event type, re-crosses the
   limit with no test to catch it.

Hence the split: this change **verifies** the frame shrinks (an assertion on a
consequence it causes), and defers the **mechanism** — chunking the catch-up and
measuring serialized frame bytes in `sendTo` — to a transport change that is
correct regardless of event size. Folding the mechanism in here would couple a
transport invariant to a retention policy, which is precisely the coupling that
let the byte axis go unbounded at both layers in the first place.

This is also why the "reducing WebSocket bandwidth" non-goal is not violated:
that non-goal is about *bridge-side wire volume* (D1's rejected alternative).
D9 concerns the server→browser replay frame, a different hop with a different
owner.

### D9 — The health-route shape annotation must be derived, not duplicated

`system-routes.ts:122-124` declares the store's stats shape as an INLINE
structural type on an optional method, duplicated from the store rather than
imported. Adding a field to the store's `TrimStats` therefore still typechecks
against the stale annotation — TypeScript's excess-property check does not fire
on a function return type — so the wire-shape comment silently rots and nothing
fails.

The annotation SHALL be derived from the store's exported `TrimStats` type
instead of restated, so the route cannot drift from the payload it serializes.
This is the difference between "a task says update the annotation" and "the
compiler enforces it".

Deriving the annotation is necessary but NOT sufficient. The route also carries a
fallback literal, `eventStore?.getTrimStats?.() ?? { … }` (`:569-572`), and
TypeScript types `a ?? b` as `NonNullable<A> | B` — it does not require `b` to be
assignable to `A`. A new required field would be tracked by the derived
annotation and silently omitted by the fallback. The fallback literal SHALL
therefore carry an explicit `TrimStats` annotation of its own.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Naive keep-newest loses `agentSessionId` / `entries` from the subagents map | D7 superset gate; equivalence scenario REQUIRES a non-subsuming fixture |
| `type`/`description` are first-wins; collapsing the creating tick can change them | D7 retains the first `agentId`-bearing update per call; scenario asserts VALUES |
| `result` comes from `partialResult.content`, outside the compared `details` | D7 third condition: successor must also yield extractable text |
| Equivalence scenario passes vacuously because a terminal `_end` overwrites `result`/`toolDetails` | Scenario folds an update-only subsequence |
| Perf scenario cannot fail because a single `toolCallId` keeps the buffer at length ~1 | Scenario interleaves many `toolCallId`s against a large non-update tail |
| Collapse index leaks an entry per evicted session | D6(4): cleared with the buffer; scenario covers evict-then-reingest |
| Health annotation silently rots when the counter is added | D9: derive the annotation from the exported `TrimStats` |
| A guard test built on the false "live end carries no details" premise passes vacuously | D3 corrects the premise; the scenario is rewritten to assert the real behaviour |
| Stale index + `indexOf` miss → `splice(-1,1)` deletes the max-seq event | D6 verified lookup; explicit scenario asserts `getMaxSeq` after a trim-then-collapse sequence |
| Adding a counter to `getTrimStats()` breaks the wire shape and an exact-shape test | Treated as an ADDITIVE `/api/health` field; annotation + `toEqual` updated as tasks, not discovered in CI |
| Collapse makes the hot insert path O(n) | D6 states the real bound (`O(concurrent calls)`) and names the tombstone fallback |
| Collapse changes trim selection | D8; scenario asserts the essential head still survives and the buffer stays bounded |
| A future change makes the reducer accumulate on a new field | The generic key-set gate covers new fields automatically — it compares keys, not a hardcoded list |
| The catch-up replay frame shrinks as a side effect, then silently regresses | D9; a scenario asserts the collapsed buffer's `event_replay` frame stays under `MAX_WS_BUFFER`, so the consequence is pinned rather than hoped for |

## Migration

No persisted-format change, no config change. One **additive** `/api/health`
field (`storeTrim.collapsedUpdates`); no existing field changes type or meaning.
Effect appears at the next server start.
