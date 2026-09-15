# user-action-delivery-verdict Specification

## ADDED Requirements

### Requirement: Browser send SHALL report a delivery verdict

`useWebSocket`'s `send` currently returns `void` and silently discards the
message when `readyState !== WebSocket.OPEN`, so no caller can distinguish a
transmitted action from a destroyed one. It SHALL instead return a verdict
describing what happened to the message.

The verdict SHALL distinguish at minimum: the message was handed to an open
socket, the message was queued for flush on reconnect, and the message was
rejected outright. The verdict SHALL NOT claim *delivery* — `ws.send()` on an
open socket hands bytes to the OS and proves nothing about receipt.

#### Scenario: Open socket yields a handed-off verdict

- **GIVEN** a `useWebSocket` connection whose socket `readyState` is `OPEN`
- **WHEN** a caller invokes `send(msg)`
- **THEN** the message SHALL be written to the socket
- **AND** the returned verdict SHALL indicate the message was handed to the socket

#### Scenario: Closed socket never yields a handed-off verdict

- **GIVEN** a connection whose socket is `CONNECTING`, `CLOSING`, or `CLOSED`
- **WHEN** a caller invokes `send(msg)`
- **THEN** the returned verdict SHALL NOT indicate the message was handed to the socket
- **AND** the caller SHALL be able to act on the failure at call time rather than
  inferring it from a later timeout

#### Scenario: Absent socket is rejected, not thrown

- **GIVEN** a connection that has never opened (no socket instance)
- **WHEN** a caller invokes `send(msg)`
- **THEN** `send` SHALL return a rejection verdict
- **AND** SHALL NOT throw

### Requirement: The outbox SHALL hold only never-sent messages

A bounded outbox SHALL retain messages refused because the socket was not open,
and flush them when the connection reopens.

The outbox SHALL NOT retransmit a message that was already handed to a socket.
`send_prompt` is forwarded straight to the bridge and is **not idempotent**, so
retransmitting an unacknowledged prompt duplicates it in the transcript. A bridge
acknowledgement exists and MUST NOT be used to drive retransmission.

The outbox SHALL be bounded in entry count, and SHALL drop oldest-first when
full rather than growing without limit.

#### Scenario: A message refused while offline is queued and flushed once

- **GIVEN** a socket that is not `OPEN`
- **AND** a caller invokes `send(msg)` and receives a queued verdict
- **WHEN** the connection reopens
- **THEN** `msg` SHALL be written to the new socket exactly once
- **AND** SHALL be removed from the outbox before the write

#### Scenario: A handed-off message is never re-sent after reconnect

- **GIVEN** a message handed to an open socket
- **AND** the socket closes before any acknowledgement arrives
- **WHEN** the connection reopens
- **THEN** the message SHALL NOT be written again
- **AND** the transcript SHALL NOT contain a duplicate prompt

#### Scenario: Outbox is bounded

- **GIVEN** an outbox at its capacity while the socket is not `OPEN`
- **WHEN** a further message is queued
- **THEN** the oldest entry SHALL be evicted
- **AND** the caller of the evicted message SHALL NOT be told it was delivered

### Requirement: Outbox entries SHALL expire before the pending-prompt deadline

Reconnect backoff caps at 30 000 ms (`useWebSocket.ts`) and the pending-prompt
safety timeout is 30 000 ms (`usePendingPromptTimeout.ts`). Without an expiry
shorter than that boundary, a queued prompt can flush at the moment the UI has
already declared it failed — after which the late flush and the user's retype
both deliver.

An outbox entry SHALL expire strictly before the pending-prompt safety deadline
for the action it carries, and an expired entry SHALL be discarded rather than
flushed.

#### Scenario: A queued prompt does not flush after the UI gave up

- **GIVEN** a `send_prompt` queued while the socket was not open
- **AND** the pending-prompt safety timeout has fired and marked the bubble failed
- **WHEN** the connection later reopens
- **THEN** the expired entry SHALL NOT be written to the socket
- **AND** the user SHALL NOT receive a duplicate turn if they retype the prompt

#### Scenario: A prompt queued briefly still flushes

- **GIVEN** a `send_prompt` queued while the socket was reconnecting
- **WHEN** the connection reopens well within the expiry window
- **THEN** the entry SHALL be flushed
- **AND** the pending-prompt bubble SHALL NOT be marked failed

### Requirement: An undelivered user action SHALL be surfaced honestly

When a user action is not transmitted, the UI SHALL say so, and SHALL NOT
attribute the failure to the session.

#### Scenario: Never-transmitted prompt fails immediately with a connection message

- **GIVEN** a socket that is not open and an outbox that could not transmit the
  message — rejected at call time, or dropped undelivered on expiry before the
  reconnect lands
- **WHEN** the user sends a prompt
- **THEN** the prompt bubble SHALL be marked failed without waiting 30 seconds
- **AND** the message shown SHALL attribute the failure to the dashboard
  connection, not to the session having failed to respond
- **AND** a prompt that DOES flush within the expiry window SHALL NOT be marked
  failed (it was transmitted)
