# Test Plan — attach-flow-before-run

Stage: design   Generated: 2026-09-28

Fixture flows: `test:capabilities`-style inline YAML strings for L1. The docker harness flow `e2e:synthetic` (`docker/fixtures/sample-git/.pi/flows/flows/e2e/synthetic/flow.yaml`, steps `alpha` → `beta`) is used for L3. Timestamps are numeric ms unless stated otherwise.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | not-started panel: topology matches a real start | decision-table (5 kinds x blockedBy/branches/on_error present) | L1 | automated | YAML where `fork` and `agent-decision` declare `blockedBy` + `on_error`, `agent` and `code` declare `branches`, `code-decision` declares `on_error` | `buildIdleFlowState` vs `reduceFlowEvent(null, <0.5.0 flow_started payload for the same flow built per flow-tui.onFlowStarted>)` | `dagSteps` deep-equal (`blockedBy`, `branches`, `onError` per kind) and `agents` keys + order equal; `deriveFlowEdges` edge lists equal |
| E2 | topology matches: parser coercions | EP | L1 | automated | `blockedBy: alpha` (scalar), branch target `2` (number), step with no `blockedBy` | build idle state | `blockedBy` is `["alpha"]`, target is `"2"`, missing `blockedBy` is `[]` |
| E3 | topology matches: routing keys the engine does not emit | EP | L1 | automated | step declaring `on_complete: beta` | build idle state | no `onComplete` on any `dagSteps` entry; edge list has no `route`/`on_complete` edge |
| E4 | definition cannot be loaded (0.5.0 parse throws) | decision-table | L1 | automated | 9 YAMLs: missing `type`; `type: shell`; missing `id`; agent without `agent`; agent-decision without `task`; fork without `question`; fork without `options`; missing flow `name`; `steps` not an array | build idle state | each returns `{ kind: "error", message }` (non-empty), no `FlowState` |
| E5 | attached flow shows graph and pending cards | EP (nominal) | L1 | automated | `e2e:synthetic` YAML, `FlowInfo{ name: "e2e:synthetic", source: "/x/.pi/flows/flows/e2e/synthetic/flow.yaml" }` | build idle state | 2 agents `alpha`,`beta` with `status: "pending"`; `beta.blockedBy == ["alpha"]`; `flowName == "e2e:synthetic"`; `flowSource == source` |
| E6 | slot priority | decision-table | L1 | automated | combos of: any `flowStates` running (y/n) x attachment (none / present) x consumed (y/n) x idle state (loading/error/ready) x live flowState (none/completed) x `flowsList` (empty / contains name / lacks name) | `resolveFlowSlot(...)` | running → `live`; attached+unconsumed+ready → `idle`; +loading → `loading`; +error → `error`; `flowsList` non-empty lacking name → `error` "no longer available"; `flowsList` empty → still `idle`; consumed+completed → `live` (summary); nothing → `none` |
| E7 | consumption boundary | BVA | L1 | automated | `baselineStartedAt` = `null`, and `1000` with a `flow_started` at 999 / 1000 / 1001; ISO-string ts `"1970-01-01T00:00:01.001Z"`; ts `NaN` | `isAttachmentConsumed` | null → false; 999 → false; 1000 → false; 1001 → true; ISO 1001 → true; NaN → false |
| E8 | attach while history is still loading (baseline resolution) | state-transition | L1 | automated | empty session stream; attach `A` | `publishSessionEvents` batch with completed run `B` (flow_started ts 500 + flow_complete); then live `flow_started C` ts 600 | after batch: stored `baselineStartedAt == 500`, mode `idle`; after C: mode `live`, attachment removed |
| E9 | Open action visible / disabled / hidden | decision-table | L1 | automated | (a) `flowsList` empty; (b) 2 flows, no running; (c) 2 flows, `flowStates` holds running `B` while latest `flowState` is completed `A` | render `SessionFlowActionsClaim` | (a) no Open button; (b) enabled; (c) disabled with `title` = running tooltip |
| E10 | picker lists all available flows | EP | L1 | automated | `flowsList` = project `test:capabilities` (source `<cwd>/.pi/flows/...`) + package flow (source `~/.pi/agent/npm/node_modules/...`) | click Open | picker options = both names with their descriptions |
| E11 | attachment persists per session / isolation / conditional clear | state-transition | L1 | automated | `setAttachment("S1", a1)`; `setAttachment("S2", b)` | fresh module read of `localStorage`; `clearAttachment("S1", "stale-id")`; `clearAttachment("S1", a1.id)` | key `dashboard:flow-attached:S1` JSON round-trips; S2 unaffected by S1 ops; stale-id clear keeps a1; matching-id clear removes it |
| E12 | flows-plugin flow_complete: rejected start | state-transition | L1 | automated | (a) running `research` with 2 running cards; (b) no flowState; (c) running `research` | (a) `flow_complete{status:"rejected", flowName:"research"}`; (b) same; (c) `flow_complete{status:"success"}` | (a) status `running`, card statuses unchanged; (b) returns null; (c) status `success` (regression) |
| E13 | session-state derivations (`lastFlowStartedAt`, `lastAutonomousMode`, `lastRejection`) | EP | L1 | automated | stream: `flow_autonomous_changed{enabled:false}` with no flowState; later `flow_started{autonomousMode:true}` ts 700; later `flow_complete{status:"rejected", flowName:"X", reason:"r"}` ts 800 | `reduceFlowsSessionState` | after first: `lastAutonomousMode false`; after second: `true`, `lastFlowStartedAt 700`; after third: `lastRejection {flowName:"X", reason:"r", timestamp:800}` and `flowState.status` still running |

