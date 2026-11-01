# Test Plan — flows-dock-chip-and-panel-actions

Stage: design   Generated: 2026-10-31

Hard gate passed: the open numbers (300 ms publish debounce, 2 s catalog-ask limit, 5 s × 60 s server-start re-ask) were answered and written into `flows-catalog` and design D3.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | flows-catalog: only answered probes | decision-table | L1 | automated | probe with no listener (`probe.flows` unset) | publisher trigger fires | no `dashboard-flows:catalog` emit; previous catalog stays latest |
| E2 | flows-catalog: only answered probes | decision-table | L1 | automated | listener answers `[]` after catalog `[old-flow]` | `flow:rediscover` | one emit with `flows: []` |
| E3 | flows-catalog: only answered probes | decision-table | L1 | automated | listener answers `[batch:apply, ship-it]` | `session_start` | one emit; payload has `catalogKey: "catalog"` and both entries with name, description, source, taskRequired |
| E4 | flows-catalog: publish triggers (300 ms) | BVA | L1 | automated | fake timers; triggers at t=0 and t=299 ms | debounce elapses | exactly 1 emit at t=599 ms |
| E5 | flows-catalog: publish triggers (300 ms) | BVA | L1 | automated | fake timers; triggers at t=0 and t=301 ms | debounce elapses | exactly 2 emits |
| E6 | flows-catalog: publish triggers | EP | L1 | automated | each of `session_start`, `flow:rediscover`, `flow:complete`, `flow:register-flows-dir`, `flow:unregister-agents-dir`, `dashboard-flows:report-files`, attach | fire one | one emit per trigger class |
| E7 | flows-catalog: forward declaration | state-transition | L1 | automated | publisher started | `dashboard:bridge-ready` emitted twice | declaration `{pluginId:"flows", channels:{"dashboard-flows:catalog":{as:"flow_catalog",delivery:"latest",key:"catalogKey"}}}` emitted 3 times (start + 2) |
| E8 | flows-catalog: survives replay | state-transition | L1 | automated | event list `[flow_catalog A, flow_started, flow_catalog B]` | reducer folds | catalog = B; no `flow_catalog` entry in chat-renderable output |
| E9 | flows-catalog: plugin server sees catalog | EP | L1 | automated | `onEvent` `flow_catalog [batch:apply]` for session S in `/p` | `flowsForCwd("/p")` | `["batch:apply"]`; after S ends → `[]` |
| E10 | flows-catalog: 2 s ask limit | BVA | L1 | automated | fake clock; two `flow.request-catalog` for S at t=0 and t=1999 ms | handler runs | `emitEventToSession` called once |
| E11 | flows-catalog: 2 s ask limit | BVA | L1 | automated | same, second at t=2001 ms | handler runs | called twice; a files ask at t=500 ms does not block the catalog ask |
| E12 | flows-catalog: client re-ask | BVA | L1 | automated | catalog unknown, fake timers | 60 s elapse | 12 `flow.request-catalog` sends at 5 s spacing, none after the 12th |
| E13 | flows-catalog: client re-ask | state-transition | L1 | automated | catalog unknown, 3 asks sent | catalog event arrives | no further asks |
| E14 | flows-catalog: sibling follow | decision-table | L1 | automated | sessions A, B in `/p`; A's catalog changes from `[x]` to `[x,y]` | server receives it | one rediscover-and-report ask to B, none to A |
| E15 | flows-catalog: no ask loop | decision-table | L1 | automated | B publishes catalog equal to its previous | server receives it | zero sibling asks |
| E16 | flows-catalog: server start (5 s × 60 s) | BVA | L1 | automated | 2 live sessions, one never reports; fake clock | 65 s elapse | silent session asked at t=0,5,…,60 s (13 asks), none after 60 s; reporting session asked once |
| E17 | flows-catalog: core carries no flow list | EP | L1 | automated | repo source | grep `flows_list|FlowInfo|request_flows_refresh|flowsList` in `*.ts`/`*.tsx` under `packages/*/src` except `packages/flows-plugin` | zero matches |
| E18 | flows-plugin: menu gate | decision-table | L1 | automated | catalog {unknown, empty, [x]} × edit mode {unknown, off, on} | render menu claim | only (empty,on) → [New flow…]; only (empty,off) → ["Turn on edit mode for this project"]; all other 7 → nothing |
| E19 | flows-plugin: chip gate | decision-table | L1 | automated | catalog {unknown, empty, [x]} × commandsList {absent, has `flows`} | render chip | chip only when catalog = [x], regardless of commandsList |
| E20 | flows-dock-chip: actions disabled while running | decision-table | L1 | automated | catalog [x]; flow running {no, yes} | render chip | running → Run and Open `disabled` with title "A flow is running", Edit enabled; not running → all enabled |
| E21 | flows-dock-chip: status pill | EP | L1 | automated | flowState status running 7/19, failed 19 steps, success, aborted, attached-not-started, none | render chip | pill text "running 7/19", "failed · 19 steps", done, aborted, not started; none → no name or pill |
| E22 | flows-dock-chip: pencil popover | decision-table | L1 | automated | edit mode {unknown, off, on} × `flows:delete` {absent, present} | open popover | unknown → loading line only; off → only "Turn on edit mode for this project"; on → Edit…, New flow…, Delete… (only with `flows:delete`), "Turn off edit mode for this project" |
| E23 | flow-summary-view: header actions | decision-table | L1 | automated | completed flow F; catalog {has F, lacks F, empty}; running {no, yes} | render summary header | lacks F → no Run again; empty → no Run again, no Open; running → visible actions disabled "A flow is running"; hidden wins over disabled |
| E24 | flow-controls: live header | EP | L1 | automated | running flow | render live header | Open flow… disabled "A flow is running", Edit… enabled, Abort present |
| E25 | flow-panel-collapse: default collapsed | state-transition | L1 | automated | no stored key for S | flow starts, completes, fails | both panel kinds render header-only (`aria-expanded="false"`), graph and cards absent |
| E26 | flow-panel-collapse: user choice kept | state-transition | L1 | automated | user expanded S (stored `false`) | new `flow_started` | panel stays expanded; storage unchanged |
| E27 | flow-panel-collapse: Open expands | state-transition | L1 | automated | S collapsed | Open flow… picks `ship-it` | stored collapse = expanded; panel shows `ship-it` idle with body visible |
| E28 | command-routing: typed flow command | EP | L1 | automated | pi-flows registered command `batch:apply`; agent idle, then streaming | `send_prompt "/batch:apply task"` | dispatched via extension command path with the step-9 `deliverAs`; no `flow:run` emitted by the bridge; no `flow:list-flows` probe |
| E30 | flows-catalog: timing settings | BVA | L1 | automated | save attempts = 0, 1, 60, 61 | settings save | 0 and 61 rejected with "1–60" message and stored value unchanged; 1 and 60 accepted |
| E31 | flows-catalog: timing settings | BVA | L1 | automated | save ask limit = 0.4 s, 0.5 s, 60 s, 61 s | settings save | 0.4 and 61 rejected naming "0.5–60 s"; 0.5 and 60 accepted |
| E32 | flows-catalog: timing settings | EP | L1 | automated | no timing values stored | server and client read config | ask limit 2 s, re-ask 5 s × 12, server-start 5 s × 60 s |
| E33 | flows-catalog: timing settings | state-transition | L1 | automated | ask limit 2 s; asks for S at t=0 | save 10 s, then ask at t=5 s | second ask dropped (no restart in between) |
| E29 | flow-list-protocol removal | EP | L1 | automated | old bridge sends `{type:"flows_list", sessionId, flows:[…]}` | server handles message | no throw, no browser message, no `request_flows_refresh` sent |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | flows-catalog: late subscribe | state-convergence | L3 | automated | harness session with project flow `test:capabilities`, catalog already published | open the dashboard on that session after the catalog event | FLOWS chip visible with Run/Open/Edit, without a new catalog publish from the session |
| F2 | flows-catalog: reload | state-convergence | L3 | automated | session viewed, chip visible | browser reload | chip reappears after replay, listing the same flows in the Open picker |
| F3 | flows-dock-chip: visibility | state-transition | L3 | automated | flowless harness project with edit mode on | open session, open card menu | no FLOWS chip in dock; card menu PLUGINS group holds only "New flow…" |
| F4 | flows-plugin: session with flows | state-transition | L3 | automated | project with flows | open card menu | PLUGINS group has no flows item; chip present |
| F5 | flows-dock-chip: Open from chip | state-transition | L3 | automated | chip visible, no flow running | click Open, pick `test:capabilities` | flow panel shows `test:capabilities` not started, expanded |
| F6 | flow-panel-collapse: failed flow stays collapsed | state-transition | L3 | automated | no stored collapse; faux flow that fails | run it from the chip | panel shows only header with failed status; graph/cards hidden; chip pill "failed" |
| F7 | flow-panel-collapse: reselect keeps collapsed | state-transition | L3 | automated | user collapsed the panel | click the session card in the sidebar again; navigate away and back | panel stays collapsed both times |
| F8 | flows-dock-chip: keyboard popover | state-transition | L3 | automated | chip visible | Tab to pencil, Enter, ArrowDown, Escape | focus enters popover, moves between items, Escape closes and focus returns to the pencil |
| F9 | flows-catalog: picker refresh | state-convergence | L3 | automated | session with flows `a`, `b`; `b`'s directory removed from disk | open Run picker | picker converges to list only `a` |
| F10 | flow-plugin-e2e: harness launch | state-transition | L3 | automated | faux-model harness | Run from the chip | FlowAgentCard visible and flow reaches completed (header-only panel; expand to see cards) |
| F11 | flows-dock-chip: compact dock | state-transition | L3 | automated | viewport 400 px wide, session with flows | open session | FLOWS chip reachable in the compact dock and its Run/Open/Edit controls are operable |
| F12 | flows-dock-chip: visual fit | visual/subjective | — | manual-only | dock with QUOTA + FLOWS chips, all four themes | human looks | [judgment: chip spacing, pill legibility and icon alignment look consistent with the dock — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | flows-catalog: server restart | fault-injection (abort) | L3 | automated | restart the harness dashboard server while the session keeps running | reopen the session in the browser | chip becomes visible within 15 s (client ask) |
| X2 | flows-catalog: server restart, no browser | fault-injection (abort) | L1 | automated | plugin server restarted with live session S that has not reported | 5 s re-ask until S reports | `flowsForCwd` returns S's flows after the report; no browser involved |
| X3 | flows-catalog: ask during reconnect | fault-injection (delay) | L1 | automated | first `emitEventToSession` returns `false` (bridge reconnecting) | client re-ask at 5 s | second ask delivered; catalog becomes known |
| X4 | flows-catalog: pi-flows not loaded | fault-injection (abort) | L1 | automated | probe listener absent at attach, present at later `session_start` | both triggers | only the second publishes; nothing empty published at attach |
| X5 | flows-catalog: buffer eviction | fault-injection (abort) | L1 | automated | catalog dropped from the `latest` buffer while not forwardable | client views session (catalog unknown) | ask → bridge republishes → catalog known |
| X6 | flows-edit-mode-settings: session unreachable | fault-injection (abort) | L1 | automated | `flow.set-edit-mode` cannot be delivered | user picks the edit-mode item in the popover | error notification shown; item keeps the unchanged label |
| X7 | flows-catalog: plugin disabled | fault-injection (abort) | L1 | automated | flows plugin disabled | `flow_catalog` events arrive | no crash; no chat row; no chip |

---

## Coverage summary

- Requirements covered: 31/31 delta requirements, plus the removed `flow-list-protocol` / `flow-trigger` / `flow-card-launcher` / `session-listing` behaviour (E17, E29)
- Scenarios by class: edge 33 · perf 0 · frontend 12 · error 7
- Scenarios by level: L1 37 · L2 0 · L3 14 · manual 1
- Scenarios by disposition: automated 51 · manual-only 1

## New infra needed

- none (L3 uses the existing docker harness and faux-model flow fixture from `flow-attach-before-run.spec.ts` / `flow-plugin-e2e`)
