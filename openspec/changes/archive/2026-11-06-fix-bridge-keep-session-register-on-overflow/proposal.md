## Why

The bridge `ConnectionManager` buffers outgoing frames in a bounded ring
(`maxBufferSize`, default 10000) while the socket is not open, and on overflow
evicts the oldest frame. On resume or fork of a large session, the bridge
queues `session_register` first and then the replay frames. When the replay
exceeds the ring before the socket opens, `session_register` is evicted. The
server only learns a session from its register, so the spawned pi stays
connected but unregistered, the session shows under a placeholder with an empty
cwd, and the spawn-register watchdog kills the process ("Pi started … never
connected to the dashboard"). Raising `spawnRegisterTimeoutMs` does not help:
the register never arrives.

## What Changes

- On ring overflow, the bridge evicts the oldest frame that is not a session
  lifecycle frame (`session_register` or `session_unregister`); a buffered
  lifecycle frame is evicted only when every buffered frame is a lifecycle
  frame (only after ~`maxBufferSize / 2` session switches while offline). The unregister is protected too: a session
  switch sends `session_unregister` for the old session before the new
  `session_register`, and losing it would leave the old session routable.
- Drop counting and the rate-limited `bridge→server` warning are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `incremental-event-sync`: the bridge ring-buffer eviction rule in "Drop-site
  delivery instrumentation" exempts `session_register` and
  `session_unregister`.

## Impact

- `packages/extension/src/connection.ts` (`bufferMessage`).
- `packages/extension/src/__tests__/connection-dropped-frames.test.ts`.
- No protocol, config or server change. Old servers are unaffected.

## Discipline Skills

- `systematic-debugging`: root cause reproduced from the bridge's
  `dropped buffered message (ring overflow)` log before the fix.
- `review-code`: before commit.