### Performance

None. The spec has no latency, throughput or memory requirement. The YAML fetch is one request per attach.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | starting the attached flow updates the opened panel in place | state-transition | L1 | automated | claim showing idle `e2e:synthetic`, node `beta` selected, graph dialog open | publish `flow_started{flowName:"e2e:synthetic"}` | FlowDashboard mount counter unchanged; `beta` still selected; dialog still open; header shows Abort, no "not started" |
| F2 | a different flow starting replaces the attached flow | state-transition | L1 | automated | idle `A` with `beta` selected | publish `flow_started{flowName:"B"}` | mount counter +1; no selection; `localStorage` key removed; header shows `B` |
| F3 | live panel keeps the selected node across run progress | state-transition | L1 | automated | running flow with `beta` selected | publish 3x `flow_tool_call` for `alpha`; then switch tab to another flow | `beta` selected after each event; cleared after tab switch |
| F4 | re-attaching starts fresh | state-transition | L1 | automated | completed `A` summary with `beta` selected + graph dialog open | attach `A` again | idle panel: no selection, dialog closed |
| F5 | not-started header controls | EP | L1 | automated | idle `A`, `flowStates` also holds completed `B` | render claim | Run, Close, AUTO present; Abort absent; text "not started"; no `FlowSummary`; no tab bar |
| F6 | not-started mobile collapsed bar | EP | L1 | automated | idle `A`, `useMobile` → true, collapsed | render claim | collapsed bar text contains "not started"; after tap to expand: Run + Close present |
| F7 | autonomous toggle before the run / never observed | state-transition | L1 | automated | (a) `lastAutonomousMode false`; (b) no autonomous info | render idle; click AUTO; publish `flow_autonomous_changed{enabled:true}` | (a) pill off → click sends `flow_control{action:"toggle_autonomous"}` → pill on after event; (b) pill on |
| F8 | no earlier-run questions / pending question stays answerable | decision-table | L1 | automated | flow-question queue for flowId `A`: 1 answered + 1 cancelled (earlier run), then 1 pending | render idle `A` | answered/cancelled pills absent; pending question card present and its submit sends `prompt_response` |
| F9 | run from not-started panel / start rejected / dialog closes on start | state-transition | L1 | automated | idle `A` | click Run → submit task "t" → (a) publish `flow_complete{status:"rejected", flowName:"A", reason:"A flow is already running"}` / (b) publish `flow_started{flowName:"B"}` | `flow_management{action:"run", flowName:"A", task:"t"}` sent once; Run disabled after submit; (a) Run enabled + reason text visible, panel still idle; (b) dialog unmounted, panel live `B` |
| F10 | tabs of the same browser stay in sync | state-transition | L1 | automated | claim for session S, no attachment | dispatch `StorageEvent{key:"dashboard:flow-attached:S", newValue:<json A>}`; then `newValue:null` | idle `A` rendered; then slot renders nothing |
| F11 | detach restores summary / nothing | state-transition | L1 | automated | (a) idle `A` over undismissed completed `B`; (b) idle `A`, no other flow | click Close | (a) `B` summary rendered; (b) claim renders null; key removed in both |
| F12 | attachment survives reload | state-transition | L1 | automated | `localStorage` pre-seeded with attachment `A` for S (baseline 0), stream with no newer `flow_started` | mount claim | idle `A` rendered after fetch resolves |
| F13 | replay reveals a flow that is still running | state-transition | L1 | automated | attach `A` on empty stream | `publishSessionEvents` batch with `flow_started B` (no complete) | mode `live` `B`; attachment removed |
| F14 | other flow finished while the page was closed | state-transition | L1 | automated | stored attachment `A` baseline 1000 | mount with replay batch: `flow_started B` ts 2000 + `flow_complete B success` | `B` summary rendered; key removed |
| F15 | attach → idle → Run → same panel live (rendered, real engine) | state-transition + convergence | L3 | automated | docker harness session, `e2e:synthetic` | subcard Open flow… → pick `e2e:synthetic` → idle header Run → submit | before Run: flow panel shows "not started" + 2 graph nodes + 2 pending cards; after Run: exactly one flow panel element, "not started" gone, both cards reach complete, then summary |
| F16 | Open disabled while a flow runs (rendered) | state-transition | L3 | automated | docker harness session | start `e2e:synthetic` via subcard Run Flow… | while running, Open flow… button has `disabled` attribute; enabled again after completion |
| F17 | not-started panel reads as stale/empty | visual/subjective | — | manual-only | idle `e2e:synthetic` panel on desktop + mobile | a person looks | [judgment: panel is clearly "not started" and empty, not mistaken for a stuck run] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | definition cannot be loaded (fetch refused) | fault-injection (abort) | L1 | automated | `fetch` resolves 403 `{success:false, error:"path not in allowed resource location"}` / 404 | attach | error header with flow name + message + Close; no graph, no cards |
| X2 | definition loading | fault-injection (delay) | L1 | automated | `fetch` promise held pending | attach; then resolve with valid YAML | while pending: name + "loading…" + Close; after resolve: idle panel |
| X3 | definition cannot be loaded (network) | fault-injection (abort) | L1 | automated | `fetch` rejects `TypeError` | attach | error header rendered, no uncaught rejection |
| X4 | definition cannot be loaded (no source) | EP | L1 | automated | `FlowInfo.source` = `""` / undefined | attach | error header; `fetch` not called |
| X5 | storage unavailable | fault-injection (abort) | L1 | automated | `localStorage.getItem/setItem/removeItem` throw | attach, render, Close | no throw; idle rendered in-memory; Close works |
| X6 | attached flow no longer available | state-transition | L1 | automated | idle `A`, `flowsList` updated to `[B]` | re-render | error header "no longer available" + Close |
| X7 | loader unmount safety | fault-injection (delay) | L1 | automated | pending `fetch` | unmount claim, then resolve | no state update after unmount (no React warning); no attachment change |

---

## Coverage summary

- Requirements covered: 8/8 (7 `flow-pre-run-attach` + 1 modified `flows-plugin`)
- Scenarios by class: edge 13 · perf 0 · frontend 17 · error 7
- Scenarios by level: L1 34 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 36 · manual-only 1

## New infra needed

- A `FlowDashboard` / `FlowDashboardClaim` render harness for L1. No flows-plugin test renders `FlowDashboard` today. Build it from the `FlowSummary.test.tsx` primitive-registry setup plus the `FlowsSessionStateContext.test.tsx` `publishSessionEvent` pattern. It needs a mount counter to assert instance continuity (F1/F2).
- L3 uses the existing docker harness + `e2e:synthetic`. There's only one fixture flow, so the "different flow replaces" path stays L1-only (F2/F13/F14).
