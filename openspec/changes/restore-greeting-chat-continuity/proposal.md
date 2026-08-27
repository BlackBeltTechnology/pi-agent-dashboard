# Proposal: restore-greeting-chat-continuity

## Why

An `ib-greeting` custom message (`type:"custom_message"`, `customType:"ib-greeting"`,
`display:true`) is persisted append-only — one new entry each time an invoice session's
state advances. The intended product model is a CONTINUOUS CHAT SESSION: each greeting is
a chat message that stays visible, in chronological order, for the life of the session.
Compaction shrinks only the model's context; it must never remove visible history.

The dashboard currently does the opposite. It collapses the entire greeting history into
ONE visible current-state row, in two places:

- **Replay (`state-replay.ts`).** All persisted `ib-greeting` entries are deferred and
  only the LATEST one is emitted, placed at the first greeting's slot. Earlier greetings
  emit no event — the history is dropped on every replay sweep.
- **Reducer (`event-reducer.ts`).** Greetings are keyed by a STABLE id
  `custom-ib-greeting`, so a newer greeting REPLACES the prior row in place instead of
  appending. A timestamp monotonicity guard hardens that collapse ("newest wins the one
  slot regardless of arrival order").

Result: after a reconnect the chat shows a single greeting row instead of the running
conversation of state transitions the operator expects. The collapse behaviour was
deliberate — it treated an `ib-greeting` as a singleton current-state overlay, not chat
history. That premise is now overturned: greetings ARE chat history and must all remain
visible in order.

## What Changes

- **Replay (`state-replay.ts`).** Emit EVERY persisted display-flagged `ib-greeting`
  entry, each as its own `message_start` + `message_end` pair at its own chronological
  position, interleaved with the other entries — instead of deferring and emitting only
  the latest. Remove the `latestGreeting` / `greetingSlot` singleton machinery. Hidden
  (`display` falsy) greetings are still never emitted; non-greeting custom messages are
  untouched.
- **Reducer (`event-reducer.ts`).** Append each `ib-greeting` as its own row with a
  per-entry id, exactly as every other custom message type already does. Remove the
  stable `custom-ib-greeting` id and the timestamp monotonicity guard that existed only to
  arbitrate the collapsed slot. Chronological order is preserved without any greeting-side
  sort or timestamp guard because the reducer only ever observes greetings in ascending
  per-session `seq` order (the same delivery guarantee that orders every other row type;
  see `design.md` — the out-of-order case is proven unreachable, not assumed).
- **Anti-duplicate / anti-late invariant (re-expressed, not dropped).** A re-replayed or
  late-arriving DUPLICATE of a greeting already shown MUST NOT produce a second row. In
  the append model this is enforced by keying each greeting on its own entry id and
  replacing in place when that id is already present (idempotent) — the same dedup path
  every other custom message uses. Removing the collapse must not reintroduce duplicate
  rows on a re-replay sweep. See `design.md`.
- **Scope guard.** The `ib-greeting` literal and the greeting-specific branch stay in both
  files; the fix is made in place, not by genericizing the code or relocating greeting
  knowledge elsewhere. Non-greeting custom messages and every other replay/reduce
  behaviour stay EXACTLY as they are.

## Impact

- Affected capabilities: `on-demand-session-replay` (replay), `event-reducer` (live +
  replay browser state).
- Affected code: `packages/shared/src/state-replay.ts`,
  `packages/client/src/lib/chat/event-reducer.ts`.
- Tests: `packages/shared/src/__tests__/state-replay-custom-message.test.ts`,
  `packages/client/src/lib/chat/__tests__/event-reducer.custom-display-message.test.ts`
  (both rewritten to assert chronology + no-duplicate-on-re-replay; the unrelated-custom
  and no-greeting cases keep passing unchanged).
- Behavioural only; no protocol change, no `ChatMessage` shape change. Other custom
  messages and all other replay paths are untouched.

## Discipline Skills

- `systematic-debugging` — the anti-duplicate/anti-late invariant is the subtle part;
  removing the collapse must be proven (by a failing-first re-replay test) not to
  reintroduce duplicate rows before the fix stands.

No other `eng-disciplines` skills apply: the change touches no auth, untrusted input,
secrets/PII, external calls, latency budget, or new endpoint.
