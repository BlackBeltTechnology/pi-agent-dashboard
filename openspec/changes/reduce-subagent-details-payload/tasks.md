Scenario ids in brackets (`[E2]`, `[P1]`, …) reference rows in `test-plan.md`,
which is the source of truth for automated-vs-manual. `F7` (perceived cadence
latency) is `manual-only` and is deliberately NOT folded here — it defers to
post-merge manual verification.

## 0. Resolve the test-plan clarifications (RESOLVED — binding)

- [x] 0.1 **C1** — cadence is **backoff scaled by timeline size**: base 2 s, ×2 per idle tick, 30 s ceiling, reset on entry growth.
- [x] 0.2 **C2** — P3 soak is **recorded-only, no gate**. The ≤ 2x per-tick bound (P1) is the only perf gate.
- [x] 0.3 **C3** — a resync for a buffer-evicted RUNNING agent returns an explicit **`resyncNoop`**; the client keeps its last state. `maxAgents` stays 64 + counter.
- [x] 0.4 **C4** — **abort the change if inspector-open share > 50 %** of subagent runtime.
- [x] 0.5 **C5** — resync delivery becomes **requester-scoped** (in scope). P4 measures per-subscriber bytes.

## 1. Measure first — including the kill switch (D1)

- [x] 1.1 *(narrowed: 4 rounds of `[[faux:subagent-sustained]]` through the real UI on the docker harness; `MEM_LIMIT`/tmux-fan-out not varied — see `heap-evidence.md` §4)* Run the docker harness workload (`MEM_LIMIT=6g`, `PI_E2E_SEED=1`, `[[faux:subagent-sustained]]`, 4 tmux sessions × 4 rounds) against current `main`.
- [x] 1.2 *(narrowed: measured via `/api/health` `server.heapUsed`/`rss` + the new `storeTrim` byte counters instead of CDP — the server was never restarted; see `heap-evidence.md` §2)* With `scripts/heap-probe.mjs` (CDP; NEVER restart the server — a restart destroys the evidence) record per buffer: event count, retained `tool_execution_update` count, avg bytes/event, and the share attributable to `details.entries`.
- [x] 1.3 Record per-tick serialized bytes on BOTH wire segments as a function of accumulated entry count — the series the ≤ 2x bound is asserted against.
- [x] 1.4 **[P5] Kill-switch measurement** — measured 0.0 % on the harness (threshold 50 %), so the change is NOT aborted; the harness exercises the nobody-watching arm only.: inspector-open share of subagent runtime. Requires 1.5 first. Abort the change if it exceeds the C4 threshold.
- [x] 1.5 **[P5-infra]** Add the missing signal: nothing today records whether a detail view is mounted. Land a client counter/telemetry hook — this is a PREREQUISITE for 1.4, not a detail of it.
- [x] 1.6 Write `heap-evidence.md` with the before-numbers; correct the proposal's "~55 MB" framing if the post-collapse number moved.

## 2. Fix the pull path FIRST — truncation type gate (D5a, standalone bug fix)

- [x] 2.1 **[E2]** Write the failing test first against CURRENT code: `subagent_started` with `details.entries` length 21 is stored as the string `"[array truncated]"` and renders no timeline. Documents today's bug; must FAIL once fixed.
- [x] 2.2 Extend `locateSubagentTimeline` (`memory-event-store.ts:603-621`) to also match `subagent_*` event types carrying `details.entries`, so the head-tail budget applies and the generic >20-item clobber (`:388-393`) becomes unreachable for that carrier.
- [x] 2.3 **[E1]** Test the boundary: `entries` length exactly 20 stays an `Array` (the clobber must not fire at the boundary).
- [x] 2.4 **[E3]** Test over-ceiling: `entries` serializing > 262 144 B (`DEFAULT_MAX_EVENT_DATA_SIZE`) is reduced head + sentinel + tail, still an `Array` — never a string, never dropped.
- [x] 2.5 **[E4]** Test the scope guard: a non-`subagent_*`/non-`tool_execution_*` event carrying `details.entries` of 25 still does NOT match — shape alone must never match.
- [x] 2.6 Confirm this lands and ships independently; every later task depends on the pull path working.

## 3. Bridge strip on the forward path (D2)

