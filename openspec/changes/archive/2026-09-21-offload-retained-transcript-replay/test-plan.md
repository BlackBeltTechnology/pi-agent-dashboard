# Test Plan — offload-retained-transcript-replay

Stage: design   Generated: 2026-09-19

Derived from `specs/server-session-hydration/spec.md` (3 requirements, 16
scenarios) plus the design's D1–D7 invariants. Constants the Triples bind to:
heartbeat `HYDRATE_HEARTBEAT_MS = 10000`, slow-load `HYDRATION_SLOW_WARN_MS =
5000`, worker timeout `30_000`, retention cap `256 MB`, observed max transcript
`44.1 MB`, metrics ring capacity `20`.

One clarification was resolved at the gate: the perf observable is an absolute
event-loop block ceiling of **250 ms** measured off the existing
`monitorEventLoopDelay` / `eventLoopSpikes` feed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Text-fed replay matches file-fed | equivalence partition | L1 | automated | one JSONL transcript, ~200 entries, tree-branch shape | `loadAndReplay({raw})` and `loadAndReplay({sessionFile})` over identical bytes | the two `events` arrays are deep-equal |
| E2 | Text-fed replay matches file-fed (BOM) | BVA on the first byte | L1 | automated | same transcript with a leading U+FEFF | both arms | both yield the full event array; neither yields `[]` |
| E3 | Text-fed replay matches file-fed (linear fallback) | equivalence partition | L1 | automated | transcript with no `parentId` chain | both arms | deep-equal, and non-empty |
| E4 | Two-arm request validation | decision table | L1 | automated | `{}` / `{raw}` / `{sessionFile}` / `{raw, sessionFile}` | `loadAndReplay(req)` | neither-set and both-set → `{success:false, error:"invalid_request"}`; each single-set arm → `success:true` |
| E5 | HTTP entries surface unchanged — empty origin | BVA (zero) | L1 | automated | retention file of `""`, marker present | `store.read(id)` | `{entries: [], complete: true, retained: true}` — NOT `[""]` |
| E6 | HTTP entries surface unchanged — interior blanks | BVA | L1 | automated | `"a\n\nb\n"` retained | `store.read(id)` | `entries` is `["a","b"]` — interior blank dropped, as today |
| E7 | HTTP entries surface unchanged — BOM | BVA | L1 | automated | retained content whose first line carries U+FEFF | `store.read(id)` | entry 0 retains the BOM byte-for-byte |
| E8 | Three-state mapping | decision table | L1 | automated | {content present, absent} × {marker present, absent} | `readRetainedState(id)` | present+marker → `complete`; present+no-marker → `incomplete`; absent+either → `absent` |
| E9 | Refused session id reads absent | equivalence partition (invalid) | L1 | automated | `sessionId` = `"../../etc/passwd"` | `readRetainedState(id)` | resolves `{entries: [], state: "absent"}`; the promise does not reject |
| E10 | Never throws on hostile bytes | fault input | L1 | automated | retained line `{"type":"session"}` then `{"message":{"content":[null]}}` | `readRetainedTranscript(...)` | resolves; `events` is `[]`; `state` is the transfer's, not `absent` |
| E11 | Absent short-circuits before the pool | state | L1 | automated | no retention file | `readRetainedTranscript(...)` | resolves `absent`; the worker pool receives zero jobs |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Retained hydration does not block the loop | tail-latency / event-loop block | L2 | automated | cold subscribe to a remote-origin session with a 44 MB retained transcript | longest contiguous main-thread block < 250 ms, read off the `monitorEventLoopDelay` / `eventLoopSpikes` feed | the hydration's duration |
| P2 | Baseline for the revert gate (task 1.1/6.1) | measurement | L2 | automated | the same 44 MB transcript against the pre-change code path | records the pre-change max block for comparison; no assertion | one run |
| P3 | Metrics ring is not flooded by no-op reads | threshold | L1 | automated | 25 consecutive `absent` retained reads, then one real hydration | `/api/health`'s `hydration` array still contains the real sample | after the 26th read |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Heartbeat keeps firing | state-convergence | L1 | automated | a retained hydration held open past the heartbeat interval (fake clock) | cold subscribe, advance 25 s | ≥2 non-terminal `event_replay{events:[],isLast:false}` frames arrive before the terminal frame; no frame arrives after settle |
| F2 | Leader/follower coalescing | state-transition | L3 | automated | two clients, same remote-origin session, second subscribes mid-hydration | both cold-subscribe within the hydration window | exactly one hydration runs, observable as exactly ONE `hydration` sample for the session in `/api/health`, carrying the fixture's full entry count — one insert, so neither subscriber can see duplicated messages |
| F3 | Follower gets no false empty | state-transition (illegal edge) | L1 | automated | a follower whose subscribe lands while the leader is in flight (load promise held open by hand) | the leader settles | the follower receives no terminal empty `event_replay`, and the session is never marked `dataUnavailable` |
| F4 | Warm path after settle | state-transition | L1 | automated | as F2 but the third client subscribes after the leader settles | third subscribe | it takes the warm `hasEvents` path; no second hydration is started |
| F5 | HTTP read body unchanged | regression | L3 | automated | a retained transcript fixture | `GET /api/sessions/:id/retained-transcript` before and after the change | byte-identical response body |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Worker unavailable falls back | fault-injection (spawn abort) | L1 | automated | `workerUrlOverride` pointing at a bogus entry | retained hydration | resolves with the correct, complete event array computed in-process |
| X2 | `useLoadWorker: false` | fault-injection (config) | L1 | automated | `sessions.useLoadWorker = false` | retained hydration | no worker is spawned; events identical to the worker path |
| X3 | Replay failure keeps state | fault-injection (malformed) | L1 | automated | retained bytes that make replay throw | cold hydration | `{events: [], state: "incomplete"\|"complete"}`; session NOT marked `dataUnavailable`; `retainedTranscript` still stamped |
| X4 | Cancel takes the silent exit | fault-injection (abort) | L1 | automated | a retained hydration whose loader resolves `cancelled` (the last subscriber left) | hydration settles | no events inserted; no `session_updated` broadcast; no `retainedTranscript` re-stamp |
| X5 | Failed hydration releases followers | fault-injection (abort) | L1 | automated | the leader's hydration fails while a follower waits on it | hydration settles | a later cold subscribe starts a fresh hydration (the in-flight entry was cleared) |
| X6 | Pool disposed | fault-injection (lifecycle) | L1 | automated | `stopPolling()` has disposed the pool | retained hydration | resolves `{events: [], state}` with state intact; does not throw on a `null` pool |
| X7 | Completion race | fault-injection (concurrent write) | L1 | automated | `append(complete)` interleaved between the read's two marker samples | concurrent read | never reports `complete` over pre-completion content; `incomplete` is acceptable |
| X8 | Restart race — stale marker | fault-injection (concurrent write) | L1 | automated | restart rewrites a shorter body while a stale `complete` marker still exists | concurrent read | reports `complete: false` (the marker conjunction rejects it) |
| X9 | Restart race — ENOENT window | fault-injection (concurrent write) | L1 | automated | read lands between the restart's `rmSync` and `writeFileSync` | concurrent read | the single ENOENT retry succeeds; the result is NOT `absent` |
| X10 | Marker unreadable ≠ absent | fault-injection (EACCES) | L1 | automated | content readable, marker `chmod 000` | `readRetainedState(id)` | `incomplete`, never `absent` |
| X11 | Content unreadable = absent | fault-injection (EACCES) | L1 | automated | content file `chmod 000` | `readRetainedState(id)` | `absent`; does not throw |
| X12 | Slow retained hydration warns | threshold | L1 | automated | a retained hydration whose wall time exceeds 5000 ms (faked clock) | completion | a slow-load warning is emitted carrying the session id and byte size |
| X13 | Metrics never break the caller | fault-injection (recorder throws) | L1 | automated | a `hydrationMetrics.record` that throws | retained hydration | the hydration result is unaffected; the throw does not propagate |
| X14 | Read/write race — partially written body | fault-injection (concurrent write) | L1 | automated | a read that observes a truncated PREFIX while a pre-existing `complete` marker is still present (the restart path's `writeFileSync`, which a threadpool `readFile` can enter mid-write) | `store.read(id)` | `complete: false` with `retained: true`; never `complete` over a partial body |

---

## Coverage summary

- Requirements covered: 3/3 (16/16 spec scenarios have at least one row)
- Scenarios by class: edge 11 · perf 3 · frontend 5 · error 14
- Scenarios by level: L1 27 · L2 2 · L3 4
- Scenarios by disposition: automated 33 · manual-only 0

## Re-route (implementation time)

`F1`, `F3`, `F4`, `X4` and `X5` moved from **L3 → L1** after the harness's
limits were measured against them.

Each is a state transition gated on a hydration WINDOW — a subscribe landing
while a load is in flight. At L3 that window is held open only by a large
retained transcript, which makes the arms slow and probabilistic. Worse, `F1`
named a hydration *exceeding 10 s*, and a 44 MB transcript (the observed
maximum) parses in low single-digit seconds, so the premise is unreachable at
any fixture size the harness can host.

At L1 the load promise is held open by hand, so every interleaving is exact and
injectable: `F1` advances a fake clock past `HYDRATE_HEARTBEAT_MS`, `F3`/`F4`
suspend and release the loader explicitly, and `X4`/`X5` return the `cancelled`
and failure results directly. All five live in
`packages/server/src/__tests__/subscription-handler.test.ts`.

`F2` KEEPS its L3 arm (two real clients over the real socket, two Playwright
contexts cold-subscribing together) and also gains deterministic L1 arms. The
L3 arm asserts the SERVER's `hydration` ring rather than rendered rows: one
sample for the session, carrying the fixture's full entry count. The ring IS the
coalescing contract — a second hydration would leave a second sample AND insert
the transcript twice (`insertEvent` mints a fresh `seq` per call, so a double
insert is duplicated messages, not an idempotent overwrite). A rendered-row
assertion was tried first and REJECTED: it failed on every run while the server
was reporting exactly one complete hydration, because a concurrent two-page cold
subscribe does not guarantee the settled render pipeline a DOM count needs — a
false negative that would have blocked every future ship. Rendering on this path
is covered by the single-client arms in the same file.

`F5` stays at L3: it is a pure HTTP-surface regression with no timing
component.

## New infra needed

- A **44 MB retained-transcript fixture** generated at test time (not committed)
  for P1/P2. Generation is a loop over a small entry template; the existing
  qa/ harness can host it.
- An **event-loop block probe** for P1/P2. The `monitorEventLoopDelay` feed and
  `eventLoopSpikes` ring already exist (`eventloop-spike-monitoring`); P1 reads
  them rather than adding a harness.
- No new test level. L1 vitest, L2 qa smoke, and L3 Playwright vs the docker
  harness all exist; L3 rows read the hash-derived `dashboardPort` from
  `.pi-test-harness.json`, never a hardcoded `:18000`.
