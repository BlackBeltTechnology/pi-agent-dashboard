## Context

See proposal.md — Why. Parent: `collapse-superseded-tool-execution-updates`
(archived `2026-08-11-…`), design D3 and D7.

Current state that shapes the approach (all read from source, not recalled):

- **Store** (`packages/server/src/persistence/memory-event-store.ts`):
  `collapseSuperseded(buf, stored)` returns early unless `stored` is a
  `tool_execution_update`. The `tool_execution_end` event is inserted and never
  consulted by the collapse. Per-`toolCallId` index entry:
  `{ creatingSeq, newestSeq }`. `dropIfSuperseded(buf, prevSeq, toolCallId,
  successor)` performs the D6.2 verified splice and increments
  `collapsedUpdatesTotal`. The gate is `subsumes(p, s)` =
  `keysSurvive` ∧ `entriesSurvive` ∧ (`setsRenderedResult(p)` ⇒
  `setsRenderedResult(s)`), where BOTH sides resolve details via
  `resolveUpdateDetails` (= `data.partialResult.details`) and rendered-result
  via `data.partialResult` presence/`content`.
- **Consequence:** `subsumes(tail, end)` called verbatim is fail-closed but
  useless — an end has no `partialResult`, so `ds = {}` (every tail key
  "missing") and `setsRenderedResult(end) === false` (every content-bearing tail
  "loses its result"). Nothing would ever drop.
- **Client reducer** (`packages/client/src/lib/chat/event-reducer.ts`),
  `tool_execution_end` branch: reads `data.details` (top-level), sets
  `toolDetails = endDetails` WHOLESALE when present (else patches `status`
  onto the existing toolDetails), sets `result = data.result` only when truthy
  (else keeps the prior `result`), and feeds `next.subagents` through the same
  ACCUMULATIVE `readSubagentDetails(endDetails)` merge the update branch uses.
