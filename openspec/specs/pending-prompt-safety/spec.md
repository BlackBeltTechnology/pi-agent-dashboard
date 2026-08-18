# pending-prompt-safety Specification

## Purpose

Prevents a session from being stuck showing a prompt that will never be answered. Clears `pendingPrompt` on `agent_end` and applies a safety timeout so a lost or dropped response cannot leave the session waiting indefinitely.

## Requirements

### Requirement: pendingPrompt cleared on agent_end
The event reducer SHALL clear `pendingPrompt` when an `agent_end` event arrives, in addition to the existing clearing on `agent_start` and `message_start(user)`.

#### Scenario: agent_end clears stuck pending prompt
- **WHEN** `pendingPrompt` is set (spinner visible)
- **AND** an `agent_end` event arrives without a prior `message_start(user)` for this prompt
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`

#### Scenario: Normal flow unaffected
- **WHEN** `pendingPrompt` is set
- **AND** `agent_start` arrives followed by `message_start(user)`
- **THEN** `pendingPrompt` SHALL be cleared by `message_start(user)` as before (agent_end clearing is a no-op since already cleared)

### Requirement: pendingPrompt safety timeout
The client SHALL implement a 30-second timeout for `pendingPrompt`. If `pendingPrompt` is set and no clearing event (`agent_start`, `message_start(user)`, or `agent_end`) arrives within 30 seconds, the prompt SHALL be auto-cleared and an error SHALL be shown.

The timeout SHALL be **suppressed (paused) while `pendingPrompt.text` is present in `Session.queue.pending`** (as `pending[i].text === pendingPrompt.text`) — that is, while the bridge has acknowledged the prompt by including it in the queue snapshot. The timeout SHALL (re)start only while the prompt is in flight but not yet queue-acknowledged. If the prompt enters the queue and later leaves the queue (because the bridge drained it) without producing a clearing event within 30 seconds of the leave, the timeout SHALL fire as before.

#### Scenario: Timeout triggers after 30 seconds when prompt is never queued
- **WHEN** `pendingPrompt` is set
- **AND** the prompt's text never appears in `Session.queue.pending`
- **AND** 30 seconds pass with no clearing event
- **THEN** `pendingPrompt` SHALL be cleared
- **AND** `lastError` SHALL be set with a message indicating the prompt may not have been received

#### Scenario: Timeout cancelled by clearing event
- **WHEN** `pendingPrompt` is set and the timeout is running
- **AND** an `agent_start` event arrives within 30 seconds
- **THEN** the timeout SHALL be cancelled (no error shown)

#### Scenario: Timeout suppressed while prompt is in queue
- **WHEN** `pendingPrompt` is set
- **AND** within the 30-second window the text appears in `Session.queue.pending`
- **THEN** the safety timeout SHALL be paused (no error fires) for as long as the text remains in the queue, regardless of how long the agent's streaming run lasts

#### Scenario: Timeout resumes when prompt leaves queue without confirmation
- **WHEN** `pendingPrompt` was paused because its text was in the queue
- **AND** the text is later removed from `Session.queue.pending`
- **AND** no `agent_start`, `message_start(user)`, or `agent_end` event has cleared `pendingPrompt`
- **THEN** the 30-second safety timeout SHALL (re)start from the moment of removal
- **AND** if no clearing event arrives within 30 seconds, `pendingPrompt` SHALL be cleared and `lastError` SHALL be set
