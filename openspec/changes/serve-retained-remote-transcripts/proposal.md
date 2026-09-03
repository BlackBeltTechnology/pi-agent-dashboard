# Serve the remote transcripts we already retain

## Why

`add-pi-gateway-transport-identity` built the acquisition half of remote session
history and shipped it: a joining bridge streams `transcript_chunk` frames, and
`RemoteTranscriptStore` persists them to
`~/.pi/dashboard/remote-transcripts/<sessionId>.jsonl` with completeness
tracking, retention bounds, symlink refusal, and `0700/0600` modes. That half is
tested (`remote-transcript-store.test.ts`) and exercised end to end by
`qa/tests/25-gateway-remote-join-perf.sh`.

The **read** half was deferred. `RemoteTranscriptStore.read()` exists and works,
and **has no caller and no HTTP route**. So the data is on disk, correct and
complete, and nothing can show it to anybody.

This is the honest reason two tasks in that change could not be ticked:

- **12.52** — an L3 spec for "history predating the attach renders" had no read
  path to drive, and writing one anyway would have produced a test that asserts
  a fiction.
- **13.5** — its "serves history predating the attach" clause was STRUCK rather
  than counted, precisely so the change would not claim a capability it had not
  shipped.

Cost of leaving it: a user who joins a remote dashboard sees a session whose
history exists on the server but renders empty, with no signal distinguishing
"not fetched" from "never captured".

## What Changes

- Add a read route for retained remote transcripts, guarded by the same
  read-only boundary the write path already respects: `decideTranscriptRequest`
  refuses path-bearing fields, and a remote-origin session never reads local
  files (D12/D13).
- Wire the client to request retained history for a remote-origin session, and
  to distinguish INCOMPLETE from EMPTY — the store already tracks completeness,
  and a partial transfer must not be presented as the whole conversation.
- Write the L3 scenario deferred as 12.52, and restore the struck clause of 13.5.

Out of scope: retention policy, acquisition, and the origin/move surfaces —
those shipped and are covered.

## Discipline Skills

- `security-hardening` — a new route serving stored transcripts by session id is
  an object-reference surface; the read must not become a way to name arbitrary
  paths, which is exactly what `decideTranscriptRequest` exists to prevent.
- `observability-instrumentation` — "empty because nothing was captured" and
  "empty because the read failed" must be distinguishable at runtime, or the
  first support question has no answer.

## Impact

- Affected: `packages/server/src/session/remote-transcript-store.ts` (caller),
  new route in `packages/server/src/session/`, client history path,
  `tests/e2e/`.
- Carries task **12.52** and the struck clause of **13.5** from
  `add-pi-gateway-transport-identity`.
