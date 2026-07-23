# Tasks: greet-as-assistant-message

## 1. Reducer — render custom display messages (live path)

- [x] 1.1 In `packages/client/src/lib/event-reducer.ts` `message_end`, add a
      branch: when `msg.role === "custom"` AND `msg.display` is truthy, build one
      `ChatMessage` with `role: "assistant"`, `content` = extracted text (string
      content used directly; array content concatenates `type:"text"` parts),
      `timestamp` from the event, and a content-stable id
      `custom-${entryId ?? messages.length}`.
- [x] 1.2 Make it idempotent: if a row with that id already exists (re-replay /
      reconnect), update in place instead of pushing a duplicate.
- [x] 1.3 `message_start` for `role:"custom"` is a no-op (the row is built at
      `message_end`). Do NOT advance `assistantInferenceSeq` or touch
      `streamingTextFlushed` for custom messages.
- [x] 1.4 Do NOT add the custom row's role to `TURN_BOUNDARY_ROLES` (it renders
      as `assistant`, which is already correctly non-boundary).
- [x] 1.5 `display` falsy / absent → no row (skip).

## 2. State-replay — rebuild on reload (reload path)

- [x] 2.1 In `packages/shared/src/state-replay.ts` `replayEntriesAsEvents`, add a
      branch for `entry.type === "custom_message"` with `display` truthy: emit a
      `message_start` then a `message_end`, each carrying a message of shape
      `{ role:"custom", customType, content, display:true }` plus `entryId: entry.id`,
      so the reducer rebuilds the same assistant-side row as the live path.
- [x] 2.2 `type:"custom_message"` with `display` falsy → emit nothing.
- [x] 2.3 Leave the existing `type:"custom"` / `customType:"flow-event"` branch
      and all message / model_change replay untouched.

## Tests (vitest — `npm test`)

- [x] T1 Live: a `message_start` + `message_end` pair with
      `role:"custom", display:true` produces exactly one `role:"assistant"`
      ChatMessage with the message's content.
- [x] T2 Live idempotency: replaying the same custom `message_start`/`message_end`
      twice yields exactly one row (no duplicate).
- [x] T3 Live: `role:"custom", display:false` produces no row.
- [x] T4 Reducer isolation: a custom display message does NOT advance
      `assistantInferenceSeq` and does NOT terminate a following assistant
      message's reorder window (tool-card ordering unaffected).
- [x] T5 Replay: a persisted `type:"custom_message"` entry with `display:true`
      replays to one `role:"assistant"` row (via emitted message_start/message_end);
      a `display:false` entry replays to none.
- [x] T6 Replay: an unrelated `type:"custom"` (non-flow-event) entry still emits
      no `event_forward` (regression guard).

## Validate

- [x] V1 `openspec validate greet-as-assistant-message --strict` passes.
- [x] V2 `npm run build` succeeds; the 2 new test files pass (8/8) and the full
      client reducer + shared replay suites stay green. The 3 remaining `npm test`
      failures are PRE-EXISTING and unrelated to this change (invoicebot-plugin
      server tests missing the `@fastify/multipart` dep; two flaky `fs.watch`
      watcher tests) — none import `event-reducer` or `state-replay`.