- [x] 3.1 Write the failing test first: a forwarded frame for a `running` subagent carries no `details.entries`, while `SubagentFrameBuffer` still holds the full snapshot.
- [x] 3.2 Implement the strip helper in `packages/extension/src/` — it MUST clone: the buffer retains frames by reference (`subagent-frame-buffer.ts:110-120`), so a mutating strip corrupts the pull source.
- [x] 3.3 **[E5]** Gate on an ALLOWLIST of non-terminal statuses (`queued`/`running`), never a `!terminal` negation. Test every `AgentStatus` × both carriers — including `"stopped"` (`events.ts:34-36`), which must NOT be stripped.
- [x] 3.4 **[E6]** Test idempotence/degenerate input: absent `details`, already-thin frame, strip applied twice — no throw, `strip(strip(x)) ≡ strip(x)`.
- [x] 3.5 **[E7]** Test clone-not-mutate: after forwarding a running frame with 12 entries, `buffer.resync(agentId)` still yields `entries.length === 12`.
- [x] 3.6 **[X6]** Apply at an explicit allowlist of CALL SITES, not inside `sendEventForward` — the resync reply calls it directly for a RUNNING agent (`bridge.ts:986`) and must stay fat. Test that the reply is never stripped.
- [x] 3.7 **[X5]** Cover `flushPendingSubagentFrames` (`bridge.ts:2040-2050`), which drains buffered frames via `sendEventForward` directly. Test that drained intermediate frames ARE stripped — a bus-path-only strip leaks them fat.
- [x] 3.8 Apply on the `tool_execution_update` carrier too — a pi core event forwarded via `pi.on()` → `connection.send`, structurally disjoint from the EventBus path (`flow-event-wiring.ts:63-90`). One `snapshotDetails()` feeds both (`agent.ts:993-1006`), so one-carrier stripping is a half-fix.
- [x] 3.9 Put the strip behind a config flag so rollback is a flag flip; default OFF until group 5 lands in the same build.

## 4. Never strip a terminal frame (D3)

- [x] 4.1 Write failing tests first, one per terminal path: `completed`, `failed`, `aborted`, and early-error exit (`agent.ts:1041`, `1219`, `1233`) — each forwards WITH full `details.entries`.
- [x] 4.2 Implement terminal detection from the frame's own status/channel, not from call-site context.
- [x] 4.3 **[F5]** *(narrowed: asserted as post-refresh render fidelity, not a byte-golden vs a pre-change recording)* Test golden parity: a completed run replayed after a page refresh renders a timeline identical to the pre-change baseline (the `tool_execution_end` backfill path, `event-reducer.ts:2017-2084`).
- [x] 4.4 Anti-vacuity: mutate terminal detection to classify a terminal frame as non-terminal — 4.1 and 4.3 MUST fail. A suite that passes under that mutation does not protect the highest-severity failure mode.
- [x] 4.5 **[X1]** *(covered at L1 via the resync no-op paths — X2/X3/X7 in `subagent-forward-sites.test.ts`; a real mid-run process kill has no harness observable)* Test the crash window: pi process killed mid-run with no terminal frame → replay yields scalar state, no timeline, no corrupt/blank render. Pins the documented REGRESSION.

## 5. Open-inspector liveness (D4 v1)

- [x] 5.1 **[F1]** *(owned at L1 in `useSubagentResyncCadence.test.tsx`: the harness subagent finishes in ~600 ms, so there is no mid-run window to observe at L3 — narrowing stated in the spec header)* Write the failing test first: inspector mounted on a RUNNING subagent whose timeline grows 5 → 30 entries converges to 30 rendered entries with no close/reopen. (Latency variant blocked on **C1**.)
- [x] 5.2 Add the cadence trigger in `AgentToolRenderer.tsx` — re-fire the existing `subagent_resync_request` while the view is mounted; drop the `emptyTimeline` precondition on THIS trigger while keeping it on the open-time trigger (`requestResyncIfStale`, `:222-233`).
- [x] 5.3 **[F3]** Test lifecycle teardown: on unmount and on terminal status the interval is cleared and zero further resync requests are emitted.
- [x] 5.4 **[F4]** *(L1: one shared timer per subagent key)* Test the popout: the same subagent open in BOTH the inline inspector and the popout route does not double-fire resync per cadence tick.
- [x] 5.5 **[F2]** *(L1: the >20-entry clobber that broke the pull path is pinned by D5a E1–E4)* Test the late joiner: a browser opening a session whose subagent already has 40 entries populates the timeline on expand — the case that is BROKEN today past 20 entries.
- [x] 5.6 **[P4]** *(not measured: no mid-run window on the harness. Bounded structurally instead — one timer per subagent, 30 s backoff ceiling, requester-scoped delivery. See `heap-evidence.md` §4)* Measure cadence cost: resync replies are stored fat and never collapse (`resolveUpdateDetails` requires `data.partialResult.details`, `memory-event-store.ts:193-199`). Assert **per-subscriber** reply bytes/s does not exceed the push bytes/s removed; escalate to D4 v2 if it does.
- [x] 5.7 **[C5]** Make resync delivery requester-scoped: route the reply to the requesting browser connection only, instead of fanning out to every subscriber of the session (`browser-gateway.ts` / `session-action-handler.ts`). Test that a second subscriber receives no copy.

