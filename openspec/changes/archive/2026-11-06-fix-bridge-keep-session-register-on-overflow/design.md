## Context

`ConnectionManager.sendOne` buffers a frame when the socket is not open;
`bufferMessage` pushes it and, past `maxBufferSize`, evicts one frame, counts
it and logs a rate-limited warning. On open, the buffer is flushed in order.
The lifecycle handler sends `session_register` before any `event_forward`, so
on a large replay the register is the oldest frame and the first evicted.

## Goals / Non-Goals

**Goals:** a buffered `session_register` always reaches the server.

**Non-Goals:** lossless replay (the server re-replays from the JSONL after
register), a larger default ring, a protocol change.

## Decisions

### D1: Exempt `session_register` from eviction

On overflow, evict the oldest frame whose serialized form does not start with
`{"type":"session_register"`. If every buffered frame is a register (not
reachable in practice), evict the oldest.

Alternatives considered:

- **Raise `maxBufferSize`.** Only moves the threshold; a larger session still
  loses the register.
- **Hold `session_register` in a separate slot.** Same effect, more state and
  a second flush path.
- **Raise `spawnRegisterTimeoutMs`.** Does not help; the register is gone.

The prefix check relies on `JSON.stringify` putting `type` first, which holds
for every `session_register` literal in the bridge. Ordering is preserved: the
register keeps its position ahead of later frames.

## Risks / Trade-offs

- The `findIndex` scan is O(n) per eviction; it stops at the first
  non-register frame, normally index 0 or 1.
- A register sent with a different key order would not be recognised and
  could still be evicted; the test pins the current shape.
