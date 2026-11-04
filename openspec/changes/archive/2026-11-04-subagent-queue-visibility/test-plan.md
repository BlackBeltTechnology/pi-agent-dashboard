# Test Plan — subagent-queue-visibility

Stage: design   Generated: 2026-11-04

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | subagent-queue-state: Queued card distinct | EP | L1 | automated | details `{status:"queued", queuePosition:2, activeSlots:4, maxConcurrent:4}` | render `AgentToolRenderer` | text `#2 in queue`, slot reading `4/4`, wait time; no `animate-spin`; popout disabled |
| E2 | subagent-queue-state: Queued card (older producer) | EP | L1 | automated | details `{status:"queued"}` only | render | text `Queued`; no slot reading; no spinner |
| E3 | subagent-queue-state: slot reading guard | BVA | L1 | automated | `maxConcurrent` ∈ {0, absent, 1} with `activeSlots:1` | render | slot reading hidden for 0 and absent, shown `1/1` for 1 |
| E4 | subagent-queue-state: Wait vs run time | state-transition | L1 | automated | queued with `durationMs:100000`, then running with `slotGrantedAt = now-5000` | rerender | run timer shows ~5s, not ~105s; without `slotGrantedAt` shows today's `durationMs` timer |
| E5 | agent-tool-rendering: Claim-provided row status | decision-table | L1 | automated | row status ∈ {running, complete, error, elided} × rowStatus ∈ {queued, stopped, undefined, throws} | render `ToolCallStep` | queued only alters running; stopped only alters non-error complete; error/elided unchanged; throw renders as before and logs once with plugin id |
| E6 | agent-tool-rendering: Claim-owned per-row stop | decision-table | L1 | automated | claim.stop ∈ {true, false, throws, absent} × in-burst ∈ {yes, no} | click row stop | `true` → onAbort and burst controller not called; else existing path called once |
| E7 | subagent-stop-control: Each row offers its own stop | EP | L1 | automated | details `stoppable` ∈ {true, absent}, status ∈ {queued, running}, `agentId` set/unset | claim `stop()` and `stopLabel()` | true+agentId → returns true and POSTs once; otherwise returns false; labels "Remove from queue" / "Stop subagent" / "Stop (ends the whole turn)" |
| E8 | subagent-stop-control: Stop request validation | BVA + EP | L1 | automated | `agentId` ∈ {"", 128-char, 129-char, "a\u0000b", valid}; `sessionId` known/unknown; operate authority yes/no/seam absent | `POST /api/plugins/subagents/stop` | 400 / 400 / 200 / 400 / 200; unknown → 404; no authority or absent seam → 403; `emitEventToSession` not called on any non-200 |
| E9 | subagent-stop-control: relay is fixed | EP | L1 | automated | body with extra keys `{eventType:"x", data:{}}` | POST valid request | `emitEventToSession` called exactly with `("<sid>", "subagents:stop", {agentId})`; emit `false` → 503 |
| E10 | subagent-stop-control: manifest | EP | L1 | automated | `packages/subagents-plugin/package.json` | load manifest + real emit seam | `emits` contains `subagents:stop`, `priority <= 100`, seam accepts the emit |
| E11 | subagent-stop-control: Stopped renders final + neutral | EP | L1 | automated | `subagent_completed` `{status:"stopped", stopReason:"queued"}` / `"running"` | reduce + render card, row, dock, detail | "removed from queue · never started" / "stopped by you · ran <t>"; no check, no error colour |
| E12 | subagent-producer-settings-persistence: field validation | BVA | L1 | automated | field values −1, 0, 1, 63, 64, 65, 2.5 | global Save | 0,1,63,64 commit; −1, 65, 2.5 show inline error and this section writes nothing |
| E13 | subagent-producer-settings-persistence: Startup reconcile | EP | L1 | automated | producer file `maxConcurrent` ∈ {6, 100, absent, "x"} | plugin start | plugin config 6 / 64 / unchanged / unchanged; file never rewritten |
| E14 | subagent-producer-settings-persistence: Unrelated save keeps hand-set limit | state | L1 | automated | file `maxConcurrent:100`, plugin config without explicit `maxConcurrent` | save only `inheritContext` | file still `100` |
| E15 | subagent-producer-settings-persistence: Merge preserves keys | EP | L1 | automated | file with `inheritContext`, `exposeInheritanceInTool`, `inheritance`, user key, `maxConcurrent:4`; patch `{maxConcurrent:8}` | merge | only `maxConcurrent` changes |
| E16 | heap-limits: coupling | BVA | L1 | automated | ceiling 512 × maxConcurrent ∈ {0, 4, 7, 8} | `subagentHeapBudget` + field render | 4 silent (102 MB); 8 warns (56 MB); 0 warns; 7 warns (64 MB) |
| E17 | subagent-fanout-admission: REMOVED | EP | L1 | automated | 20 `Agent` tool_call events through the bridge | emit `tool_call` | none blocked; no `subagent-admission-refused` entry appended |
| E18 | design D6: leftover key | EP | L1 | automated | `config.json` containing `maxConcurrentSubagents: 12` | `loadConfig()` | loads without error; key not present on the result |
| E19 | design D6: old transcript entries | EP | L1 | automated | transcript with a `subagent-admission-refused` custom entry | render chat | entry resolves to `diagnostics` group, hidden by default |
| E20 | settings-panel: REMOVED | EP | L1 | automated | Settings → Sessions | render `SettingsPanel` | no `maxConcurrentSubagents` field, no fan-out heap warning; heap ceiling fields still present |
| E21 | design D6: completeness gate | static | ci | automated | repo tree | task 5.8 `git grep` | zero matches outside the allowlisted test |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | subagent-queue-state: card + row | state-convergence | L3 | automated | harness producer 0.6.0 with `maxConcurrent:1` written to its settings file; faux `subagent-fanout-queued` (3 slow children) | send prompt | converges to: 1 running card, 2 cards `#1 in queue`/`#2 in queue` with no spinner; their rows show `queued · #1` / `queued · #2` |
| F2 | subagent-queue-state: position update | state-convergence | L3 | automated | F1 state | first child finishes | converges to: former `#1` running with run timer < 5 s, former `#2` shows `#1 in queue` |
| F3 | subagent-stop-control: stop queued | state-convergence | L3 | automated | F1 state | click stop on the `#2` row | converges to: that card "removed from queue · never started"; the running child keeps running; session still streaming (no session abort) |
| F4 | subagent-stop-control: stop running | state-convergence | L3 | automated | F1 state | click stop on the running card | converges to: it shows "stopped by you"; `#1` starts running within 3 s; parent turn continues to the scenario's final text |
| F5 | subagent-stop-control: in a burst group | state-convergence | L3 | automated | F1 state with rows grouped into a burst | stop one row inside the group | only that subagent stops; group header stop still present |
| F6 | subagent-producer-settings-persistence: global save state | state-transition | L3 | automated | plugin settings page | set field 4→8; observe Save bar; press global Save | Save bar shows unsaved changes before Save; after Save, `docker exec` read of the producer settings file shows `maxConcurrent: 8` |
| F7 | subagent-producer-settings-persistence: global discard | state-transition | L3 | automated | field edited 4→8 | press global Discard | field shows 4; producer file unchanged |
| F8 | subagent-producer-settings-persistence: live apply | state-convergence | L3 | automated | F1 state (limit 1, 2 queued) | save limit 3 in plugin settings | within 3 s both queued cards become running without reload |
| F9 | queued and stopped visuals in dark, light and one non-base palette | visual/subjective | — | manual-only | queued and stopped cards | human looks | [judgment: neutral, not alarming, matches mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | subagent-stop-control: Stop request refused | fault-injection (abort) | L1 | automated | stop route returns 403 | click stop | inline reason on the card; control re-enabled; no session abort sent |
| X2 | subagent-stop-control: Stop not confirmed | fault-injection (delay) | L1 | automated | route 200 but no terminal frame (fake timers) | advance 10 s | "stop not confirmed"; control re-enabled; at 9.9 s still "stopping…" |
| X3 | subagent-stop-control: Terminal frame clears pending | race | L1 | automated | pending "stopping…" | `subagent_completed` status `completed` arrives | completed presentation; pending notice gone |
| X4 | subagent-stop-control: Parent abort wins | race | L1 | automated | stop pending | `subagent_failed`/abort terminal arrives first | renders aborted as today, never "stopped by you" |
| X5 | subagent-stop-control + live-detail: event order | race | L1 | automated | `subagent_completed{stopped}` before vs after `tool_execution_end` | reduce both orders | row stopped presentation in both orders |
| X6 | subagent-live-detail-reliability: heal / late tick / settle after stop | state-transition | L1 | automated | `ag-1` stopped | then session-end heal; then live tick; then parent settle | stays stopped after each; retained snapshot removed; resync for `ag-1` resolves to nothing |
| X7 | subagent-stop-control: emit seam refuses | fault-injection (abort) | L1 | automated | `emitEventToSession` returns false | POST valid stop | 503; card shows the reason |

---

## Coverage summary

- Requirements covered: 25/25 (8 capabilities, including REMOVED ones via E17, E20)
- Scenarios by class: edge 21 · perf 0 · frontend 9 · error 7
- Scenarios by level: L1 27 · L3 8 · ci 1 · manual 1
- Scenarios by disposition: automated 36 · manual-only 1

## New infra needed

- `qa/fixtures/faux-scenarios.ts`: add `subagent-fanout-queued` (3 `Agent` calls with `[[faux:subagent-slow-inner]]` children) for F1–F5, F8. `subagent-fanout-refused` is retired with the admission gate.
- L3 helper to write and read the producer settings file in the harness container (`docker exec`), modelled on the config writer in the deleted `subagent-fanout-admission.spec.ts`. It goes into `tests/e2e/helpers/`.
- Harness producer pinned to 0.6.0 (task 6.1).
