# Fork EntryID Accuracy

## Purpose

Ensure assistant `message_end` events carry the `entryId` of the assistant's own session tree entry, so "Fork from here" on an assistant message correctly includes that message in the new session.

## Requirements

### Requirement: Assistant message entryId reflects own session entry
The bridge extension SHALL attach the assistant message's own session tree entry ID as `entryId` on `message_end` events on pi 0.70.x. Because pi 0.69+ awaits extension event handlers BEFORE `sessionManager.appendMessage` runs, the bridge MUST defer the enrichment-and-send via `setTimeout(0)` (NOT `queueMicrotask`) so that pi has assigned the entry id by the time the bridge reads it. The bridge MAY read `event.message.id` (which pi mutates in place during `appendMessage`) and SHOULD fall back to a WeakMap populated by wrapping `ctx.sessionManager.appendMessage` at `session_start`.

#### Scenario: Assistant message_end carries correct entryId on pi 0.70.x
- **WHEN** pi 0.70.x emits a `message_end` event for an assistant message
- **AND** the bridge defers the enrichment via `setTimeout(0)` so `appendMessage` has already run
- **THEN** the `entryId` SHALL be the entry ID of the assistant's own session tree entry (read from `event.message.id` or the WeakMap)

#### Scenario: queueMicrotask is no longer sufficient
- **WHEN** pi 0.69+ runs `await this._emitExtensionEvent(event)` before `sessionManager.appendMessage(event.message)`
- **THEN** the bridge SHALL NOT rely on `queueMicrotask` to bridge past `appendMessage` — the microtask resolves inside the awaited dispatcher, before persistence
- **AND** the bridge SHALL use a macrotask (`setTimeout(0)`) deferral instead

### Requirement: User message entryId reflects own session entry
The bridge extension SHALL emit an `entry_persisted` event whenever pi's `sessionManager.appendMessage` writes a user, assistant, or toolResult entry. The event SHALL carry the persisted entry's id and a stable nonce that ties it back to the original `message_start` / `message_end` event the bridge already sent. The dashboard event reducer SHALL back-fill the matching ChatMessage's `entryId` field on receipt.

#### Scenario: User ChatMessage gets entryId from entry_persisted
- **WHEN** the bridge sends a `message_start` with `nonce: "n-7"` for a user message with no entry id (pi has not yet persisted it)
- **AND** pi later persists the user message with id `"abc-123"`
- **AND** the bridge emits `entry_persisted { nonce: "n-7", entryId: "abc-123" }`
- **THEN** the event reducer SHALL update the ChatMessage created from the prior `message_start` so its `entryId` is `"abc-123"`

#### Scenario: Assistant ChatMessage gets entryId directly from message_end
- **WHEN** the bridge sends a `setTimeout(0)`-deferred `message_end` for an assistant message
- **THEN** the event SHALL already carry the correct `entryId` (no `entry_persisted` back-fill needed)

#### Scenario: entry_persisted is additive, never destructive
- **WHEN** the event reducer receives an `entry_persisted` event whose `nonce` matches no existing ChatMessage
- **THEN** the reducer SHALL ignore it without throwing

### Requirement: Fork from assistant message includes that message
The "fork from here" action on an assistant message SHALL create a new session that includes the assistant message the user clicked on.

#### Scenario: Fork from assistant message
- **WHEN** a user clicks "Fork from here" on an assistant message
- **AND** the assistant message has `entryId` pointing to its own session tree entry
- **THEN** `createBranchedSessionFile` SHALL prune the session tree to include the path from root through the assistant's entry
- **AND** the new session SHALL contain the assistant message the user forked from

#### Scenario: Fork from user message unchanged
- **WHEN** a user clicks "Fork from here" on a user message
- **THEN** the fork SHALL include the path up to and including that user message's entry (existing behavior preserved)
