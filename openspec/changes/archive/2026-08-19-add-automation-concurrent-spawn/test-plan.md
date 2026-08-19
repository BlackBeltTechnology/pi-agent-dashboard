# Test Plan — add-automation-concurrent-spawn

Stage: design   Generated: 2025-08-10

All four clarification gaps (parent aggregate with no `done`/no `error`,
truncation order, `maxConcurrentSpawns` range, concurrency threshold) were
resolved at the gate and written into the specs. No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | fanout: mutual exclusion | decision-table | L1 | automated | config with both `action:` and `actions:` | schema parse | parse fails; error names the `action`/`actions` conflict |
| E2 | fanout: two distinct actions | decision-table | L1 | automated | `actions:` = [`flows.run` flow A, `core.skill` skill B] | schema parse + `resolveChildren` | 2 ChildSpecs, entry 1 dispatches flow A, entry 2 dispatches skill B |
| E3 | fanout: empty list invalid | EP | L1 | automated | `actions: []` | schema parse | parse fails with a validation error |
| E4 | fanout: unregistered entry kind | EP | L1 | automated | `actions:` = [valid, `{kind: bogus}`] | schema parse | parse fails; error names entry index `1` |
| E5 | fanout: invalid config isolated | EP | L1 | automated | scope with one invalid + one valid automation file | scan/list | invalid one reported invalid; the valid one still loads and is schedulable |
| E6 | fanout: `count` BVA | BVA | L1 | automated | `count` ∈ {0, -1, 1.5, "2"} then {1, 3} | schema parse | 0/-1/1.5/"2" fail validation; 1 → 1 child; 3 → 3 children |
| E7 | fanout: `count` default | BVA | L1 | automated | entry with no `count` | `resolveChildren` | exactly 1 child for that entry |
| E8 | fanout: `count` on single `action:` | BVA | L1 | automated | single `action:` + `count: 3` | `resolveChildren` | 3 children of that action |
| E9 | fanout: legacy single action | EP | L1 | automated | single `action:`, no `count` | `resolveChildren` | exactly 1 child, dispatch identical to pre-fan-out |
| E10 | fanout: bound BVA | BVA | L1 | automated | resolved 10 children, effective bound 4 | `resolveChildren(automation, 4)` | 4 specs returned, `truncated: 6` |
| E11 | fanout: truncation order | BVA | L1 | automated | `actions:` = [A `count:3`, B `count:3`], bound 4 | `resolveChildren` | surviving specs are A#0, A#1, A#2, B#0 in that order |
| E12 | fanout: under bound, no warning | BVA | L1 | automated | 2 resolved children, bound 4 | `resolveChildren` | `truncated: 0`; parent record has no `warning` |
| E13 | fanout: per-automation bound override | BVA | L1 | automated | settings default 4, automation declares 2 | effective-bound resolution | at most 2 children |
| E14 | fanout: invalid bound rejected | BVA | L1 | automated | `maxConcurrentSpawns` ∈ {0, -1, 2.5} | schema parse | each fails validation |
| E15 | fanout: truncation warning text | BVA | L1 | automated | 10 resolved, bound 4 | fire | parent record `warning` names bound `4` and `6` not spawned |
| E16 | lifecycle: parent + child records | state-transition | L1 | automated | fire resolving 3 children | `startRunFor` | one parent `run.json` with `children` of length 3; 3 child records each with own `status`, `sessionId`, `startedAt`, action label |
| E17 | lifecycle: aggregate all done | decision-table | L1 | automated | 3 children finalize `done` with findings 2, 0, 5 | last child finalizes | parent `done`, findings `7` |
| E18 | lifecycle: aggregate any error | decision-table | L1 | automated | children finalize `done`, `error`, `done` | last child finalizes | parent `error` |
| E19 | lifecycle: aggregate all stopped | decision-table | L1 | automated | every child stopped, none errored | last child finalizes | parent `stopped` |
| E20 | lifecycle: aggregate mixed stopped/done | decision-table | L1 | automated | children finalize `stopped`, `done`, none errored | last child finalizes | parent `done` |
| E21 | lifecycle: parent stays running | state-transition | L1 | automated | 3 children, 2 finalized | read parent | parent `running` |
| E22 | lifecycle: child addressable by own id | EP | L1 | automated | nested child record | `resolveRunDir(scopeBase, childRunId)` | resolves the child dir without the parent id; `finishRun(childRunId)` writes that child's `result.md` and status |
| E23 | lifecycle: legacy flat record readable | EP | L1 | automated | pre-existing flat `runs/<runId>/run.json` | `listRuns` / `resolveRunDir` | record still listed and resolvable; treated as a flat run, not a parent |
| E24 | routes: `actions:` entry validated on write | decision-table | L1 | automated | POST create/update with `actions:` = [valid, `{kind: bogus}`] | `/create`, `/update` | rejected naming entry index `1`; nothing persisted that `/list` would later mark invalid |
| E25 | routes: prompt normalization without `action:` | EP | L1 | automated | `actions:`-only config | `/create` | succeeds; no throw from the `config.action.kind` branch |
| E26 | writer: round-trip `actions:` | EP | L1 | automated | config with 2 entries + per-entry `count` | write then re-parse | YAML round-trips to an equal config |
| E27 | config schema accepts the new default | EP | L1 | automated | plugin config with `maxConcurrentSpawns` default | configSchema validation (`additionalProperties: false`) | accepted, not rejected as an unknown property |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | lifecycle: parent discloses children | state-transition | L1 | automated | parent run with 3 children | render `AutomationBoard` / `AutomationRunMonitor` | one parent row with aggregate status + findings; expanding yields 3 child rows, each with action label, status, findings, session link |
| F2 | fanout: truncation warning surfaced | state-transition | L1 | automated | parent record carrying `warning` | render parent row | warning text visible on the parent row |
| F3 | lifecycle: visibility per occurrence | decision-table | L1 | automated | effective visibility `hidden` for a fire | render board | neither the parent nor any child appears |
| F4 | dialog: multi-action editor | state-transition | L1 | automated | dialog with 2 action entries + `count` on entry 2 | add entry, set count, submit | submitted config carries `actions:` with 2 entries; a single entry submits `action:` instead |
| M1 | fanout + lifecycle, end to end on a real host | exploratory | — | manual-only | real automation, `actions:` = [flow A, skill B, `count: 2` flow C] | let the schedule fire once on a live dashboard, then stop the parent | [judgment: 4 real concurrent sessions behave sanely under real host load — resource pressure and "feels right" have no automatable observable] |
| F5 | lifecycle: parent + children on the live board | state-transition | L3 | automated | automation with `actions:` = [flow A, skill B] against the docker harness | trigger the automation from the UI | board converges to one parent entry that expands to 2 child rows with distinct action labels and live per-child status; each child row links to a real session |
| F6 | lifecycle: stop parent from the UI | state-transition | L3 | automated | live parent with 2 running children | click stop on the parent row | board converges to parent terminal and both child rows terminal; no child session remains running |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | lifecycle: sibling isolation on spawn failure | fault-injection (abort) | L1 | automated | child 2 of 3 spawn returns `success: false` | fire | child 2 finalized `error` with the spawn reason; children 1 and 3 still `running` and finalize on their own signals |
| X2 | lifecycle: per-child result isolation | fault-injection | L1 | automated | 3 children each producing distinct assistant text | all finalize | 3 distinct `result.md` files under the parent dir; no child's output overwrites another's |
| X3 | lifecycle: child session death | state-transition | L1 | automated | child session ends with no terminal event | `onSessionDeath` for that child | only that child finalizes (buffered output → `done`, else `error`); siblings unchanged |
| X4 | lifecycle: parent finalization idempotent | state-transition | L1 | automated | parent already finalized | a further child termination signal arrives | parent record byte-unchanged; no second finalization |
| X5 | lifecycle: fire slot released only by the parent | state-transition | L1 | automated | `concurrency: queue`, first child finalizes while siblings run | queued next fire evaluated | queued fire does NOT start; it starts only after the last child is terminal |
| X6 | lifecycle: children spawn regardless of policy | state-transition | L1 | automated | `concurrency: skip`, 4 resolved children | one fire | all 4 spawns initiated before any child has finalized |
| X7 | lifecycle: overlapping fire dropped | state-transition | L1 | automated | `concurrency: skip`, parent still running | second fire | second fire dropped; no additional children spawned |
| X8 | lifecycle: stop cascades | fault-injection (abort) | L1 | automated | parent with 3 running children | `stopRun(parentRunId)` | all 3 child sessions aborted; each child finalized stopped; parent finalized once |
| X9 | lifecycle: single-child stop | fault-injection (abort) | L1 | automated | parent with 3 running children | `stopRun(childRunId)` of child 2 | child 2 terminated and finalized; children 1 and 3 still running; parent still `running` |
| X10 | lifecycle: stop inside the spawn window | fault-injection (delay) | L1 | automated | child whose `spawnSession` has not yet resolved (no sessionId, no token) | `stopRun(parentRunId)` during that window | the child is aborted on token arrival (abort issued with the returned `spawnToken`); the child does not survive to run |
| X11 | lifecycle: stop racing session-end | fault-injection | L1 | automated | stop issued concurrently with a child's own session-end | both signals delivered | each child finalized exactly once; parent finalized exactly once |
| X12 | lifecycle: stale child reaped, sibling untouched | fault-injection (delay) | L1 | automated | child A exceeds `maxRunAgeMs`, child B still running | reaper sweep | only child A finalized; parent stays `running` until B terminates |
| X13 | lifecycle: reaper never orphan-finalizes a live parent | fault-injection (delay) | L1 | automated | aged parent record not present in the engine `pending` map, children live | reaper sweep | parent NOT force-finalized `error`; it finalizes only via the child counter |
| X14 | lifecycle: retention spares a live occurrence | fault-injection | L1 | automated | running occurrence with >100 newer runs present | `pruneRuns` | the running parent and its children are retained; no resurrected half-deleted dir |
| X15 | lifecycle: stale sweep finds nested children | fault-injection (delay) | L1 | automated | aged child record nested under a parent | `listStaleRunningRuns` | the nested child is returned by the sweep |

---

## Coverage summary

- Requirements covered: 11/11 (fanout 4, lifecycle 6, plus the validation-surface decision)
- Scenarios by class: edge 27 · perf 0 · frontend 7 · error 15
- Scenarios by level: L1 46 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 48 · manual-only 1

No performance row: the gate resolved G4 as "assert concurrency structurally,
no wall-clock threshold" — X6 carries that observable (all spawns initiated
before any finalization) instead.

No L2 row: nothing here is install/multi-OS/process-runtime shaped; the fan-out
surface is in-process logic (L1) plus rendered board behaviour (L3).

## New infra needed

None. L1 extends existing suites (`automation-schema.test.ts`, `run-store.test.ts`,
`engine.test.ts`, `runner.test.ts`, `routes-stop.test.ts`,
`routes-create-action-kind.test.ts`, `automation-writer.test.ts`,
`AutomationBoard.test.tsx`, `AutomationRunMonitor.test.tsx`,
`CreateAutomationDialog.wiring.test.tsx`); L3 adds specs to the existing docker
harness under `tests/e2e/`.
