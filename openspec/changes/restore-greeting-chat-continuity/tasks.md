# Tasks

## 1. Reproduce (TDD — rewrite the tests that lock the singleton contract)

- [ ] 1.1 In `packages/shared/src/__tests__/state-replay-custom-message.test.ts`, rewrite
  T1 ("three historical greetings replay as exactly one latest greeting") to assert all
  three greetings replay as three `message_start` + `message_end` pairs in order (content
  A, B, C), each carrying its own greeting entry's `entryId`. Verify it FAILS against the
  current singleton replay.
- [ ] 1.2 Adapt the T2 / T2b greeting-slot cases in the same file: greetings now emit
  inline in JSONL order interleaved with the `x-note` entry (not collapsed to one at the
  first slot). Assert the interleaved order and that the `x-note` pair is unchanged.
- [ ] 1.3 In `packages/client/src/lib/chat/__tests__/event-reducer.custom-display-message.test.ts`,
  rewrite the "ib-greeting singleton replacement" describe block (including the
  harden-greeting-collapse-latest T7/T8/T9 cases) to assert each greeting appends its OWN
  row with a per-entry id, in order. Verify it FAILS against the current stable-id
  collapse.
- [ ] 1.4 Add an explicit re-replay test to the reducer suite: deliver a set of greetings,
  then re-deliver the SAME greetings (same entry ids); assert the greeting row count is
  unchanged (no duplicate rows). Add a late-duplicate case: a duplicate of an
  already-shown greeting arriving after a newer one adds no third row.
- [ ] 1.5 Add a failing-first ORDERING test for the reset-rebuild path: reduce a live
  greeting `g3` (highest `seq`, content C) into state, then feed a full re-replay batch
  (first `seq` `<= maxSeq`) carrying `g1`, `g2`, `g3` (contents A, B, C) in ascending
  `seq` through the reset-and-rebuild path (`createInitialState()` then re-reduce in
  order, mirroring `useMessageHandler` `event_replay` `shouldReset`); assert the rendered
  greeting rows are A, B, C (never C, A, B) and exactly three. Verify it FAILS against the
  current singleton collapse (which rebuilds one row).

## 2. Fix replay (`packages/shared/src/state-replay.ts`)

- [ ] 2.1 Remove the `latestGreeting` / `greetingSlot` singleton trackers and the
  post-loop splice that emits only the latest greeting at the first slot.
- [ ] 2.2 In the `type:"custom_message"` + `display` branch, emit the `ib-greeting`
  pair INLINE at the entry's position — matching the non-greeting custom path — keeping the
  `ib-greeting` literal as the (now behaviour-equivalent) discriminator. Do NOT genericize
  the branch away or remove the literal.

## 3. Fix reducer (`packages/client/src/lib/chat/event-reducer.ts`)

- [ ] 3.1 In the `message_end` custom branch, remove the stable `custom-ib-greeting` id and
  the timestamp monotonicity guard.
- [ ] 3.2 Have the `ib-greeting` branch derive a per-entry id and append via the existing
  `findLastIndex(id)` replace-in-place path — the same idempotent dedup non-greeting
  customs use — so a re-replayed/late duplicate of the same greeting entry updates its row
  in place instead of adding a second. Keep the `ib-greeting` literal / branch present per
  scope; do NOT genericize or relocate greeting knowledge.

## 4. Verify

- [ ] 4.1 The rewritten tests from step 1 all pass.
- [ ] 4.2 Confirm the UNTOUCHED cases still pass with unchanged intent: state-replay T2
  (unrelated custom messages) / T3 (no greeting), and reducer T1–T4 (generic custom
  display-message rendering) + the unrelated-custom and hidden-greeting greeting cases.
- [ ] 4.3 `npm test` (zero-network) green.
- [ ] 4.4 `npm run build` succeeds.
- [ ] 4.5 `openspec validate restore-greeting-chat-continuity --strict` passes.
