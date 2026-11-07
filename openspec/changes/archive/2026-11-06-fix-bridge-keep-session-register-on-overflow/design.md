## Context

`ConnectionManager.sendOne` buffers a frame when the socket is not open;
`bufferMessage` pushes it and, past `maxBufferSize`, evicts one frame, counts
it and logs a rate-limited warning. On open, the buffer is flushed in order.
The lifecycle handler sends `session_register` before any `event_forward`, so
on a large replay the register is the oldest frame and the first evicted.

## Goals / Non-Goals

**Goals:** buffered `session_register` and `session_unregister` frames always
reach the server, in order.

**Non-Goals:** lossless replay (the server re-replays from the JSONL after
register), a larger default ring, a protocol change.

## Decisions

### D1: Exempt session lifecycle frames from eviction

On overflow, evict the oldest frame whose `type` is neither `session_register`
nor `session_unregister`. If every
buffered frame is a lifecycle frame (not reachable in practice), evict the
oldest.

`session_unregister` is included because a session switch
(`session-sync.ts`) sends it for the old session right before the new
`session_register`. If only the register were protected, the unregister could
be evicted and the gateway would register the new session while the old one
stayed active and routable on the same socket.

Alternatives considered:

- **Raise `maxBufferSize`.** Only moves the threshold; a larger session still
  loses the register.
- **Hold `session_register` in a separate slot.** Same effect, more state and
  a second flush path.
- **Raise `spawnRegisterTimeoutMs`.** Does not help; the register is gone.

Classification reads the `type` property, so key order does not matter. A
substring gate skips `JSON.parse` for frames that cannot be lifecycle frames.
Ordering is preserved: lifecycle frames keep their position ahead of later
frames.

## Risks / Trade-offs

- The `findIndex` scan is O(n) per eviction; it stops at the first
  non-lifecycle frame, normally index 0 or 1. Only frames containing a
  lifecycle type string are parsed.
- Out of scope: superseded buffered `session_register` and replay frames
  after a disconnected session switch. The reconnect path sends a fresh
  register and replay before the buffer flush, so the stale buffered pair is
  flushed after it. This ordering exists without overflow and predates this
  change; it needs its own change (coalesce superseded register/replay frames
  on reconnect).
