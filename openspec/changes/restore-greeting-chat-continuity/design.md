# Design: restore-greeting-chat-continuity

## Context

Two functions collaborate to render `ib-greeting` custom messages:

- `replayEntriesAsEvents` (`packages/shared/src/state-replay.ts`) synthesizes
  `event_forward` messages from persisted JSONL entries after a reconnect / DB reset.
- `reduceEvent` (`packages/client/src/lib/chat/event-reducer.ts`) folds those events
  (and live ones) into `ChatMessage[]`.

Today both special-case `ib-greeting` to collapse history into one current-state row.
Replay defers all greetings and emits only the latest at the first greeting's slot; the
reducer keys the greeting on a STABLE id (`custom-ib-greeting`) so a newer greeting
overwrites the row, guarded by a timestamp monotonicity check. This change makes each
greeting a persistent chronological chat row while preserving the invariant that a
duplicate delivery of the same greeting never adds a second row.

## Goals

- Every persisted, display-flagged `ib-greeting` entry replays as its own
  `message_start` + `message_end` pair, in chronological (entry) order, interleaved with
  surrounding entries.
- The reducer appends each greeting as its own row with a per-entry id, matching the
  existing non-greeting custom-message path.
- A re-replayed or late-arriving duplicate of an already-shown greeting produces NO second
  row (idempotent).
- Zero behaviour change outside the `ib-greeting` path.

## Non-Goals

- Genericizing either file or removing the `ib-greeting` literal — the branch stays as the
  discriminator so the change reads as greeting-scoped. A later refactor owns any
  generalization.
- Moving greeting knowledge out of these two files.
- Any change to non-greeting custom messages, flow events, or other replay/reduce paths.

## Decision: replay emits every greeting inline

Remove the `latestGreeting` and `greetingSlot` trackers. In the
`type:"custom_message"` + `display` branch, the `ib-greeting` case emits its
`message_start` + `message_end` pair inline at the entry's position — identical to the
non-greeting custom path — instead of deferring. The post-loop "emit the single latest
greeting at the first greeting's slot" splice is deleted. Hidden greetings still emit
nothing (the `display` guard already gates this). Because emission is now inline, greetings
naturally interleave with user/assistant/tool entries in JSONL order.

## Decision: reducer appends each greeting with a per-entry id

In the `message_end` custom branch, the greeting no longer receives the stable
`custom-ib-greeting` id, and the timestamp monotonicity guard is removed. The greeting
branch is retained and still references the `ib-greeting` literal (per scope), but it now
derives a per-entry id and appends exactly like every other custom message — reusing the
existing `custom-<entryId>` id derivation and the existing `findLastIndex(id)`
replace-in-place path.

## The anti-duplicate / anti-late invariant, re-expressed

The current monotonicity guard exists ONLY because all greetings shared one row: with a
single slot, a stale replay-snapshot greeting arriving after a newer live greeting could
clobber it, so the guard compared timestamps to keep the newest in the one slot.

Once every greeting owns its own row keyed by its own entry id, that cross-greeting
clobbering cannot happen — two DIFFERENT greetings never contend for one row. The
invariant the guard actually protected (no regression, no duplicate rows on a re-replay
sweep) survives in a simpler, structural form:

- **Per-entry id.** Each greeting row is keyed by its persisted entry id (present on every
  greeting entry — replay attaches `entry.id`; live events carry `entryId`).
- **Idempotent replace-in-place.** When an event arrives whose id already exists in
  `messages`, the reducer replaces that row in place (updates content/entryId) rather than
  appending — the SAME dedup the non-greeting custom path already performs. A re-replay
  sweep re-delivers the same entry ids, so each maps back onto its existing row: no second
  rows.
- **Late arrival is no longer a hazard.** A "stale" greeting arriving late is a DISTINCT
  historical greeting with its own id and its own legitimate chronological position; in the
  continuous-chat model it belongs on screen at that position, not suppressed. There is no
  single slot for it to clobber, so no timestamp comparison is needed. The only thing to
  prevent — a duplicate ROW for the SAME entry — is handled by id dedup above.

This is the subtlest part of the change: we are deleting the timestamp guard but must NOT
lose the no-duplicate-on-re-replay guarantee. A failing-first test re-replays a set of
greetings and asserts the row count is unchanged on the second sweep; the id-dedup path
must satisfy it before the guard is removed.

## Test strategy

