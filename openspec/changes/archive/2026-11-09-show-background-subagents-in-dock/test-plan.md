# Test Plan — show-background-subagents-in-dock

Stage: design   Generated: 2026-11-07

Gaps resolved before writing (hard gate): session end while a background subagent runs → the server's synthesized `subagent_failed` (`healedBy: "session_ended"`) ends it (spec scenario + design D6); a malformed retry entry → `Retry` plus its valid parts (new requirement in `subagent-live-timeline`). The L3 harness moves to producer 0.7.0 and gets background faux scenarios (user decision).

L1 = vitest + RTL in `packages/subagents-plugin/src/client/__tests__/`. L3 = Playwright against the docker harness (`dashboardPort` from `.pi-test-harness.json`, never `:18000`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | background-subagent-display: state records a background run | decision-table | L1 | automated | frame sets for agent A: (a) `created{background:true}` then `started`, step, terminal without the field; (b) `started{background:true}` only; (c) no frame with the field | reduce the frames through `sessionEventReducer` | (a) A is marked after every frame, including the terminal write; (b) A is marked; (c) A has no `background` key |
| E2 | background-subagent-display: started card; agent-tool-rendering: background precedence | decision-table | L1 | automated | details `{ background: true, id: "bg-7a3f" }` × tool status `running`/`complete` × `details.status` `running`/`completed`/`error`/`aborted`/`stopped`/absent | render `AgentToolRenderer` | all 12 combinations show "Started in background" and `bg-7a3f`; none shows a spinner, elapsed badge, `agent-activity-row`, stop line, Details or Popout |
| E3 | background-subagent-display: foreground card unchanged | equivalence partition | L1 | automated | details `{ status: "running", agentId: "ag-1" }` without `background` | render `AgentToolRenderer` | renders the running card as today (elapsed badge and activity row present, no "Started in background") |
| E4 | background-subagent-display: own group, noun by count | BVA | L1 | automated | live map with 0, 1, 2 subagents of each kind | render both groups in `"summary"` mode | 0 → reports `null`; 1 → `{count:1, noun:"subagent"}` / `{count:1, noun:"background subagent"}`; 2 → `subagents` / `background subagents` |
| E5 | background-subagent-display: exactly one group | equivalence partition | L1 | automated | map: fg `running`, bg `running`, bg `created`, bg `completed`, fg `failed` | render both groups in `"rows"` mode | fg group lists 1 row; bg group lists 2 rows (the `created` one reads `pending`); no id appears in both; terminal ones in neither |
| E6 | subagent-stop-control + composer-dock: Stop only when stoppable | decision-table | L1 | automated | dock row status `created`/`running`/`completed`/`failed`/`stopped` × `stoppable` `true`/`false`/absent | render the row | a Stop button only for (`created` or `running`) and `stoppable: true` (2 of 15 cells); every other cell has Open only |
| E7 | composer-dock: Stop wording | decision-table | L1 | automated | docs-writer: `running` with no queue position; `running` + `queuePosition: 2`; `running` + `queuePosition: 0`; `created` | render the row | visible text is `Stop` in all four; accessible name `Stop subagent docs-writer`, `Remove subagent docs-writer from queue`, `Stop subagent docs-writer`, `Remove subagent docs-writer from queue` |
| E8 | subagent-live-timeline: delay format | BVA | L1 | automated | retry entries with `delayMs` −5, `NaN`, 0, 400, 4500, 60000, 150000, 3600000, 3660000 | render `SubagentDetailView` | delays read `0s`, `0s`, `0s`, `1s`, `5s`, `1m`, `2m 30s`, `1h`, `1h 1m`; each equals the producer's `formatRetryDelay` output for the same input (fixture copied from `extensions/events.ts:277-286`) |
| E9 | subagent-live-timeline: malformed retry entry | decision-table | L1 | automated | `{delayMs:4000}`; `{attempt:2,maxAttempts:18,text:""}`; `{attempt:0,maxAttempts:18,delayMs:4000,text:"x"}`; `{attempt:"1",maxAttempts:18,text:"503"}`; `{}` | render `SubagentDetailView` | `Retry in 4s`; `Retry 2/18`; `Retry in 4s: x`; `Retry: 503`; `Retry`; never "(unknown entry)" |
| E10 | subagent-live-timeline: streamed position, kept on recovery | state-transition | L1 | automated | entries `[tool A, retry 1/18 4s "503", tool B]`, then the subagent completes | render `SubagentDetailView` before and after completion | the error step `Retry 1/18 in 4s: 503` sits between tool A and tool B in both renders |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | subagent-stop-control: one stop state per subagent | state-convergence | L1 | automated | foreground C094 `running`, `stoppable: true`; card, chat row stop and dock row mounted | click Stop on the dock row, then the chat row stop | `requestSubagentStop(sessionId, "C094")` called once; card shows "stopping…"; the session abort is never called |
| F2 | subagent-stop-control: dock stop feedback | state-transition + BVA (fake timers) | L1 | automated | docs-writer `running`, `stoppable: true` | (a) click Stop, then a `stopped` frame; (b) click Stop, request refused; (c) click Stop, request ok, no frame, advance 9 999 ms then 1 ms | (a) `Stopping…` + disabled, then the row is gone; (b) `Stop failed`, Stop enabled, no abort; (c) `Stopping…` at 9 999 ms, `Still running` + Stop enabled at 10 000 ms |
| F3 | subagent-stop-control: background feedback only on the dock | state-convergence | L1 | automated | bg docs-writer `running`, stop entry `pending` in the store; its started card mounted | render the card and the dock row | dock row reads `Stopping…`; the card shows no stop text and no change |
| F4 | design D4: summary-mode terminal clear | state-transition | L1 | automated | stop entries for fg C094 and bg docs-writer; both groups mounted in `"summary"` mode | (a) docs-writer's map status → `stopped`; (b) unmount `"rows"` mode with both still `running` | (a) docs-writer's entry cleared by the background group only; C094's entry kept; (b) no entry cleared |
| F5 | background-subagent-display: card never changes | state-transition | L1 | automated | started card for `bg-7a3f`; the session map holds its subagent | map status `running` → `completed`, `failed`, `stopped` in turn | card markup stays identical to the first render |
| F6 | background-subagent-display: started card + own group (real producer 0.7.0) | end-to-end flow | L3 | automated | faux `subagent-background`: one `Agent` with `run_in_background: true` running `subagent-slow-inner` (~6 s) | send the prompt | chat card shows "Started in background" and a `bg-` id with no spinner; Processes header names `1 background subagent`; the row has Stop and Open and no step text; after the child ends the row leaves and the card is unchanged |
| F7 | composer-dock: two groups from one plugin | end-to-end flow | L3 | automated | faux `subagent-background-mixed`: one foreground and one background `Agent` in one message, both `subagent-slow-inner` | send the prompt, wait for both rows | header reads `2 running` with `1 subagent · 1 background subagent`; body shows the `Subagent` heading before `Background subagent`, one row under each |
| F8 | background-subagent-display: Open watches the run | end-to-end flow | L3 | automated | F6 running | click Open on the background row | the full-screen subagent view opens and shows a `tick-one` tool step while the child still runs |
| F9 | background-subagent-display: mark survives reload | state-convergence | L3 | automated | F6 running | reload the page mid-run | after reload the row is under the background group (header `1 background subagent`) and the card still shows the started state |
| F10 | adopted mockups | visual/subjective | — | manual-only | started card and both dock groups, light and dark | human compares against `mockups/2026-11-06-background-subagent-chat` and `-subagent-retry-plugin-only` | [judgment: matches the accepted mocks — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | subagent-stop-control: stop a background subagent from the dock | fault-injection (abort via stop) | L3 | automated | F6 running; `OperatorSession` armed | click Stop on the background row | row reads `Stopping…`, then leaves; no session abort request is sent; the full-screen view shows the neutral stopped state; the card still shows the started state |
| X2 | background-subagent-display: session ends while a background run is live | fault-injection (abort: parent ends) | L1 | automated | bg docs-writer `running`, no terminal frame | reduce a synthesized `subagent_failed{id, error:"parent session ended", healedBy:"session_ended"}` | docs-writer keeps its background mark and is `failed` with that error; the bg group reports `null`; the started card is unchanged |
| X3 | background-subagent-display: session end in the real stack | fault-injection (abort: parent ends) | L3 | automated | F6 running | end the session the way `session-ended-orphan-heal.spec.ts` does | the background row leaves the lane; the full-screen view shows "parent session ended" |
| X4 | subagent-stop-control: producer without per-subagent stop | equivalence partition | L1 | automated | live subagent without `stoppable` (producer < 0.6.0 shape) | render the dock row and click everything on it | no Stop button; Open is the only action; neither `requestSubagentStop` nor the session abort is called |

---

## Coverage summary

- Requirements covered: 13/13 (background-subagent-display 4, composer-dock 2, subagent-stop-control 4, subagent-live-timeline 3); agent-tool-rendering's modified requirements are covered through E2/E3
- Scenarios by class: edge 10 · perf 0 · frontend 10 · error 4
- Scenarios by level: L1 16 · L2 0 · L3 7
- Scenarios by disposition: automated 23 · manual-only 1

No performance scenario: the specs set no latency or load threshold, and the change adds no polling or stream.

## New infra needed

- `docker/Dockerfile`: `PI_DASHBOARD_SUBAGENTS_VERSION` 0.6.0 → 0.7.0. Every existing subagent L3 spec then runs against 0.7.0 and must stay green.
- `qa/fixtures/faux-scenarios.ts`: `subagent-background` and `subagent-background-mixed` scenarios.
- Retry steps are not driven at L3: faking a retryable provider error inside the child is out of scope, so E8–E10 cover them at L1.
