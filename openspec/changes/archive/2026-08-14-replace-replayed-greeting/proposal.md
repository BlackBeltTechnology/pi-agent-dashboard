# Proposal: replace-replayed-greeting

## Why

An `ib-greeting` is a singleton current-state overlay, not chat history. The engine
persists a NEW `custom_message` (`customType:"ib-greeting"`, `display:true`) every time a
session's state advances, so a long-lived session accumulates three or four greeting
entries over its lifetime. The dashboard replays them all as assistant-side rows, so
after a reconnect the conversation shows the FIRST opener (`Feldolgozás alatt / Szakasz:
Beolvasás`) even though the invoice header shows the current state — and a browser
resubscribe is not a pi `session_start`, so no fresh greeting ever replaces it.

The same defect exists live: each new greeting appends a row keyed by its own entry id,
so the stale opener stays visible above the current one. A greeting is meant to be
REPLACED by its successor, both live and on replay.

## What Changes

- **Replay (`state-replay.ts`).** For persisted `type:"custom_message"` entries with
  `customType:"ib-greeting"`, replay emits ONLY the latest authoritative greeting (one
  `message_start` + `message_end` pair), placed at the slot of the first greeting entry so
  it stays the opener. Non-greeting custom messages are unchanged; hidden (`display`
  falsy) greetings are never emitted.
- **Reducer (`event-reducer.ts`).** A `role:"custom"` message with
  `customType:"ib-greeting"` builds a row keyed by a STABLE id (`custom-ib-greeting`)
  instead of `custom-<entryId>`, so a newer greeting replaces the prior in place rather
  than appending. All other custom messages keep their per-entry id (not globally
  collapsed).
- **Lock test (query route).** The generic `/api/plugins/invoicebot/query` route already
  forwards the request body verbatim to `engine.query` (no `view` whitelist, no
  reshaping). Add a lock test pinning that `view:"current-greeting"` and any extra
  selector args pass through unchanged — no route behavior change.

## Impact

- Affected capabilities: `on-demand-session-replay` (replay), `event-reducer` (live +
  replay browser state).
- Affected code: `packages/shared/src/state-replay.ts`,
  `packages/client/src/lib/chat/event-reducer.ts`.
- Tests: `packages/shared/src/__tests__/state-replay-custom-message.test.ts`,
  `packages/client/src/lib/chat/__tests__/event-reducer.custom-display-message.test.ts`,
  `packages/invoicebot-plugin/src/server/__tests__/routes.test.ts`.
- Behavioral only; no protocol change, no `ChatMessage` shape change. Other custom
  messages and all other replay paths are untouched.

## Discipline Skills

None apply — this is a focused reducer/replay logic fix with no auth, untrusted input,
secrets, latency budget, irreversible step, or new endpoint/external call.
