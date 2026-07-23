# Proposal: greet-as-assistant-message

## Why

pi extensions can inject a **display-flagged custom session message** — a message
of shape `{ role: "custom", customType, content, display: true }`, produced from
`before_agent_start` or `sendCustomMessage`. pi persists it as a
`CustomMessageEntry` (`type:"custom_message"`) and, live, emits it through the
normal `message_start` / `message_end` event pair. The `display: true` flag is
pi's signal that the message is meant to be shown to the operator.

The dashboard drops it at **both** ends of the pipeline:

1. **Live.** `event-reducer.ts` `message_start` / `message_end` build a
   `ChatMessage` only for `role: "assistant"` and `role: "user"`. A
   `role: "custom"` message matches no branch, so no row is ever created — the
   message is silently discarded as it streams in.

2. **On reload.** `state-replay.ts` (`replayEntriesAsEvents`) only re-forwards
   persisted `type:"custom"` entries whose `customType === "flow-event"`. A
   persisted `type:"custom_message"` entry matches no branch and is dropped, so a
   page refresh / reconnect / server restart rebuilds the transcript without it.

Net: a message the runtime explicitly marked `display: true` never reaches the
operator's chat view, live or on reload.

## What Changes

- **Reducer (live path).** In `message_start` / `message_end`, when
  `msg.role === "custom"` AND `msg.display` is truthy, build exactly **one**
  `ChatMessage` and render it on the assistant side (reusing the existing
  assistant bubble). The row is built once (idempotent across re-replay) and is
  **not** a turn boundary.

- **State-replay (reload path).** Add a branch for persisted
  `entry.type === "custom_message"` with `display` truthy that emits a
  `message_start` + `message_end` pair, so reload rebuilds the same assistant-side
  row the live path produces.

- **Hidden custom messages stay hidden.** A custom message with `display` falsy
  (or absent) SHALL NOT produce a row, matching pi's TUI semantics where
  `display: false` is a context-only, non-shown message.

This is generic: any display-flagged custom session message renders as an
assistant-side bubble, live and on reload.

## Impact

- Affected capabilities: `event-reducer` (live rendering), `on-demand-session-replay`
  (reload rendering).
- Affected code: `packages/client/src/lib/event-reducer.ts`,
  `packages/shared/src/state-replay.ts`.
- Additive / behavioral only. No new event type, no protocol change, no
  `ChatMessage` role-union change (the row reuses `role: "assistant"`), no
  ChatView markup change. Existing `role:"custom"` / `type:"custom"` (non-message)
  handling is untouched — `custom_message` is a distinct entry type.