- Rewrite `state-replay-custom-message.test.ts` T1 ("three historical greetings replay as
  exactly one latest greeting") to assert all three greetings replay as three pairs in
  order (A, B, C), each carrying its own entry id. Keep T2 (unrelated custom messages) and
  T3 (no greeting) asserting unchanged behaviour; adapt the T2/T2b greeting-slot
  expectations to the new "each greeting inline in order" reality.
- Rewrite the reducer `ib-greeting` describe block (the singleton + harden cases) to assert
  each greeting appends its own row in order, and add an explicit re-replay test proving a
  second replay of the same greeting set does not add duplicate rows. Keep the
  unrelated-custom and hidden-greeting cases passing unchanged.
- Verify the untouched non-greeting paths (T2 unrelated custom, T3 no greeting) still pass
  without modification to their assertions of intent.

## Ordering / out-of-order delivery — proven unreachable

A fair objection to "append each greeting, no timestamp guard": what if a STALE
replay-snapshot greeting lands AFTER a newer live one (the case the removed guard was
written for, `event-reducer.ts` collapse comment)? Concretely — live `g3` appended, then a
late replay of older `g1`, `g2` (distinct ids, not duplicates, so no dedup) appends at the
TAIL, rendering `g3, g1, g2` (oldest below newest). If reachable, that violates the
chronological clause.

It is NOT reachable in this codebase. The authoritative chronological ordinal is the
per-session **`seq`** carried on every event (`packages/shared/src/browser-protocol.ts:142`
and the `event_replay { events: Array<{ seq, event }> }` shape at :149) — a real monotonic
sequence, not an invented timestamp. Four independent guarantees force the reducer to see
greetings only in ascending `seq` (= occurrence) order within any surviving state:

1. **Replay is `seq`-ascending.** `packages/server/src/browser-handlers/subscription-handler.ts`
   replays via `eventStore.getEvents(sessionId, N)`, which returns events in ascending
   `seq`; batches are sent and reduced in that order.
2. **Live is `seq`-sorted before reduce.** `packages/client/src/lib/chat/coalesce-live-events.ts:35`
   — `[...queued].sort((a, b) => a.seq - b.seq)`.
3. **Replay/live interleave is suppressed.** `subscription-handler.ts` `markReplaying` /
   `clearReplaying` (change `fix-cold-subscribe-replay-interleave`) stop a live event from
   slotting between replay batches.
4. **A re-replay resets and rebuilds in `seq` order.** `packages/client/src/hooks/useMessageHandler.ts:663`
   `shouldReset = firstSeq === 1 || firstSeq <= maxSeq`; :671 wipes to
   `createInitialState()` and re-reduces the batch in `seq` order.

Walk the objection through these: for `g1`, `g2` (low `seq`) to arrive after `g3`, a
replay sweep must carry them. Any sweep containing them has `firstSeq <= maxSeq` (their
`seq` is below `g3`'s), so guarantee 4 fires — state is WIPED and rebuilt from the batch in
`seq` order, yielding `g1, g2, g3`, NOT a tail-append of `g3, g1, g2`. A delta sweep
(`firstSeq > maxSeq`) by definition cannot contain `g1`/`g2` (their `seq < maxSeq`); it
carries only strictly-newer events, appended in ascending `seq`. Live batches are
`seq`-sorted (guarantee 2). So "arrival order" at the reducer boundary IS chronological
order by construction; plain append is correct.

The removed timestamp guard was therefore NOT protecting cross-greeting chronology — it
protected the single shared SLOT's content under the collapse model (which greeting's text
wins one row), a concern that vanishes once every greeting owns its own `seq`-ordered row.
The reducer's greeting branch must NOT add its own sort/reposition; it relies on the four
guarantees above, exactly as every other row type already does. The scenario "A re-replay
sweep after a live greeting rebuilds all greetings in order" and its failing-first task pin
this explicitly.

## Forward-looking: this is deliberately left generic-able (see spike)

This change deliberately keeps the `ib-greeting` literal and branch in both files as a
scope guard. A verification spike established that AFTER this change lands, both greeting
branches become byte-equivalent to the generic `display:true` custom-message path
(`state-replay.ts` non-greeting custom emits the same inline `message_start`+`message_end`
pair; `event-reducer.ts` non-greeting custom builds the same `custom-<entryId>` row via the
same replace-in-place dedup, and content extraction + the `display`-falsy gate are already
shared, outside the `isGreeting` conditional). The `ib-greeting` literal exists in no third
production site (only these two files + their tests; the emitter lives in the engine). A
separate follow-up change MAY therefore delete both branches and let the generic path
handle greetings, with no new plugin renderer seam and no message-modification API. That
genericization is explicitly OUT OF SCOPE here. Because this verdict rests on static
equivalence rather than executed tests, the follow-up change that deletes the branches MUST
confirm behavioural equivalence by test (implement the deletion, run the suites, and prove
the greeting and generic-custom results are identical) before it lands — that verification
is the follow-up's responsibility, not this change's.

## Risks

- **Re-introducing duplicate rows.** Mitigated by the failing-first re-replay test and the
  id-dedup path described above.
- **Ordering.** Proven unreachable above via the per-session `seq` ordinal + reset-rebuild
  path; the greeting branch adds no sort of its own.
