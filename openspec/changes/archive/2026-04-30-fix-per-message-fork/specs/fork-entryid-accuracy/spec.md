## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: message_start entryId unchanged
**Reason**: This requirement (formerly: `entryId` on `message_start` is captured immediately and reflects the *previous* leaf) codified the off-by-one bug as expected behavior. On pi 0.70.x it produces ChatMessage.entryId values that do not correspond to the user message the bubble represents, breaking the per-message Fork button.
**Migration**: ChatMessages now obtain their `entryId` via the new `entry_persisted` back-fill (for user messages) or directly from `message_end` (for assistant messages). The `message_start` event MAY still carry a `previousEntryId` field for diagnostic purposes, but consumers MUST NOT use it as the bubble's identity.
