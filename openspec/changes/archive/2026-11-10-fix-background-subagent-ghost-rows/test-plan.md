# Test Plan — fix-background-subagent-ghost-rows

Stage: design   Generated: 2026-11-10

Hard gate: no open gaps. Resolved during design review: stop answers combine across activations (spec "phase SHALL say…" + design D3), snapshots only on bridge init (spec + Non-Goals), freshness guard `lastFrameAt` vs `takenAt`/`answeredAt` (spec "Reconcile SHALL NOT change…" + design D5), deferral only at the shed point with a bounded copy (ws-frame-delivery-policy delta + design D6).

L1 = vitest. Plugin bridge entry: `packages/subagents-plugin/src/bridge/__tests__/` (exemplar `bridge-entry.test.ts`, `fakePi()` bus). Plugin client: `packages/subagents-plugin/src/client/__tests__/` (exemplars `toolRowFinalizer.test.ts`, `sessionEventReducer.test.ts`, `SubagentDockGroup.test.tsx`). Gateway: `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`. Replay cache: `packages/client/src/lib/__tests__/replay-persist.test.ts`.
L3 = Playwright against the docker harness (`dashboardPort` from `.pi-test-harness.json`, never `:18000`); frame loss via `tests/e2e/helpers/drop-ws-frames.ts` (`dropServerFrames`). Reconcile L3 rows need producer ≥ 0.8.0 (see New infra).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | liveness: stop answer phase + combine | decision-table | L1 | automated | `fakePi()` bus with plugin bridge activated; producer stub listeners pushing verdict sets: `[]`, `[unknown]`, `[terminal(completed)]`, `[terminal()]`, `[unknown, running]`, `[terminal(stopped), queued]`, `[unknown, terminal(failed)]` | emit `subagents:stop {agentId:"A"}`, flush microtasks | `[]` → no `subagents:stop_result`; others → exactly one with (phase, outcome, status): `unknown/ignored/–`, `terminal/ignored/completed`, `terminal/ignored/–`, `running/stopped/–`, `queued/stopped/–`, `terminal/ignored/failed`; every frame has numeric `answeredAt` |
| E2 | liveness: listener order irrelevant | decision-table | L1 | automated | producer stub registered (a) before, (b) after the plugin bridge's listener; stub pushes `running` with `(data.verdicts ??= []).push(...)` | emit `subagents:stop {agentId:"A"}`, flush microtasks | both orders → one `stop_result` with `phase:"running"` |
| E3 | liveness: async producer verdict not counted | equivalence partition | L1 | automated | stub 1 pushes `unknown` synchronously; stub 2 pushes `running` after `await Promise.resolve()` twice | emit stop, flush microtasks once | one `stop_result` with `phase:"unknown"` (pins the contract: only synchronous verdicts count) |
| E4 | liveness: status mapping | equivalence partition | L1 | automated | registry stub entries with producer statuses `queued`, `running`, `completed`, `error`, `aborted`, `stopped` | emit `dashboard:bridge-ready` | snapshot entries carry `created`, `running`, `completed`, `failed`, `failed`, `stopped` |
| E5 | liveness: snapshot only when a producer answered | BVA | L1 | automated | registry stubs answering: none; one with 0 entries; two with 1 + 2 entries | emit `dashboard:bridge-ready` | none → no `subagents:registry_snapshot`; one → snapshot with `entries:[]`, `scope:"registry"`, numeric `takenAt`; two → one snapshot with 3 entries |
| E6 | liveness: snapshot emitted after declare | state-transition | L1 | automated | plugin bridge activated on `fakePi()` | emit `dashboard:bridge-ready` | in `emitted`, the `dashboard:register-event-forward` for that bridge-ready precedes the `subagents:registry_snapshot`; plain activation emits no snapshot |
| E7 | liveness: forward declaration | equivalence partition | L1 | automated | `SUBAGENTS_FORWARD_DECLARATION` | read it | `subagents:stop_result → {as:"subagent_stop_result", delivery:"latest", key:"agentId"}` and `subagents:registry_snapshot → {as:"subagent_registry_snapshot", delivery:"latest", key:"scope"}`; neither `as` is in `RESERVED_EVENT_TYPES` |
| E8 | liveness: one answer per stop across reload | state-transition | L1 | automated | `fakePi()` whose `on` returns an unsubscribe; activate, unsubscribe all (reload), activate again | emit one stop with one `running` verdict | exactly one `subagents:stop_result` |
| E9 | liveness: untracked targets only live subagents | decision-table | L1 | automated | session map: A `running`, B `created`, C `completed` (result "done"), D `failed`, E `stopped`; none has `lastFrameAt` | reduce `subagent_registry_snapshot {entries:[], takenAt:T}` | A and B `failed` with `healedBy:"untracked"`; C, D, E unchanged (C keeps result "done") |
| E10 | liveness: freshness guard boundary | BVA | L1 | automated | A `running` with `lastFrameAt` = T−1, T, T+1, absent | reduce a snapshot without A with `takenAt` T (and separately a `stop_result {phase:"unknown", answeredAt:T}`) | T−1, T, absent → A `untracked`; T+1 → A stays `running` (same for the stop answer) |
| E11 | liveness: known final status applied, real end wins | state-transition | L1 | automated | A `running` | (1) snapshot `{entries:[{agentId:A,status:"completed"}]}`; (2) real `subagent_completed {id:A, result:"R"}` | after (1) A `completed`, `healedBy:"session_reconcile"`, no result; after (2) A `completed`, result "R", no `healedBy` |
| E12 | liveness: stop answer terminal with status | decision-table | L1 | automated | A `running` | reduce `stop_result {phase:"terminal", status}` for `completed`, `failed`, `stopped`, absent | A becomes `completed`, `failed`, `stopped` (each `healedBy:"session_reconcile"`); absent → A `failed` with `healedBy:"untracked"` |
| E13 | liveness: other session untouched | equivalence partition | L1 | automated | sessions S1 and S2 each with `running` A | reduce a snapshot `entries:[]` into S1 only | S1's A `untracked`; S2's A `running` |
| E14 | liveness: lastFrameAt written by every live path | decision-table | L1 | automated | events for A with timestamps 100–600: `subagent_created`(100), `subagent_started`(200), `subagent_entry`(300), `subagent_delta`(400), Agent `tool_execution_update` with details.agentId A (500) | reduce each in turn | `lastFrameAt` after each is 100, 200, 300, 400, 500; the same object is reachable under `agentSessionId` when present |
| E15 | ws-delivery: defer keys | decision-table | L1 | automated | `type:"event"` frames for session S: `subagent_completed{id:"A"}`, `subagent_failed{id:"A"}`, `subagent_failed{id:"A",healedBy:"session_ended"}`, `subagent_stop_result{agentId:"A"}`, `subagent_registry_snapshot{}`, `subagent_completed{}` (no id), `subagent_completed{id:42}`, `tool_execution_end` | `deferKeyOfEvent(msg)` | distinct keys `subagent_end:S:A` (both real ends), `subagent_heal:S:A`, `subagent_stop_result:S:A`, `subagent_registry_snapshot:S`; `undefined` for the last three; `frameClassOf` still returns `{cls:"transcript", key:"event"}` for all |
| E16 | ws-delivery: bounded projection | BVA | L1 | automated | `subagent_completed` with `details.entries` of 2 MB, `result` of 0 B / 8 192 B / 8 193 B / 100 KB, `error` 50 KB, nested object in details | project for deferral | entries/liveBlock/nested objects gone; result lengths 0 / 8 192 / 8 192 / 8 192; error ≤ 8 192; `deferredProjection:true`; serialized size ≤ 20 KB in every case |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | stop-control: dock ghost leaves on answer | state-transition | L1 | automated | bg docs-writer `running`, `stoppable:true`, dock rows mode; stop store `pending` | reduce `stop_result {agentId, phase:"unknown"}` and re-render | row gone; no `Stopping…`/`Still running`; stop store entry cleared |
| F2 | stop-control: late answer after Still running | state-transition (fake timers) | L1 | automated | as F1, request ok | advance 10 000 ms (row reads `Still running`), then reduce the `unknown` answer | row leaves the lane |
| F3 | stop-control: card feedback cleared | state-transition | L1 | automated | foreground C094 card "stopping…", Agent row running | reduce `stop_result {phase:"unknown"}` | card shows no stop line, row stop no longer offered, Agent row not running (finalized with `healedBy:"untracked"`) |
| F4 | liveness: revive in the dock | state-transition | L1 | automated | bg A ended `untracked` | reduce `subagent_started {id:A}` | A `running`, no `healedBy`, back in the background group |
| F5 | liveness: full-screen copy | equivalence partition | L1 | automated | A `failed` with `healedBy:"untracked"` | render `SubagentDetailView` | shows the localized "no longer tracks it" line, not "parent session ended" |
| F6 | liveness: reload keeps reconcile | state-convergence | L3 | automated | faux `subagent-background` running; then drop its `subagent_completed` via `dropServerFrames`; stop from the dock (producer ≥ 0.8.0 answers `terminal completed` or the end) | reload the page | after reload no background row; header shows no background subagent |
| F7 | ws-delivery: end survives a flood | state-convergence | L1 | automated | fake socket with `bufferedAmount` > `MAX_WS_BUFFER`; gateway `broadcastEvent` of `subagent_completed{id:A}` for a subscribed session | drop `bufferedAmount` to 0, tick the flush interval | the socket received the projected end once; `droppedFrames` unchanged; `deferredSubagentFrames` +1 |
| F8 | ws-delivery: healthy socket gets the full frame | equivalence partition | L1 | automated | fake socket under threshold | `broadcastEvent` a `subagent_completed` with 50 entries and a 20 KB result | the sent JSON equals the full frame (no `deferredProjection`) |
| F9 | ws-delivery: answer never replaces end | state-convergence | L1 | automated | saturated socket | send A's `subagent_completed`, then A's `subagent_stop_result`, then a `session_ended` heal for A; drain | three frames delivered, real end before answer before heal (insertion order) |
| F10 | ws-delivery: ten ends during a flood | BVA | L1 | automated | saturated socket | ten distinct ends (2 MB timelines each), drain | ten projected ends delivered; socket not terminated; `stalledSocketsTerminated` unchanged |
| F11 | ws-delivery: projected copy not cached | state-transition | L1 | automated | replay persister with a `replay`-seeded buffer up to seq 10 | `record` live seq 11 with `deferredProjection:true`, then live seq 12 | seq 11 not in the buffer; buffer marked contaminated (gap) so the next load full-replays |
| F12 | ws-delivery: timeline kept after deferred end | state-transition | L1 | automated | A `running` with 40 entries | reduce the projected `subagent_completed` (no entries) | A `completed`, still 40 entries |
| F13 | incident: ghost end under back-pressure (real stack) | fault-injection + convergence | L3 | automated | faux `subagent-background`; browser WS throttled so the server's `bufferedAmount` crosses `MAX_WS_BUFFER` while the child ends (or `dropServerFrames` disabled; throttle via CDP `Network.emulateNetworkConditions`) | let the child end, then lift the throttle | within 5 s of lifting, the background row leaves the lane; `/api/health` `deferredSubagentFrames` ≥ 1 |
| F14 | adopted look | visual/subjective | — | manual-only | full-screen view of an `untracked` subagent, light and dark | human reads it | [judgment: wording is clear and neutral, not alarming — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | stop-control: older producer | fault-injection (no answer) | L1 | automated | no verdict listener on the bus (0.7.0 shape) | emit stop; and separately in the client: request ok, no answer, advance 10 000 ms | bridge sends nothing; dock row `Stopping…` then `Still running` exactly as today |
| X2 | liveness: ghost cleared by Stop (real stack) | fault-injection (frame loss + restart) | L3 | automated | faux `subagent-background`; `dropServerFrames` drops `subagent_completed`/`subagent_failed`; child ends; producer ≥ 0.8.0 | click Stop on the ghost row | row reads `Stopping…`, then leaves within 2 s; no session abort request; full-screen view shows the final status from the `terminal` answer |
| X3 | liveness: snapshot after reload clears ghosts | fault-injection (extension reload) | L3 | automated | faux `subagent-background` with ends dropped as in X2; producer ≥ 0.8.0 | run `/reload` in the session | after the bridge re-initializes the ghost row leaves the lane without a click |
| X4 | liveness: snapshot does not end a newer subagent | fault-injection (reordering) | L1 | automated | A `created` at 200 with `lastFrameAt` 200 | reduce a snapshot `entries:[]`, `takenAt` 150 | A stays `created` |
| X5 | liveness: stale runtime listener throws | fault-injection (abort) | L1 | automated | `fakePi()` whose `on`/`emit` throw after invalidation | activate after invalidation; emit bridge-ready | activation does not throw; no frame emitted |
| X6 | ws-delivery: end without id is still shed | equivalence partition | L1 | automated | saturated socket | `subagent_completed{}` (no id) | counted as dropped; nothing deferred |

---

## Coverage summary

- Requirements covered: 15/15. subagent-liveness-reconcile 8 (answer every stop: E1, X1; phase: E1–E3, E12; publish registry: E4–E6, E8, X3; takenAt: E5, E7; untracked: E9, F1, F3, F5, X2; not owned: E10, E13, F4, X4; known final: E11, E12; replay order: F6). subagent-stop-control 2 (stop feedback: F3, X1; dock feedback: F1, F2, X2). ws-frame-delivery-policy 3 (class + defer key: E15, X6; survives saturation: F7, F9, F10, F13; bounded: E16, F8, F11, F12). Plus the listener-lifetime design rule (E8, X5).
- Scenarios by class: edge 16 · perf 0 · frontend 14 · error 6
- Scenarios by level: L1 31 · L2 0 · L3 4 · manual 1
- Scenarios by disposition: automated 35 · manual-only 1

No performance scenario: the specs set no latency threshold. F10 bounds memory (pending-map size, no stalled termination).

## New infra needed

- Producer `@blackbelt-technology/pi-dashboard-subagents` 0.8.0 (sibling change) for X2, X3, F6; `docker/Dockerfile` `PI_DASHBOARD_SUBAGENTS_VERSION` 0.7.0 → 0.8.0. Until it ships these three L3 rows run `test.skip` with the reason, and F13 runs on 0.7.0 (it needs only the gateway change).
- F13 needs a socket throttle helper (CDP `Network.emulateNetworkConditions` on the page) in `tests/e2e/helpers/`; no existing helper throttles, `drop-ws-frames.ts` only drops.
