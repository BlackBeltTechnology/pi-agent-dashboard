# Test Plan — fix-session-diff-durable-source

Stage: design   Generated: 2026-05-20

Requirement refs: `EX` = Event-based change extraction · `EL` = Event-loop responsiveness under heavy session diffs · `CA` = Session-diff result cache and single-flight · `OG` = Session-ownership gating (unchanged, must hold on the transcript path).

Fixture vocabulary: "transcript" = a JSONL under a temp dir with a valid `session` header line + `message` entries (assistant `toolCall` parts, `toolResult` entries) in pi's on-disk shape; "store" = `createMemoryEventStore` with the test cap; "route" = `registerSessionRoutes` on a fastify instance with a temp git repo as `cwd`. All timestamps are explicit ms values so ordering assertions are deterministic.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | EX | EP (loss mode: trim) | L1 | automated | store cap 50; session ingests 10 Write/Edit starts then 200 `tool_execution_update` events so all starts are trimmed (`storeTrim.bySession > 0`); transcript on disk holds the same 10 calls | `GET /api/session-diff` | `files` lists the 10 paths with `sessionOwned: true`; `otherChanges` does not contain them |
| E2 | EX | EP (loss mode: restart/evicted) | L1 | automated | empty store (no buffer for the session at all); transcript with 3 Edit + 1 Write | `GET /api/session-diff` | `files.length === 4`; each entry's `changes[0].type` matches the tool; `otherChanges` empty |
| E3 | EX | state-transition (branch walk) | L1 | automated | transcript whose leaf entry chain has `parentId` links to an ancestor entry carrying a Write; a sibling branch (not on the leaf chain) carries a different Write | `GET /api/session-diff` | ancestor Write's path is in `files`; sibling branch's path is NOT |
| E4 | EX | decision table (message attribution) | L1 | automated | transcript: assistant msg A (text "first") → toolCall Edit `a.ts`; assistant msg B (text "second") → toolCall Edit `b.ts` | `projectDiffEvents` then `extractFileChanges` | `a.ts` change `message === "first"`, `b.ts` change `message === "second"`; projected order is `message_end(A), start(a), message_end(B), start(b)` |
| E5 | EX | EP (fallback: missing) | L1 | automated | session with `sessionFile` pointing at a non-existent path; store holds 2 Write starts | `GET /api/session-diff` | `files.length === 2` (store-sourced); response keys identical to E2's response keys |
| E6 | EX | EP (fallback: zero entries) | L1 | automated | transcript file exists containing only the `session` header line; store holds 1 Edit start | `GET /api/session-diff` | `files.length === 1` from the store |
| E7 | EX | EP (fallback: bad header) | L1 | automated | transcript file exists whose first line is `{"type":"garbage"}`; store holds 1 Edit start | `GET /api/session-diff` | `files.length === 1` from the store; HTTP 200 (no 500) |
| E8 | EX / OG | decision table (origin gate) | L1 | automated | session with `originDeviceId: "remote-1"` and `sessionFile` = a real local file containing 5 Write calls; store holds 1 Edit start | `GET /api/session-diff` with `fs.stat`/`fs.readFile` spied | `files.length === 1` (store); the spy records NO call with the `sessionFile` path |
| E9 | EX | EP (no sessionFile) | L1 | automated | local session with `sessionFile: undefined`; store holds 1 Write start | `GET /api/session-diff` | `files.length === 1`; no thrown `ERR_INVALID_ARG_TYPE`; HTTP 200 |
| E10 | EX | BVA (truncation parity) | L1 | automated | transcript Write with `content` of exactly `DEFAULT_MAX_STRING_SIZE + 1` chars (4001) and an Edit with 21 `edits`; the same two events ingested into a store with default caps | `projectDiffEvents({ maxStringSize: 4000 })` vs `store.getEvents` | projected `args` deep-equal the store-ingested `args` for both events; `extractFileChanges` yields `truncated: true` for the Edit on both paths |
| E11 | EX | BVA (truncation cap boundary) | L1 | automated | transcript Write with `content` of exactly 4000 chars; Edit with exactly 20 `edits` | `projectDiffEvents({ maxStringSize: 4000 })` | `content` untouched (length 4000); `edits` array intact (length 20); no `truncated` flag |
| E12 | EX | EP (projection event set) | L1 | automated | transcript with user msg, assistant text-only msg, assistant msg with Bash toolCall, its `toolResult`, a `compaction` entry, a `model_change` entry | `projectDiffEvents` | emitted `eventType` set ⊆ {`message_end`, `tool_execution_start`, `tool_execution_end`}; exactly 2 `message_end` (assistant only); `lastEntryTs` equals the `compaction`/`model_change` entry's ts if it is the latest |
| E13 | OG | state-transition (open Bash, live) | L1 | automated | transcript with a Bash start (ts T) and no `toolResult`; session `status: "streaming"`; a cwd file with mtime T+5 s | `GET /api/session-diff` | the file is in `files` (window `[T, now]` — running tool owns it) |
| E14 | OG | state-transition (open Bash, ended) | L1 | automated | same transcript as E13 but last entry ts = T+1 s; session `status: "ended"`; cwd file mtime T+60 s | `GET /api/session-diff` | the file is in `otherChanges`, not `files` (window clamped to `[T, T+1 s]` + 1 s slack) |
| E15 | OG | BVA (clamp slack) | L1 | automated | ended session, last entry ts = T; cwd file mtimes at T+999 ms and T+1001 ms (`MTIME_SLACK_MS = 1000`) | `GET /api/session-diff` | T+999 file in `files`; T+1001 file in `otherChanges` |
| E16 | EX | EP (worker vs in-process parity) | L1 | automated | one transcript with 3 Write + 1 Bash; route once with a real `createSessionLoadWorkerPool({useWorker:true})`, once with `loadWorkerPool` absent | `GET /api/session-diff` both ways | the two `data` payloads are deep-equal |
| E17 | EX | EP (pool disposed) | L1 | automated | `loadWorkerPool: () => null` (simulates post-dispose) | `GET /api/session-diff` | same result as E16; no rejection |
| E18 | EX | BVA (MAX_FILES on transcript path) | L1 | automated | transcript with 201 distinct Write paths | `GET /api/session-diff` | `files.length === 200`; Write/Edit precedence and path sort as on the store path |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | EL | tail-latency (event-loop) | L1 | automated | generated ≥ 20 MB transcript (assistant messages with large text + 2 000 Edit calls); route with a real worker pool | while `GET /api/session-diff` is in flight, 10 sequential `GET /api/health` calls: every one < 100 ms; sanity: the same test with the loader forced in-process (`loadWorkerPool` absent) records at least one health call ≥ 100 ms (proves the assertion can fail) | single request |
| P2 | EL | throughput (measurement) | — | manual-only | same 20 MB fixture; 5 consecutive uncached `GET /api/session-diff` (touch the file between calls) | record p50 / p95 of the worker parse (from the pool's timing) and RSS delta; NO threshold — number goes into `design.md` § Risks | 5 requests |
| P3 | CA | tail-latency (cache hit) | L1 | automated | transcript with 50 Write calls; two requests within 500 ms, nothing changed | second request's wall time < 20 ms and the worker-pool dispatch spy is called exactly once across both | 2 requests |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | EX | state-convergence (post-restart) | L3 | automated | harness: spawn a git session, send a prompt that Writes 2 files, wait for both tool events, then `POST /api/restart` and wait for `/api/health` to come back (exemplar `tests/e2e/ended-session-endedat.spec.ts` restart flow) | open the session's Diff panel | file tree converges to exactly the 2 written paths; selecting one renders a non-empty `diff:` tab (exemplar `tests/e2e/out-of-cwd-session-diffs.spec.ts` selectors) |
| F2 | EX | visual/subjective | — | manual-only | the four real sessions from `proposal.md` on the developer's dashboard (`01a09c48…`, `f522b9fe…`, `da7d08cf…`, `833c5310…`) | open each Diff panel after deploying | [judgment: panel shows the session's files; chat's "N files +A −D" block and the panel agree — no automatable oracle for historical real sessions] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | EX | fault-injection (stat error) | L1 | automated | `fs.stat` rejects with `EACCES` for the session file | `GET /api/session-diff` | HTTP 200; store-sourced result; `sourceKey` component is `t:0:0` |
| X2 | EX | fault-injection (malformed lines) | L1 | automated | transcript with a valid header, 2 good Write entries, one truncated last line (mid-append) | `GET /api/session-diff` | `files.length === 2`; no throw |
| X3 | CA | state-transition (key invalidation, transcript) | L1 | automated | transcript with an Edit on `a.ts` (already dirty in git); request; then append a second Edit on `a.ts` to the transcript (porcelain unchanged) | second `GET /api/session-diff` within TTL | second response's `a.ts` entry has 2 change events (recomputed) |
| X4 | CA | state-transition (key invalidation, store) | L1 | automated | session with no `sessionFile`; store has 1 Write start; request; then ingest a second Write start | second request within TTL | `files.length === 2` |
| X5 | CA | decision table (no-bust cases) | L1 | automated | transcript path: request; then ingest 50 `message_update` events into the store and nothing else (file untouched) | second request within TTL | worker-pool dispatch spy still called exactly once; same `data` reference/equality |
| X6 | CA | state-transition (single-flight) | L1 | automated | worker load stubbed to resolve after 200 ms | fire 5 concurrent `GET /api/session-diff` | load invoked exactly once; all 5 responses deep-equal |
| X7 | EL / OG | fault-injection (pool timeout) | L1 | automated | pool `timeoutMs: 50`; worker stubbed to never respond | `GET /api/session-diff` | request still resolves with the correct `files` (in-process fallback); documented degraded path, must not reject |

---

## Coverage summary

- Requirements covered: 4/4 (EX, EL, CA touched by the delta; OG unchanged but exercised)
- Scenarios by class: edge 18 · perf 3 · frontend 2 · error 7
- Scenarios by level: L1 27 · L2 0 · L3 1 · — 2
- Scenarios by disposition: automated 28 · manual-only 2

## New infra needed

- none — L1 rows extend `packages/server/src/__tests__/session-diff.test.ts` (route + git-repo fixtures), `session-load-worker.test.ts` (pool/worker), and a new `session-diff-source.test.ts` (projection + resolve); F1 extends the existing docker harness restart flow.