- **Bridge** (`packages/extension/src/bridge.ts`): lifts `result.details` to
  top-level `event.details` on live ends. `stripForForward` removes
  `details.entries[]` from `queued`/`running` update frames; ends stay fat.
  The tick throttle discards a HELD update on terminal, but a tick offered
  after the end is a fresh leading-edge send — a post-end update is rare on
  the live path, not impossible (the parent's X7 tests it).
- **Producer** (`@blackbelt-technology/pi-dashboard-subagents`, installed
  0.2.2, published 0.2.0–0.2.4; source NOT in this monorepo): `pushUpdate()`
  and every terminal return (`completed`, `error`, `aborted`) build `details`
  from ONE `snapshotDetails(status[, error])` → `buildDetails(...)`, which
  emits a FIXED key list. Keys valued `undefined` vanish under JSON. Two keys
  are legitimately absent-on-end-present-on-tail: `activity` (cleared to
  `undefined` by `activityFromEvent` on the subagent's last inner
  `tool_execution_end`) and, inversely, `error` (present only on
  failure/abort — end-only, harmless to the superset test).

## Goals / Non-Goals

**Goals:**

- Drop the retained tail update when — and only when — the end event subsumes
  it under the parent's predicates, applied with the CONSUMER's end-side
  resolution (`data.details`, `data.result`).
- Fail closed per event. A producer version that violates the assumptions
  costs retention, never rendered state.
- Produce a written, per-version verification record so the "is it
  equivalent?" question is answered once, in the change, not re-argued.

**Non-Goals:**

- Relaxing the gate for keys the completed snapshot intentionally clears
  (`activity`). The spec fixes the SAME superset gate; a looser gate is a new
  change with its own equivalence argument.
- Dropping the pinned creating tick. D7's pin is untouched.
- Changing the client reducer, the bridge strip, or the producer.
- A new telemetry counter. `collapsedUpdates` already accounts for the drop
  (spec scenario 1).

## Decisions

### D1 — Verify statically per version, then confirm once live

**Choice.** Cross-version verification = `npm pack` every published
`@blackbelt-technology/pi-dashboard-subagents` version (0.2.0–0.2.4), extract,
and diff the four producer sites that determine end-vs-tail `details`:
`snapshotDetails`, `buildDetails`, `activityFromEvent`, and the three terminal
return paths. For each version record: (a) same-key-set-modulo-undefined holds;
(b) the set of keys that can be absent on end while present on tail; (c) any
key whose JS type differs between the two. Then ONE live capture on the
installed version (spawn an Agent, dump the stored tail + end for its
`toolCallId`, apply the gate by hand) as a sanity check that the wire matches
the source. Written to `verification.md` in this change directory.

**Why not run all five versions live.** Running five producer versions means
five extension installs against one dashboard; the cost is out of proportion
to the question, which is answered by reading five copies of the same ~40
lines. Static diff is exhaustive over code paths; a live run samples one path.

**Why the live check at all.** The bridge sits between producer and store
(strip, lift, truncation). The static diff proves the producer half; one
capture proves the bridge half did not invalidate it.

**Outcome rule.** If any version shows a key present-on-both with DIFFERENT JS
types, or an `entries` that can be non-empty on tail and empty on end, the
per-event gate already rejects it — the record explains WHY the drop rate is
low for that version rather than blocking the change. Only a case the gate
CANNOT see (same key, same type, semantically stale value on the end — e.g. a
counter reset to 0) blocks: then the tail stays for every version and
`verification.md` is the "do not re-propose" record the proposal asks for.
From the 0.2.2 read, no such case exists: every value derives from the same
accumulators the tail reads.

**Non-Agent producers are out of the verification scope on purpose.** A
plain-string streaming tail (pi core, any version) resolves to `pd = {}`, so
`keysSurvive`/`entriesSurvive` are vacuous and only the result predicate
applies. The gate's outcome there does not depend on producer source, so
there is nothing to diff.

### D2 — Reuse the predicates; swap the successor resolver

**Choice.** Refactor `subsumes(p, s)` into a details-level core and two thin
resolvers:

- `subsumesDetails(pd, sd, pSetsResult, sSetsResult)` = the existing
  `keysSurvive(pd, sd)` ∧ `entriesSurvive(pd, sd)` ∧ (`pSetsResult` ⇒
  `sSetsResult`). This IS the D7 gate, verbatim.
- Update successor (existing path): `pd/sd = resolveUpdateDetails`,
  `*SetsResult = setsRenderedResult`. Behavior unchanged; existing tests X1–X9
  must pass untouched.
- End successor (new): `sd = data.details` when it is a plain object
  (non-null, non-array), else `undefined`; `sSetsResult = Boolean(data.result)`
  — the reducer's own predicate (`result ? truncate(result) : keep`). The
  predecessor side is unchanged (it is still an update).

**Presence rule (end-side only).** When the tail's `partialResult.details` is
TRUTHY (any plain object, even `{}` — and also a truthy non-object, which
`resolveUpdateDetails` folds to `undefined` but the reducer still writes
wholesale) and the end has NO plain-object `data.details`, the gate fails. `subsumes` folds "no details" and "empty details" to `pd = {}`, but the
reducer does not: a tail with truthy `details: {}` REPLACES `toolDetails`
wholesale, while an end without `data.details` MERGES the prior `toolDetails`
+ `status`. Dropping that tail would let the pin's details leak into the
folded end state. So `keysSurvive` runs on `pd`/`sd ?? {}` only after the
presence rule passes; a tail with `pd === undefined` (plain-string streaming)
is unaffected.

**Identity rule (end-side only).** When the tail resolves a string `agentId`,
the end must satisfy `data.toolName === "Agent"` AND `sd.agentId ===
pd.agentId` AND (`pd.agentSessionId` absent OR `sd.agentSessionId ===
pd.agentSessionId`). `keysSurvive` is type-only; the `subagents` map is
dual-indexed by these VALUES (`setSubagentState`), and the end branch's
subagent backfill only runs when `data.toolName === "Agent"` — without it the
tail's accumulative patch (tokens, entries, activity) would vanish from the
folded map even though every key "survived". Both rules are additive
fail-closed checks on top of the shared predicates, not relaxations.

**Why not a bespoke `endSubsumes`.** The proposal names this explicitly: a
second predicate is a second correctness argument to maintain and a second
place the D7 reasoning can drift. Parametrizing the RESOLUTION keeps one
argument.

**Why not make `resolveUpdateDetails` fall back to `data.details`.** The
parent's D7.1 rejected that for updates on purpose: the reducer never reads
top-level `details` for an update, so the fallback would compare keys the
consumer ignores. The end-side resolver is a separate function because the
consumer reads a different field, not a fallback.

**Why `Boolean(data.result)` and not `typeof result === "string"`.** Mirror
the reducer, not an idealized type. If `result` is a truthy non-string the
reducer overwrites; the gate must agree.

**Non-Agent tools fall out correctly.** A plain-string streaming tool (`bash`)
has `pd = undefined`, sets result; its end has no `details` and a truthy
`result` ⇒ drop. A structured update carrying truthy `details` whose end has no `details` ⇒
presence rule fails ⇒ retain. A structured content-only update (no truthy
`details`) is droppable iff the end sets `result`. All match what the reducer
would render.

### D3 — Hook point: `collapseOnEnd` inside `insertEvent`, after truncation, before trim

**Choice.** Add `collapseOnEnd(buf, stored)`: return unless
`stored.event.eventType === "tool_execution_end"`; read `toolCallId` (D5:
absent ⇒ no-op); `entry = collapseIndex.get(id)` (absent ⇒ no-op — nothing was
retained); if `entry.creatingSeq !== undefined && entry.newestSeq !== undefined &&
entry.newestSeq !== entry.creatingSeq`, call `dropIfSuperseded(buf, entry.newestSeq, id,
stored.event)` with the end-side gate; on drop set `entry.newestSeq =
entry.creatingSeq` (the index now points at the pin; a non-subsumed middle
update the parent retained may still sit between pin and end — the index
never tracked those and still does not). Called from
`insertEvent` immediately after `collapseSuperseded` (same position:
post-truncate so a `{__truncated}` end carries no `toolCallId` and no-ops,
and an over-ceiling Agent end that took the `reduceSubagentEvent` path is
gated on its REDUCED stored shape — which keeps `toolCallId` and a non-empty
sentinel `entries`, so `entriesSurvive` still holds; pre-trim so shed
policies see the collapsed buffer).

**Why require a RESIDENT pin (`creatingSeq !== undefined`).**
`pruneCollapseIndex` releases `creatingSeq` once the pin is trimmed. With no
retained event for the agent before the tail, the tail becomes the FIRST
hydrating event: the reducer seeds `type`/`description` first-wins
(`existingSub?.x ?? details.x`) from it, and the end never overrides them.
`keysSurvive` is type-only, so a same-typed value difference would fold
differently. A resident pin has already seeded both fields, making the
tail's values irrelevant. Without a pin, retain. (If the call's
`tool_execution_start` was trimmed, hydration no-ops for every update —
`idx === -1` — so that corner needs nothing.)

