# offline-outgoing-message-queue Specification

## Purpose

Buffer outgoing browser→server messages while the WebSocket connection is unavailable, and deliver them in original order once a send function is available and flush is triggered. The queue is bounded so a long offline period cannot grow memory without limit; when full, the oldest buffered message is evicted to make room for the newest.

## Requirements

### Requirement: Buffer outgoing messages

The queue SHALL accept outgoing messages via enqueue and retain them internally until they are flushed or cleared. Enqueue SHALL always buffer the message regardless of whether a send function has been configured.

#### Scenario: Enqueue while disconnected

- **WHEN** a message is enqueued and no delivery has occurred
- **THEN** the message is retained in the queue
- **AND** the reported size increases by one

#### Scenario: Multiple enqueues accumulate in order

- **WHEN** several messages are enqueued in sequence
- **THEN** they are retained in the order they were enqueued (FIFO)

### Requirement: Bounded capacity with oldest-message eviction

The queue SHALL hold at most 10 messages. When enqueuing a message that would exceed the limit, the queue SHALL evict the oldest (front) message so the size never exceeds 10.

#### Scenario: Enqueue at capacity evicts the oldest

- **WHEN** the queue already holds 10 messages and another message is enqueued
- **THEN** the oldest message is removed
- **AND** the newly enqueued message is retained
- **AND** the reported size remains 10

#### Scenario: Newest messages are always kept

- **WHEN** more than 10 messages are enqueued before any flush
- **THEN** only the 10 most recently enqueued messages are retained, in FIFO order

### Requirement: Flush delivers buffered messages in order

Flush SHALL deliver each buffered message to the configured send function in FIFO order and then empty the queue. If no send function has been configured, flush SHALL be a no-op and SHALL retain the buffered messages.

#### Scenario: Flush after reconnect delivers in order

- **WHEN** a send function is configured and flush is invoked with buffered messages
- **THEN** each buffered message is passed to the send function in the order it was enqueued
- **AND** the queue is emptied afterward
- **AND** the reported size becomes 0

#### Scenario: Flush with no send function retains messages

- **WHEN** flush is invoked and no send function has been configured
- **THEN** no message is delivered
- **AND** the buffered messages remain in the queue

#### Scenario: Flush an empty queue

- **WHEN** flush is invoked and the queue is empty
- **THEN** no message is delivered
- **AND** the queue remains empty

### Requirement: Queue inspection and clearing

The queue SHALL report its current message count and SHALL support discarding all buffered messages without delivering them.

#### Scenario: Report current size

- **WHEN** the queue holds buffered messages
- **THEN** the reported size equals the number of buffered messages

#### Scenario: Clear discards without delivery

- **WHEN** clear is invoked
- **THEN** all buffered messages are discarded without being delivered
- **AND** the reported size becomes 0
