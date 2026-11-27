# Test Plan — move-subagents-to-plugin

Stage: design   Generated: 2026-11-26

No clarifications are open: every Triple slot below is filled from the delta specs and design.md.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-event-forwarding: plugin owns its manifest event types | decision-table | L1 | automated | ownership table `subagent_*` → `subagents`; declarations from `subagents` and `other` with `as: "subagent_created"`, and from `subagents` with `as: "tool_execution_end"` | each declaration is registered | `subagents` one accepted; `other` refused (+1 rejection counter); `tool_execution_end` refused (+1) |
| E2 | plugin-event-forwarding: ownership table arrives late | state-transition | L1 | automated | `subagents` declares `subagents:created` before any `plugin_ownership` table | table arrives naming `subagents` as owner | declaration becomes active; one subsequent emit yields exactly one `event_forward` `subagent_created` |
| E3 | plugin-event-forwarding: latest group | BVA | L1 | automated | group `lifecycle`, disconnected; emits created, started, started, completed for `a1` | connection returns | exactly one forward for `a1`: the completed frame |
| E4 | plugin-event-forwarding: per-plugin budget | BVA | L1 | automated | `flows` holds 10 keys; `subagents` declares `maxKeys: 256` and retains 256, then 257 keys | flush | all 10 `flows` keys flushed; `subagents` flushes 256, drop counter for `subagents` = 1 |
| E5 | plugin-event-forwarding: maxKeys bound | BVA | L1 | automated | declaration `maxKeys: 257` | registered | refused or clamped to 256, counted; no throw |
| E6 | plugin-tool-update-filter: drop when running | decision-table | L1 | automated | `Agent` update `{partialResult.details: {status:"running", entries:[40]}}`; also `details.entries` | forwarded | forwarded payload has neither `partialResult.details.entries` nor `details.entries`; original object still has 40 entries |
| E7 | plugin-tool-update-filter: condition not met | decision-table | L1 | automated | same with status `completed` | forwarded | payload byte-identical to the emitted one |
| E8 | plugin-tool-update-filter: validation | EP+BVA | L1 | automated | declarations with `toolName: 5`; `dropPaths: []`; 16 paths; 17 paths | registered | 16 paths accepted; the other three refused and counted; no throw |
| E9 | plugin-tool-update-filter: claim gate | decision-table | L1 | automated | toolClaims `Agent` → `subagents`; `other` declares an `Agent` filter | registered | refused (+1); `subagents` filter still drops entries |
| E10 | plugin-store-policy: elision with resident steps | BVA | L1 | automated | over-ceiling `subagent_completed` `entryCount: 300` with entries 0..299 resident | stored | stored `details.entries` is `[]`, `entryCount` 300 |
| E11 | plugin-store-policy: missing resident step | BVA | L1 | automated | same, entries 0..298 resident | stored | entries not elided; event bounded by the generic path; stored size ≤ `MAX_EVENT_DATA_SIZE` + constant |
| E12 | plugin-store-policy: placeholder identity | BVA | L1 | automated | irreducible over-size `subagent_completed {id:"a1", details:{status:"completed"}}`; a second with a 1 KB `id` | stored | placeholder holds `eventType`, `id:"a1"`, `details.status:"completed"`; the 1 KB id is cut to 256 B; size ≤ ceiling |
| E13 | plugin-store-policy: consulted only for owned or claimed | decision-table | L1 | automated | `subagent_entry`, `Agent` `tool_execution_end`, `bash` `tool_execution_end` | stored with a spy policy | spy called for the first two only |
| E14 | plugin-store-policy: delta collapse | state-transition | L1 | automated | stored `subagent_delta` blockId 2 ×5 for `a1`, blockId 3 ×2 | `subagent_entry` blockId 2 for `a1` stored | 0 blockId-2 deltas remain; 2 blockId-3 deltas remain |
| E15 | plugin-store-policy: trim pins | BVA | L1 | automated | open `a1` with `subagent_created` at the oldest seq; store at its retention bound; 501 pin candidates in another fixture | trim runs | `a1` created + latest started still stored; with 501 candidates, 500 kept and 1 counted |
| E16 | plugin-store-policy: tail-subsumption veto | state-transition | L1 | automated | retained `Agent` tail update whose subagent identity is still needed | `Agent` `tool_execution_end` stored | tail update still stored |
| E17 | plugin-store-policy: owner bound | BVA | L1 | automated | `subagent_delta` text over the owner's bound | stored | text stored cut to the owner's bound |
| E18 | in-memory-event-buffer: plugin absent | decision-table | L1 | automated | no subagents policy registered; over-ceiling `subagent_completed` with entries | stored | no entries elision; generic bounding only |
| E19 | plugin-replay-carry: ownership filter | decision-table | L1 | automated | handler returns 2 owned events and 1 `tool_execution_end` | windowed subscribe | `plugin_event_carry` holds the 2 owned events; refusal counter +1 |
| E20 | plugin-replay-carry: per-plugin bound | BVA | L1 | automated | handler returns 40 identity frames then 2500 entries; a second plugin returns 10 events | windowed subscribe | subagents carry = 40 identity + first 1960 entries, drops 540; second plugin carries all 10 |
| E21 | plugin-replay-carry: full stream | EP | L1 | automated | session under the window threshold | subscribe | no handler call, no `plugin_event_carry` |
| E22 | subagent-live-timeline: carry selection | decision-table | L1 | automated | 16000-event fixture: open `a1` (created seq 9000, entries 0-79 in gap, 80-90 in tail); `a2` created and completed in gap; `a3` created seq 150 (head), completed seq 6000 (gap) | subagents carry handler runs | carry holds `a1` created + latest started + entries 0-79; `a3` completed; nothing for `a2` |
| E23 | subagent-live-timeline / plugin-replay-carry: trimmed gap | EP | L1 | automated | gap middle trimmed except pinned identity | subscribe | `a1` identity carried; no error; missing entries not carried |
| E24 | plugin-synthetic-events: append ownership | decision-table | L1 | automated | `subagents` appends `subagent_failed`, then `tool_execution_end` | append | first stored with next seq and broadcast; second refused, nothing stored |
| E25 | plugin-synthetic-events: status-ended fan-out | state-transition | L1 | automated | session with open `a1` | `update({status:"ended"})`, then a reason change re-fire, then `movedTo` relocation in another fixture | status-ended handler called on both transitions; exactly one `subagent_failed` for `a1`; no call for the relocation; existing `onSessionEnded` handlers not called by the status update |
| E26 | plugin-synthetic-events: append during replay | state-transition | L1 | automated | session replaying | plugin appends `subagent_failed` | event stored, zero broadcasts |
| E27 | session-end-orphan-heal: tool-call identity | EP | L1 | automated | open `Agent` call with `partialResult.details.agentId:"ag-1"`, open `bash` call | session ends | two synthesized ends; the `Agent` one carries `details.agentId === "ag-1"`; core source has no `agentId` literal in the heal |
| E28 | subagent-liveness-reconcile: list answers | decision-table | L1 | automated | fake producer: answers `[A running]`; answers `[]`; does not answer; answers late on first `subagents:created`; answers `[A idle]` | bridge-ready | snapshot `[A running]`; snapshot `[]`; no snapshot then one retry; snapshot after the first emission; snapshot with `idle` |
| E29 | subagent-liveness-reconcile: background-only end | decision-table | L1 | automated | running background `A`, foreground `B` | snapshot without both | `A` ends `untracked`; `B` unchanged |
| E30 | subagent-liveness-reconcile: idle revivable | state-transition | L1 | automated | running `A` | snapshot lists `A idle`, then a live `subagent_started` for `A` | `A` ended with marker `idle`, then running with marker cleared |
| E31 | background-subagent-display: started-only row | EP | L1 | automated | no created frame; `subagent_started {id:"a1", details:{subagentType:"batch-applier-b", description:"Apply nav-waits-in-rules", displayName:"batch-applier-b"}}` | reduced and dock row rendered | row name `batch-applier-b`, task `Apply nav-waits-in-rules`, meta `batch-applier-b · N steps`; no `unknown` text |
| E32 | background-subagent-display: no type anywhere | EP | L1 | automated | started frame without `details.subagentType` or `type`, with and without `displayName` | rendered | shows displayName, else the short id; never `unknown` |
| E33 | background-subagent-display: truncated end | state-transition | L1 | automated | running `a1` | `subagent_completed {__truncated:true, id:"a1", details:{status:"completed"}}` | `a1` completed; leaves the Processes lane; view shows the result-too-large note |
| E34 | slice idempotency | state-transition | L1 | automated | each subagents arm (created, started, entry, delta, completed, failed) | the same event applied twice | state deep-equals the single-apply state |
| E35 | ws-frame-delivery-policy: owner policy keys | decision-table | L1 | automated | subagents delivery policy; `subagent_completed` with and without string `id`; real end vs heal | key computed | distinct keys for real end and heal; no key without `id`; with the plugin absent, no key |
| E36 | ws-frame-delivery-policy: policy throws | fault-injection (abort) | L1 | automated | delivery policy that throws | `subagent_completed` sent to a saturated socket | treated as no key (shed); gateway keeps serving |
| E37 | dashboard-plugin-loader: version requirement | EP+BVA | L1 | automated | range `>=0.7.0`; installed 0.6.0, 0.7.0, 0.8.1, a git install with no version; range `not-a-range` | probe / validate | 0.6.0 listed missing as `@blackbelt-technology/pi-dashboard-subagents >=0.7.0`; 0.7.0 and 0.8.1 satisfied; git install satisfied with warning; invalid range throws `ManifestValidationError` |
| E38 | dashboard-plugin-loader: finalizer by owned type | decision-table | L1 | automated | `subagent_completed` with the plugin enabled; with it disabled | reduced | enabled: subagents `onSessionEvent` called; disabled: absent-owner group row, no slot change |
| E39 | subagents-core-boundary: check | decision-table | L1 | automated | fixtures: `case "subagent_completed":` in `browser-gateway.ts`; `"Max parallel subagents"` label; `SUBAGENTSTATE` (case); `/api/plugins/subagents/` in `route-tiers.ts` with allowlist entry | boundary script runs | first and third fail naming file:line; second passes; fourth passes via allowlist |
| E40 | subagents-core-boundary: tree is clean | EP | L1 | automated | the change's final tree | `npm test` runs the boundary script | exit 0 |
| E41 | catch-all-event-forwarding: no core map | EP | L1 | automated | subagents plugin absent | an extension emits `subagents:created` | no `event_forward` sent |
| E42 | subagent-live-cadence removal | EP | L1 | automated | config file containing `subagentTickThrottleMs: 500` | load, then save settings | load succeeds; saved file has no `subagentTickThrottleMs` |
| E43 | subagent-details-payload: bus frame untouched | EP | L1 | automated | producer-shaped `subagents:started` progress tick | bridge forwards | forwarded payload deep-equals the emitted one |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | subagent-details-payload: tick size flat | threshold | L1 | automated | one subagent, timeline 10 → 100 entries, `Agent` updates through the plugin filter | broadcast serialized bytes per tick grow ≤ 2× | the 10 → 100 growth |
| P2 | plugin-replay-carry: carry cost | threshold | L1 | automated | 16000-event fixture, 30 open agents, 3000 gap entries | subagents handler wall time < 200 ms; carry frame ≤ 2 MiB | one subscribe |
| P3 | plugin-replay-carry: handler deadline | fault-injection (delay) | L1 | automated | handler resolving after 250 ms | its carry discarded; head + tail still delivered; log line emitted | one subscribe |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | plugin-replay-carry: client path | state-convergence | L1 | automated | windowed session, gap 12019 | apply a 90-event carry | gap divider still announces 12019; chat row count unchanged; `maxSeq` unchanged |
| F2 | plugin-replay-carry: backfill after carry | state-convergence | L1 | automated | `subagent_entry` index 5 at seq 9000 carried | backfill a range containing seq 9000 | timeline holds index 5 exactly once |
| F3 | plugin-replay-carry: ordering under back-pressure | state-transition | L1 | automated | socket above the threshold during a windowed subscribe | carry + replay sent | browser receives `history_window`, `plugin_event_carry`, then the first `event_replay`, in that order |
| F4 | background-subagent-display + subagent-live-timeline: windowed long session | state-convergence | L3 | automated | docker harness session seeded beyond the replay window with a background subagent created before the tail (see `tests/e2e/large-session-replay.spec.ts`, `tests/e2e/background-subagents.spec.ts`) | open the session in the browser | dock row shows the producer type and task, no `unknown`; the subagent view lists every entry from index 0 |
| F5 | subagent-live-detail-reliability: open inspector converges | state-convergence | L1 | automated | mounted detail view, running subagent | 25 `subagent_entry` events arrive live | rendered entry count converges to 30 from 5 with no resync request sent |
| F6 | subagents-core-boundary: producer below floor | state-transition | L1 | automated | plugin status with the version missing | dock renders while a subagent runs | the one-line update notice renders; no subagent rows |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | plugin-replay-carry: handler throws | fault-injection (abort) | L1 | automated | carry handler throws | windowed subscribe | no carry from that plugin; head and tail delivered; one log line |
| X2 | subagent-live-detail-reliability: resync removed | fault-injection (abort) | L1 | automated | an old client sends `subagent_resync_request` | server receives it | no reply, no error, connection stays open |
| X3 | session-end-orphan-heal: crash without terminal | fault-injection (abort) | L1 | automated | subagent with 12 stored entries, pi killed before a terminal frame | session ends, then replay | one `subagent_failed` `healedBy:"session_ended"`; replay renders scalar state + 12 steps |
| X4 | plugin-event-forwarding: owned forward mis-stamped | fault-injection (abort) | L1 | automated | `event_forward` of `subagent_created` stamped with `pluginId: "other"` | server ingest | event not stored; rejection counted |
| X5 | subagent-liveness-reconcile: partial list from one activation | fault-injection (partial) | L1 | automated | two activations; first answers without `B`; `B` had a live frame after `takenAt` | snapshot arrives | `B` stays running |
| X6 | end-to-end live reproduction | soak / real workload | — | manual-only | real long session (>12000 events) with background subagents started before the tail | open it in the dashboard | rows show producer type and task, stream has no gap. Human check on a real producer, no fixture equivalent |

---

## Coverage summary

- Requirements covered: every ADDED, MODIFIED and REMOVED requirement in the 21 delta specs maps to at least one row.
- Scenarios by class: edge 43 · perf 3 · frontend 6 · error 6
- Scenarios by level: L1 56 · L2 0 · L3 1 · manual-only 1
- Scenarios by disposition: automated 57 · manual-only 1

## New infra needed

- F4 needs a way to seed a session longer than the replay window into the docker harness with producer-shaped subagent frames. Extend the seeding used by `tests/e2e/large-session-replay.spec.ts`.
