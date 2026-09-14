# Offload retained-transcript parse + replay off the event loop

## Why

`serve-retained-remote-transcripts` added a second producer of dashboard events
— `readRetainedTranscript` — and it runs **synchronously on the main thread**,
in two places: the cold-hydration branch of `subscription-handler.ts` and the
`GET /api/sessions/:id/retained-transcript` route.

The local path does not. `offload-session-events-load-to-worker` moved the
equivalent work (`loadSessionEntries` + `replayEntriesAsEvents`) into a
`worker_threads` pool precisely because a large transcript's parse stalls every
session's traffic, and `fix-history-loading-false-empty-flash` added a
hydration heartbeat to cover that window. The retained path has neither — and
its heartbeat, sharing the blocked loop, cannot fire while it runs.

Why it was not done in the originating change:

- The read is not reachable by an anonymous caller. The bytes only exist
  because an **authenticated paired device** streamed `transcript_chunk` frames,
  and the route is `networkGuard`ed.
- `RemoteTranscriptStore` caps a retained transcript at 256 MB, so the input is
  bounded rather than open-ended.
- The two unbounded shapes found in review — the `parentId` cycle in
  `parseSessionEntries` and the O(orphans × messages) orphan-close in
  `state-replay` — were fixed there, so what remains is linear work on bounded
  input, not a hang.

That makes it a latency problem rather than an availability one, which is why
it was carved out instead of rushed. It is still real: the measured local
maximum transcript is 44.1 MB, and a cold subscribe to a retained session that
size blocks HTTP, WebSocket traffic, and the heartbeat for the duration.

Raised by CodeRabbit on PR #663 and by the local `@review` pass, both rating
the deferral defensible and the work worth doing.

## What Changes

- Teach the session-load worker pool to accept **entries** as well as a file
  path, so the retained read reuses the same worker, the same
  `replayEntriesAsEvents`, and the same event-parity contract rather than a
  second projection.
- Route both retained callers through it: the cold-hydration branch and the
  read route.
- Keep the store read itself off the main thread too (`fs.promises`), so the
  synchronous `readFileSync` of a 44 MB file stops being a main-thread stall in
  its own right.
- Preserve the current observable contract exactly: `{entries, events, state}`,
  the three-state `complete | incomplete | absent`, the never-throws guarantee
  (parse included), and the `absent` reading of a refused session id.

Out of scope: the read-only boundary, the origin gate, completeness semantics,
and the client surface — all shipped and covered.

## Discipline Skills

- `performance-optimization` — the change is justified by a latency budget, so
  it must be measured before and after rather than assumed; the 44.1 MB
  observed maximum is the input that decides whether it succeeded.
- `observability-instrumentation` — `hydrationMetrics` records a sample per
  `loadSessionEvents` call; the retained path currently records nothing, so
  "is hydration slow for remote sessions?" has no answer at runtime.

## Impact

- Affected: `packages/server/src/session/retained-transcript.ts`,
  `session-load-worker.ts`, `session-load-worker-pool.ts`,
  `browser-handlers/subscription-handler.ts`,
  `routes/session-routes.ts`.
- Follows: `serve-retained-remote-transcripts` (PR #663).
