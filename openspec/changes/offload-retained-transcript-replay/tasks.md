# Tasks — offload-retained-transcript-replay

Carried out of `serve-retained-remote-transcripts` (PR #663), where the retained
read landed synchronous on the main thread while the equivalent local path had
already been moved into a worker by `offload-session-events-load-to-worker`.

## 1. Measure first

- [ ] 1.1 Record the main-thread cost of `readRetainedTranscript` across the real size distribution (p50 73 KB, p90 1.1 MB, p99 3.9 MB, observed max 44.1 MB) — no optimisation lands before the number it is supposed to move exists
- [ ] 1.2 Confirm the hydration heartbeat genuinely cannot fire during the blocked window (it shares the loop), so the "false empty state" net is provably absent on this path

## 2. Worker path

- [ ] 2.1 Extract `splitTranscriptLines(raw) = raw.trim().split("\n")` in `session-file-reader.ts`; `loadSessionEntries` and the worker's raw arm adopt it, so text-fed and file-fed produce identical EVENTS by construction rather than by assertion (design D1 — the BOM case diverges today)
- [ ] 2.2 Do NOT adopt the shared splitter inside `RemoteTranscriptStore.read` — it would change the HTTP `entries` surface: `"".trim().split("\n")` is `[""]` where the store's filter yields `[]` (an empty-origin transcript is reachable), interior blanks would reappear, and a leading BOM would vanish from entry 0
- [ ] 2.3 Make `SessionLoadRequest` a two-arm input (`sessionFile?` XOR `raw?`); the `raw` arm splits + parses IN THE WORKER, and `loadAndReplay` returns `{success:false, error:"invalid_request"}` when neither or both are set
- [ ] 2.4 Assert output parity between the text-fed and file-fed arms, including a BOM/leading-whitespace first line — the existing worker parity test is the model; a divergence here would render a remote session differently from the machine it came from

## 3. Store read

- [ ] 3.1 Add `RemoteTranscriptStore.readRaw(sessionId): Promise<{raw, complete, retained}>` on `fs.promises`; reimplement `read()` on top of it, KEEPING its own `split("\n").filter(len > 0)` (design D5)
- [ ] 3.2 Sample the `.complete` marker BEFORE **and** AFTER the content read and take the conjunction — marker-first alone fixes the completion race but not the restart race, where `append` rewrites a shorter file before clearing a stale `complete` marker (design D5)
- [ ] 3.3 Retry the content read ONCE on ENOENT after a macrotask yield: the restart path `rmSync`s before it `writeFileSync`s, and an async read landing in that window would report `absent` — "no transfer ever happened" — for a session that is merely mid-restart
- [ ] 3.4 Add `completenessOf(sessionId)` reading only the marker plus a `stat`, and move the archived-open call site onto it; it consumes `.state` alone and today reads the whole body to get it
- [ ] 3.5 Keep the two failure mappings distinct: a marker `access` rejection (missing OR unreadable) → `complete:false` in its OWN catch; only a CONTENT read rejection → `retained:false` → `absent`. `fs.promises.access` rejects on ENOENT where `existsSync` returned `false`, so a shared catch would collapse every `incomplete` into `absent`
- [ ] 3.6 Keep every other store-owned responsibility inside the store: id refusal, the private `.complete` marker naming, and the `absent` reading of an unreadable file. No caller re-derives them

## 4. Callers

- [ ] 4.1 Add `DirectoryService.loadRetainedEvents(sessionId, raw, knownContextWindow)` — shares `loadSessionEvents`' `ensureLoadWorkerPool()` null-guard, `inFlightLoadJobs` registration (so `cancelLoad` reaches a retained job) and metrics `finally`; dispatches `{raw}`, applies NO `customEventGroupResolver` (retained events do not carry that annotation today), and takes no `loadingSet` dedup because coalescing lives in the handler (design D2)
- [ ] 4.2 Do NOT route retained hydration through `loadSessionEvents` itself: its `{success,events}` shape turns a replay failure into `dataUnavailable:true` with no state, `already_loading` into a false empty state for a concurrent subscriber, and silently adds the `customEventGroupResolver` annotation retained events skip today
- [ ] 4.3 Make `readRetainedTranscript` async over `readRaw` + `loadRetainedEvents`; on a not-success result (`disposed`, `invalid_request`, the worker's replay-throw message) return `{events: [], state}` — state INTACT, matching today's swallowed replay error (design D3)
- [ ] 4.4 Surface `cancelled` DISTINCTLY rather than folding it into `{events: [], state}` — the local path skips every side effect on cancel, so folding it would stamp `retainedTranscript` and broadcast `session_updated` after the last subscriber left
- [ ] 4.5 Coalesce concurrent cold subscribes on a per-session in-flight promise in the subscription handler: the leader runs load + ingest + broadcast + replay; a follower starts no hydration, keeps its heartbeat, awaits the leader, then stops the heartbeat and emits nothing (the leader's completion already replays to every current subscriber). Delete the map entry in a `finally` — a leaked entry wedges every later subscribe to that session (design D4)
- [ ] 4.6 Drop `entries` from the hydration return — no caller reads it, and shipping the split array back would put on the main thread exactly the work 2.2 moved off it. `readRetainedState` keeps returning entries for its two HTTP call sites
- [ ] 4.7 `await` in the subscription handler's retained arm in place of `Promise.resolve(...)`, keeping `stopHeartbeat` correct on every exit path and the `retainedTranscript` stamp unchanged
- [ ] 4.8 `await` the now-async `readRetainedState` in its two call sites (the route and the archived open); they stay worker-free because neither replays (design D7)
- [ ] 4.9 `await` the store read INSIDE the `try`, not outside it — `fileFor`'s throw for a refused id becomes a rejection once the read is async, and an un-awaited `try/catch` would silently break the never-throws guarantee
- [ ] 4.10 Preserve the observable contract exactly: three-state `complete | incomplete | absent`, never-throws (parse included), `absent` for a session id the store refuses, and entries in origin order on the HTTP surface

## 5. Instrumentation

- [ ] 5.1 Record the `hydrationMetrics` sample + slow-load warning inside `loadRetainedEvents` — same recorder instance, same `HYDRATION_SLOW_WARN_MS`, same swallow-on-failure isolation. Today the retained path reports nothing and "is hydration slow for remote sessions?" has no runtime answer
- [ ] 5.2 `fileBytes = Buffer.byteLength(raw)` — the true size, comparable with the local path's `statSync().size`; a short-circuited `absent` read records NOTHING, so no-op reads cannot evict real hydrations from the 20-slot ring

## 6. Tests (folded from test-plan.md)

Every `automated` row in `test-plan.md` maps to exactly one task below. Each
names a harness exemplar to copy glue from, then the scenario Triple
(input · trigger · observable).

- [ ] 6.1 L1 worker parity: identical ~200-entry tree-branch JSONL bytes · `loadAndReplay({raw})` vs `loadAndReplay({sessionFile})` · the two `events` arrays are deep-equal — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #E1)
- [ ] 6.2 L1: same transcript with a leading U+FEFF · both worker arms · both yield the full event array, neither yields `[]` — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #E2)
- [ ] 6.3 L1: transcript with no `parentId` chain (linear fallback) · both worker arms · deep-equal and non-empty — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #E3)
- [ ] 6.4 L1 decision table: `{}` / `{raw}` / `{sessionFile}` / `{raw,sessionFile}` · `loadAndReplay(req)` · neither-set and both-set give `{success:false,error:"invalid_request"}`, each single arm gives `success:true` — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #E4)
- [ ] 6.5 L1: retention file of `""` with marker present · `store.read(id)` · `{entries: [], complete: true, retained: true}` — NOT `[""]` — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #E5)
- [ ] 6.6 L1: `"a\n\nb\n"` retained · `store.read(id)` · `entries` is `["a","b"]`, interior blank dropped as today — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #E6)
- [ ] 6.7 L1: first retained line carries U+FEFF · `store.read(id)` · entry 0 retains the BOM byte-for-byte — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #E7)
- [ ] 6.8 L1 decision table: {content present, absent} × {marker present, absent} · `readRetainedState(id)` · present+marker `complete`, present+no-marker `incomplete`, absent+either `absent` — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #E8)
- [ ] 6.9 L1: `sessionId` of `"../../etc/passwd"` · `readRetainedState(id)` · resolves `{entries: [], state: "absent"}` and the promise does not reject — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #E9)
- [ ] 6.10 L1: retained lines `{"type":"session"}` then `{"message":{"content":[null]}}` · `readRetainedTranscript(...)` · resolves, `events` is `[]`, `state` is the transfer's and not `absent` — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #E10)
- [ ] 6.11 L1: no retention file · `readRetainedTranscript(...)` · resolves `absent` and the worker pool receives zero jobs — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #E11)
- [ ] 6.12 L2 perf: cold subscribe to a remote-origin session with a 44 MB retained transcript · the hydration · longest contiguous main-thread block under 250 ms off the `monitorEventLoopDelay` / `eventLoopSpikes` feed — see `qa/tests/25-gateway-remote-join-perf.sh` (test-plan #P1)
- [ ] 6.13 L2 baseline: the same 44 MB transcript against the pre-change path · one run · records the pre-change max block for the 7.1 revert gate, no assertion — see `qa/tests/25-gateway-remote-join-perf.sh` (test-plan #P2)
- [ ] 6.14 L1: 25 consecutive `absent` retained reads then one real hydration · after the 26th read · the real sample is still in `/api/health`'s 20-slot `hydration` array — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #P3)
- [ ] 6.15 L3: remote-origin session whose retained hydration exceeds 10 s · cold subscribe and hold the socket · at least two `event_replay{events:[],isLast:false}` frames ~10 s apart before the terminal frame, and the view never converges to empty — see `tests/e2e/large-session-replay.spec.ts` (test-plan #F1)
- [ ] 6.16 L3: two clients on one remote-origin session, the second subscribing mid-hydration · both cold-subscribe inside the hydration window · exactly one hydration runs and each message appears exactly once in both transcripts — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #F2)
- [ ] 6.17 L3: as 6.16 · the follower's subscribe lands while the leader is in flight · the follower receives no terminal empty `event_replay` and the session is never marked `dataUnavailable` — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #F3)
- [ ] 6.18 L3: a third client subscribes after the leader settles · that subscribe · it takes the warm `hasEvents` path and starts no second hydration — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #F4)
- [ ] 6.19 L3 regression: a retained transcript fixture · `GET /api/sessions/:id/retained-transcript` before and after · byte-identical response body — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #F5)
- [ ] 6.20 L1 fault injection: `workerUrlOverride` pointing at a bogus entry · retained hydration · resolves with the correct complete event array computed in-process — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #X1)
- [ ] 6.21 L1: `sessions.useLoadWorker = false` · retained hydration · no worker spawned, events identical to the worker path — see `packages/server/src/__tests__/session-load-worker.test.ts` (test-plan #X2)
- [ ] 6.22 L1: retained bytes that make replay throw · cold hydration · `{events: [], state: "incomplete"|"complete"}`, session NOT marked `dataUnavailable`, `retainedTranscript` still stamped — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #X3)
- [ ] 6.23 L3: last subscriber leaves mid-hydration · unsubscribe before it resolves · the job is cancelled, no events inserted, no `session_updated` broadcast, no `retainedTranscript` re-stamp — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #X4)
- [ ] 6.24 L3: the leader's hydration fails while a follower waits · that failure · the follower's heartbeat stops and a later cold subscribe starts a fresh hydration — see `tests/e2e/remote-transcript-read.spec.ts` (test-plan #X5)
- [ ] 6.25 L1: `stopPolling()` has disposed the pool · retained hydration · resolves `{events: [], state}` with state intact and does not throw on a `null` pool — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #X6)
- [ ] 6.26 L1: `append(complete)` interleaved between the read's two marker samples · concurrent read · never reports `complete` over pre-completion content; `incomplete` is acceptable — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #X7)
- [ ] 6.27 L1: restart rewrites a shorter body while a stale `complete` marker still exists · concurrent read · reports `complete: false` because the marker conjunction rejects it — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #X8)
- [ ] 6.28 L1: read lands between the restart's `rmSync` and `writeFileSync` · concurrent read · the single ENOENT retry succeeds and the result is NOT `absent` — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #X9)
- [ ] 6.29 L1: content readable, marker `chmod 000` · `readRetainedState(id)` · `incomplete`, never `absent` — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #X10)
- [ ] 6.30 L1: content file `chmod 000` · `readRetainedState(id)` · `absent`, and does not throw — see `packages/server/src/session/__tests__/remote-transcript-store.test.ts` (test-plan #X11)
- [ ] 6.31 L1: a retained hydration whose wall time exceeds 5000 ms on a faked clock · completion · a slow-load warning carrying the session id and byte size — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #X12)
- [ ] 6.32 L1: a `hydrationMetrics.record` that throws · retained hydration · the result is unaffected and the throw does not propagate — see `packages/server/src/session/__tests__/retained-transcript.test.ts` (test-plan #X13)
## 7. Verify

- [ ] 7.1 Re-measure 1.1 and show the main-thread time moved; a change justified by a latency budget that does not move it should be reverted, not kept
- [ ] 7.2 `tests/e2e/remote-transcript-read.spec.ts` still green (behaviour unchanged)
- [ ] 7.3 Verify the heartbeat now fires during a large retained hydration — the condition 1.2 proved absent
- [ ] 7.4 Update every synchronous caller for the now-async `readRetainedState` / `readRetainedTranscript` / `RemoteTranscriptStore.read` — ~14 `.read()` assertions in `remote-transcript-store.test.ts` and ~16 `readRetained*` calls in `retained-transcript.test.ts`; `read()` is on the exported interface
- [ ] 7.5 Refresh the `packages/server/src/session/AGENTS.md` rows for `retained-transcript.ts`, `remote-transcript-store.ts`, `session-file-reader.ts`, `session-load-worker.ts`, and the `directory-service.ts` row, to record the new signatures

## 8. Ship

- [ ] 8.1 `openspec archive offload-retained-transcript-replay`