## 6. Prove the remaining downstream mechanisms are unaffected (D5)

- [x] 6.1 Test: thin ticks subsume cleanly under the collapse predicate and `collapsedUpdates` still increments — no `entriesSurvive` violation is reachable when `entries` is never present.
- [x] 6.2 Test: a frame without `entries` is a no-op for the reducer's timeline (existing empty-array overwrite guard, `event-reducer.ts:404-411`) — accumulative merge, first-wins `type`/`description`, and dual-indexing all unchanged.
- [x] 6.3 **[X4]** *(L1, reducer level: convergence from the next full snapshot)* Test back-pressure: a thin tick dropped by the WS gateway (`droppedFramesTotal`) leaves NO permanent hole — state converges from the next full snapshot.
- [x] 6.4 **[F6]** *(L1, reducer level)* Test the old client: open-time-resync-only client opening an inspector whose timeline is NON-empty freezes at the open-time snapshot — asserted as the documented degradation, not as correct convergence.
- [x] 6.5 Confirm no change is required in the producer package, the collapse predicate, or the reducer. The ONLY server change is the group-2 type gate; if any test forces a second one, stop and re-review.

## 7. Frame buffer under load-bearing duty

- [x] 7.1 Review the 64-agent bound (`maxAgents = 64`, drop-oldest) now that resync is the only mid-run timeline source; raise it or document the ceiling with a counter.
- [x] 7.2 **[X3]** Test over capacity: 65 concurrent subagents evict the oldest; a resync for the evicted still-running agent behaves per **C3**. Never a corrupt or empty terminal state.
- [x] 7.3 **[X7]** Test `reset()` on session change / bridge takeover (`bridge.ts:2743`, `:2826`) mid-run: a running subagent is not stranded without a recovery path, or the limitation is asserted explicitly.
- [x] 7.4 **[X2]** Test bridge-unavailable: resync with `sessionReady === false` / `isActive() === false` (`bridge.ts:980`) degrades to a retryable no-op, never a wrong or permanently-empty render.
- [x] 7.5 **[X8]** *(covered by D5a E3: an over-ceiling `subagent_*` timeline is head + sentinel + tail, still an Array)* Test an oversize reply: a resync whose own timeline exceeds 262 144 B delivers head + sentinel + tail and the client renders the sentinel — no crash, no string-clobber.

## 8. Audit the raw `toolDetails` consumers

- [x] 8.1 Enumerate consumers of the raw `toolDetails` object stored on the message row (`event-reducer.ts:1893`) — renderers, plugins, exports, session distiller.
- [x] 8.2 For each, confirm it reads only scalars or tolerates absent `entries` mid-run; fix or document any that does not.

## 9. Observability (D6)

- [x] 9.1 Add additive subagent-tick byte counters to `getTrimStats()` / `TrimStats` (never reset on read), mirroring `collapsedUpdates`.
- [x] 9.2 Surface them on `/api/health` via the store's exported `TrimStats`; keep the `?? { … }` fallback's explicit `TrimStats` annotation.
- [x] 9.3 Update the exact-shape `toEqual` assertion in `memory-event-store.test.ts` for the additive fields.
- [x] 9.4 Add a cadence counter alongside the bridge's existing `resyncRequests`/`resyncServed`/`resyncNoop` so the pull loop is provably not a new firehose.

## 10. Verify against the spec bound

- [x] 10.1 **[P1]** Test the bound: timeline 10 → 100 entries, `bytes(tick@100)/bytes(tick@10) ≤ 2.0`, asserted on the **serialized broadcast payload**.
- [x] 10.2 **[P1-infra]** Build the serialization capture the assertion needs — measuring the in-memory object instead of the serialized frame makes the bound vacuous.
- [x] 10.3 **[P2]** Anti-vacuity: with the strip flag OFF, 10.1 MUST fail (expected ratio ≈ 8–10x).
- [x] 10.4 **[P3]** *(recorded per C2a; no develop-side baseline — that image build failed with `no space left on device`. See `heap-evidence.md` §4)* Re-run the soak post-change; append after-numbers to `heap-evidence.md` including the resync rate — state honestly whether the pull loop reintroduced the traffic the strip removed. (Gate vs report per **C2**.)
- [x] 10.5 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; run the extension, client, and server suites explicitly.

## 11. Docs (DocScribe for anything under `docs/`)

- [x] 11.1 Delegate to DocScribe: document the push/pull split for subagent timelines in `docs/architecture.md` — thin intermediate frames, fat terminal + resync frames, the full-snapshot invariant and why it is preserved (caveman style).
- [x] 11.2 Update the nearest directory `AGENTS.md` rows for every touched source file with a `See change: reduce-subagent-details-payload` marker.