**Why keep the index entry.** The pin (`creatingSeq`) must survive the end:
the first-wins `type`/`description` live only there. Deleting the entry would
also make a hypothetical late update start a fresh entry and pin ITSELF as
`creatingSeq`, drifting first-wins semantics.

**Why `newestSeq = creatingSeq`, not `undefined`.** `pruneCollapseIndex`
deletes any entry whose `newestSeq === undefined` — so clearing it would
void the pin at the next trim (exactly the subagent-heavy sessions this
targets). Pointing `newestSeq` at the pin is the state the index already
represents for a single-update call, and `collapseSuperseded` already handles
a late update against it (never drops the pin; advances `newestSeq`). When
`creatingSeq` is `undefined` (pin already trimmed), the entry becomes
`{undefined, undefined}` and prune removes it — correct, nothing is retained.

**`dropIfSuperseded` gains a gate parameter** (or a sibling that takes the
end-side gate). The verified-removal shape (resolve seq, re-check eventType
and `toolCallId`, then gate, then splice) is reused as-is; only the predicate
differs.

### D4 — The end itself is never a drop candidate

The end is the buffer's newest event at insert time (D4 of the parent: the
max-seq event is never droppable) and `dropIfSuperseded` re-checks that the
candidate is a `tool_execution_update` before splicing. Both guards stay; no
new invariant.

