# Serve the session diff from the durable transcript, not the volatile event store

## Why

`GET /api/session-diff` reads `eventStore.getEvents(sessionId, 0)` and scans it
for Write/Edit/Bash `tool_execution_start` events (`session-diff.ts::extractFileChanges`).
The memory event store is a bounded, in-RAM ring — it is not a durable record of
the session. Whenever the Write/Edit events are gone from RAM, the ownership gate
sees zero owned files, every dirty file in `git status` lands in `otherChanges`,
and the Diff panel renders empty. The response is a `200` with `files: []`, so
nothing signals the degradation.

Measured on the live dashboard (2026-05-20):

| Session | Write/Edit calls in JSONL | `/api/session-diff` | Why events are missing |
|---|---|---|---|
| `01a09c48…` (live, deepseek-flash, chatty) | 62 | `files: 0, otherChanges: 63` | `storeTrim.bySession = 37 673` — per-session cap trims non-essential events oldest-first; `tool_execution_start` is non-essential. (This host sets `maxEventsPerSession: 2000`; the code default is 20 000 — the same loss, later.) |
| `f522b9fe…` (ended, pre-restart) | 72 | `files: 0, otherChanges: 3` | Server restarted after the session ran; store starts empty |
| `da7d08cf…` (ended, pre-restart) | 68 | `files: 0, otherChanges: 3` | same |
| `833c5310…` (ended, pre-restart) | 10 | `files: 0, otherChanges: 3` | same |

The store loses diff-relevant events in four independent ways — per-session trim,
server restart, LRU session eviction (100-session cap), and any future `event_data`
size trim — while the session JSONL on disk holds all of them at full fidelity.
The chat's own "N files +A −D" summary is client-derived from the events the
browser received, so the two surfaces disagree for the same session.

The same route file already treats the JSONL as source of truth for the
truncated-payload endpoint (`/api/session-change/:sessionId/:toolCallId` →
`findSessionToolCallPayload(session.sessionFile, …)`), and the load-worker
already turns a JSONL into the dashboard event shape
(`loadSessionEntries` + `replayEntriesAsEvents`). The building blocks exist; the
diff route just points at the wrong source.

## What Changes

- `GET /api/session-diff` for a **local** session derives its tool-call events
  from the session transcript (`session.sessionFile`) instead of
  `eventStore.getEvents`. Extraction, ownership gating, git enrichment and
  the response shape stay exactly as they are — only the event *source* changes.
- The transcript is parsed off the main thread through the existing
  session-load worker pool, with a diff-only projection (assistant
  `message_end` + `tool_execution_start`/`_end`, in live order, tool args
  capped with the store's own truncation helper) so the `Event-loop
  responsiveness` requirement holds, the `message` excerpt on each change
  matches the live path, and payload sizes / `truncated` flags are identical
  to today's.
- The parse happens *inside* the cache's single-flight compute, and the cache
  key gains a source signature (transcript `mtime:size` + store event count) —
  a cache hit never touches disk; a new tool call always invalidates, even
  when `git status` is unchanged, on either source.
- Sessions whose transcript is missing or yields no entries (freshly spawned,
  header-only, corrupt), or that fail the existing `mayReadLocalSessionFile`
  gate, fall back to the event store — the current behaviour, and never worse
  than the transcript in those cases.
- Ended sessions clamp an unclosed Bash window to the transcript's last entry
  instead of `now`, so an aborted Bash call in an old session cannot claim
  files edited in the cwd since.
- Remote (gateway) sessions keep the store path unchanged.

Out of scope: rehydrating the event store from disk on boot; changing the
store's trim policy (reviewed and rejected — making tool starts "essential"
would push the trim into its blind Pass-2 splice and break `preserve-chat-head`);
transcript-sourced diffs for remote sessions; changing what the diff *shows*.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-diff-extraction`: `Event-based change extraction` — the scan source
  becomes the session transcript for local sessions (event-store fallback when
  the transcript is missing or empty; remote sessions unchanged). New scenarios
  pin the loss modes (trimmed, post-restart, evicted, forked) to a non-empty
  `files` result, the live-order `message` attribution, and the ended-session
  Bash-window clamp. `Session-diff result cache and single-flight` gains the
  source signature in its key and a "cache hit does not read the transcript"
  scenario. `Event-loop responsiveness under heavy session diffs` gains a
  scenario for a multi-MB transcript.

## Discipline Skills

- `performance-optimization` — a synchronous multi-MB `readFileSync` + JSON
  parse on the request path would violate the existing event-loop requirement;
  the design routes it through the worker pool and the tasks include a
  measured before/after on a large transcript.
- `doubt-driven-review` — ran at planning (two reviewers, cross-model on
  `@propose-review-1`); it moved the parse inside the cache compute, dropped
  the trim-set change, added the ended-session window clamp and the
  live-order projection. Re-run on the `buildSessionDiffCached` signature
  change before it stands in the worktree.
- `systematic-debugging` — not needed; root cause is established with evidence
  above.

## Impact

- `packages/server/src/routes/session-routes.ts` — event-source resolution on
  `/api/session-diff` (local + transcript present → worker; else store);
  optional `loadWorkerPool` dependency.
- `packages/server/src/session/session-diff.ts` — `buildSessionDiffCached`
  takes an event *loader* + source key; `buildSessionDiff` gains
  `opts.windowEnd`.
- `packages/server/src/session/session-load-worker.ts` — `mode: "diff-events"`
  request variant.
- `packages/server/src/session/session-diff-source.ts` (new) — gate, stat,
  loader, `projectDiffEvents` (live order + store-parity truncation).
- `packages/server/src/persistence/memory-event-store.ts` — export the
  existing truncation helper (no behaviour change).
- `packages/server/src/directory-service.ts` / `server.ts` — expose the pool
  getter; wire into `registerSessionRoutes`.
- `openspec/specs/session-diff-extraction/spec.md` — delta.
- Tests: `packages/server/src/__tests__/session-diff*.test.ts` +
  `session-load-worker.test.ts` + a shared projection test.
- No client change; no protocol change; no new dependency; no behaviour change
  in `memory-event-store.ts`.