### D5 — Replay equivalence is the acceptance test, not a unit assertion

Extend `collapse-replay-equivalence.test.ts`: for a fixture stream
`[creating tick, tail update(s), end]` per producer shape (Agent completed,
Agent failed, Agent with `activity` cleared on end, plain-string `bash`,
structured non-Agent end without `details`), fold the ORIGINAL stream and the
STORE-RETAINED stream through the client reducer and assert identical
`messages[idx].{result,toolDetails,toolStatus}` and identical
`subagents.get(agentId)` AND `subagents.get(agentSessionId)` (the map is
dual-indexed via `setSubagentState`). The `activity`-cleared case must show
the tail RETAINED (spec scenario 2) — this is the honest cost of the same-gate
rule and the test pins it.

The test file mirrors the store's selection locally (`selectRetained`) and
pins the mirror to the store via a cross-check; extending it means extending
BOTH the mirror and the cross-check to the end-side gate, or the cross-check
fails loudly. End fixtures carry `toolName: "Agent"` — pi core's
`ToolExecutionEndEvent` always does, and the reducer's subagent backfill on
the end branch keys on it.

## Risks / Trade-offs

- [`activity` cleared on end makes the gate refuse most successful Agent runs
  whose last inner event was a tool end] → Accepted per spec ("SAME gate").
  `verification.md` records the measured drop rate on the live capture so the
  benefit is stated, not assumed. Relaxing is a follow-up with its own
  equivalence argument, not a tweak here.
- [End `result` is truthy but `toolDetails` from the tail is richer than
  `endDetails`] → `keysSurvive` on `data.details` rejects it; the reducer
  would have overwritten `toolDetails` wholesale anyway, so retention is the
  conservative side of a case the consumer already loses.
- [A producer outside 0.2.0–0.2.4 (unpublished/local build, or an older
  session JSONL re-inserted through `insertEvent` on history load) emits a
  different shape] → the gate is SHAPE-gated, not version-gated: a shape
  mismatch fails closed (cost: retention only); a same-shape stale value would
  drop. D1's static diff is what rules the latter out for the published range;
  outside it the guarantee is the same shape argument, unverified.
- [Efficacy boundary] → a call with a single update has
  `newestSeq === creatingSeq` and is excluded by D3's guard; with the
  `activity` retention above, the actual drop population is non-Agent
  streaming tools plus Agent runs whose last inner event was not a tool end.
  Stated so the measured rate in `verification.md` is read against it.
- [`collapsedUpdates` doc-comment says "superseded by a later update"] →
  end-drops fold into the same counter (Non-Goal: no new counter); the
  doc-comment on `TrimStats.collapsedUpdates` is updated to say so.
- [Out-of-order: an update for the call arrives AFTER the end] → not produced
  by the live path (throttle discards on terminal); if it arrives (replay
  load), `collapseSuperseded` treats it as a new newest — existing behavior,
  unchanged by this design.
- [`healedBy: "superseded"` synthetic ends] → client-side synthesis only;
  never inserted into the store. Not a store input.
- [Refactoring `subsumes` regresses X1–X9] → the update-path resolvers are
  unchanged functions passed through; existing tests run untouched and gate
  the refactor.

## Migration Plan

Server-only (`packages/server`), no persisted-format change, no config flag.
Deploy = `/api/restart`. Rollback = revert the commit AND restart: already-
dropped tails in a running store are gone for that process lifetime (same
class as the parent's collapse); the restart re-hydrates from session JSONL
through `insertEvent`, which is what makes the reset full.
