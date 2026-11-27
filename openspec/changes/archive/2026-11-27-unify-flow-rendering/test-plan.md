# Test Plan — unify-flow-rendering

Stage: design   Generated: 2026-11-26

All Triple slots resolved from the specs and design; no clarifications needed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | flow-authoring-renderers: Card tolerates YAML the strict parser would reject | EP (invalid class accepted leniently) | L1 | automated | `flow_write` result `{written:true, command:"custom:t"}`; args YAML with no `description`, steps `a` (no `type`), `b` (`type: code`) | render `FlowWriteToolRenderer` | `data-node="a"` and `data-node="b"` rendered; text "2 steps · 1 agents, 1 code" |
| E2 | flow-authoring-renderers: Invalid steps are skipped | BVA (1 invalid of 3) | L1 | automated | YAML steps `[ {id:a,type:agent,agent:x}, {type:code}, {id:c,type:code} ]` | render card | 2 nodes (`a`, `c`); text "2 steps" |
| E3 | flow-authoring-renderers: Unbuildable args degrade gracefully | BVA (zero steps) | L1 | automated | YAML `name: t\nsteps: []`, written:true | render card | no `data-node` elements, no "steps ·" counts text; "/custom:t" and "registered" shown |
| E4 | flow-authoring-renderers: Unbuildable args degrade gracefully | EP (not YAML) | L1 | automated | args `content: "::: not yaml ["`, written:true | render card | no graph, no counts, no thrown error; success state + command shown |
| E5 | flow-authoring-renderers: Only a successful write draws a graph | decision table (written × buildable) | L1 | automated | valid 2-step YAML; result `{written:false, diagnostics:["bad"]}` | render card | no `data-node`; "not written — validation failed" and "bad" shown |
| E6 | flows-plugin: Static YAML preview keeps object-form branches | EP (object form) | L1 | automated | YAML decision `gate` with `branches: { fix: { to: fix, means: "bug" } }` and step `fix` | `buildIdleFlowState(yaml)` (strict) and card render | `dagSteps` gate `branches.fix === "fix"`; graph has edge `gate→fix`; card shows the same edge |
| E7 | flows-plugin: Static YAML preview keeps object-form branches | BVA (malformed object forms) | L1 | automated | branches `{ a: { to: "" }, b: [x], c: { means: "m" } }` | `buildIdleFlowState(yaml)` | `branches` has no `a`/`b`/`c` keys; no node or edge target named `[object Object]` or `""` |
| E8 | design D4: strict default unchanged | decision table (lenient × valid) | L1 | automated | YAML missing top-level `description` | `buildIdleFlowState` strict vs `{lenient:true}` | strict → `kind:"error"` message mentions `description`; lenient → `kind:"ready"` |
| E9 | flow-authoring-renderers: counts from step list | EP (every step kind) | L1 | automated | YAML with `agent`, `agent-decision`, `fork`, `code`, `code-decision`, untyped step (6 steps) | render card | text "6 steps · 3 agents, 2 code" (untyped counts as agent) |
| E10 | flow-authoring-renderers: Card graph matches the flow panel; flow-graph-edges: Shared flow-edge derivation | equivalence across surfaces | L1 | automated | parity fixture YAML (agent segment, `code` separator followed by a step, string-branch decision, `on_error` route, fan-out step); error-route toggle key set to `true` | build (a) idle, (b) running via `flow_started`+agent/item/decision events, (c) (b)+`flow_complete`, (d) card render | node-id sets equal across (a)–(d); edge `from→to` sets equal; edge set contains ≥1 `implicit` and ≥1 `on_error` route edge |
| E11 | flow-summary-view: Same graph and cards before and after completion | equivalence (running vs completed) | L1 | automated | parity fixture state (b) and (c); panel expanded, `cards` key open | render `FlowDashboard` for each | both show one group card `review` with 3 item cards and decision chips (`fix` chosen, one "not taken") — identical DOM structure under `flow-agent-cards-section` |
| E12 | flow-authoring-renderers: No Mermaid output | EP | L1 | automated | valid YAML, written:true | render card | no element with `language-mermaid` / no `ui:markdown-content` call; `data-node` elements present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | flow-summary-view: Running-only controls are absent after completion | state-transition (running→complete) | L1 | automated | flow state status `running`, then `success` | re-render `FlowDashboardClaim` | completed: root `data-testid="flow-dashboard"` `data-flow-mode="summary"`; no AUTO, Abort, tab bar; Dismiss + `flow-summary-panel-toggle` present |
| F2 | flow-summary-view: Completed panel ignores a manually selected tab | state-transition | L1 | automated | flows `a` and `b`; user clicks tab `a` (follow off) | `b` completes | graph `data-node` ids and cards are `b`'s |
| F3 | flow-summary-view: Bidirectional selection; design D1 remount | state-transition (live→summary) | L1 | automated | live panel with step `build` selected | flow completes | after completion no node/card has the selected treatment (remount reset) |
| F4 | flow-summary-view: Node click opens the Agent cards section after completion | state-transition | L1 | automated | expanded completed panel, `cards` collapsed | click `data-node="build"` | cards section `aria-expanded="true"`; `build` card selected; `scrollIntoView` called with `block:"nearest"` |
| F5 | flow-panel-collapse-persistence; design D1 remount | state-transition (key flip) | L1 | automated | `dashboard` kind stored expanded, `summary` kind stored collapsed; live panel open | flow completes | first committed render after completion has no `flow-summary-scrollbox` and no `data-node` (no flash) |
| F6 | flow-summary-view: Completed summary panel collapses to its header; header offers Run again… | state-transition | L1 | automated | completed panel expanded with header actions | click `flow-summary-panel-toggle` | `agent-card` count 0, `flow-summaries` absent, `flow-summary-scrollbox` absent; Run again / Open flow / Edit and Dismiss still visible |
| F7 | flow-summary-view: Pending question stays visible after completion; flow-question-routing: Completed panel shows only pending prompts | state-transition | L1 | automated | one pending and one answered flow-question for the flow; panel collapsed | flow completes | pending question card rendered and its submit enabled; answered pill not rendered |
| F8 | flow-summary-view: Completed panel on mobile; flow-card-grid: Completed flow skips the bar on mobile | decision table (mobile × mode) | L1 | automated | `useMobile()` → true; completed flow | render panel | no "tap to expand" text; completed header + Dismiss rendered. Running flow on mobile still renders the bar |
| F9 | flow-summary-view: Summary lines section is collapsible beneath the cards | state-transition | L1 | automated | completed panel, 2 summary-bearing agents | click `flow-summary-toggle` | `flow-summaries` hidden; `flow-agent-cards-section` and `data-node` elements still present; both inside `flow-summary-scrollbox` before collapse |
| F10 | flow-summary-view: Fan-out step renders as a group after completion | EP | L1 | automated | completed flow: 5 steps, one fan-out of 3 items; 2 done, 1 failed, 1 skipped | render summary, cards collapsed | `flow-agent-cards-count` reads 5; pills done 2, failed 1, skipped 1 |
| F11 | flow-authoring-renderers: Authoring cards reconstruct from persisted tool entries on replay | state convergence (replay) | L1 | automated | persisted `flow_write` toolInput + result JSON (no live execution) | mount renderer from persisted props | same `data-node` set and counts as live render of the same props |
| F12 | flow-authoring-renderers: shared error-route toggle | state-transition | L1 | automated | fixture with `on_error` route; toggle key unset (default off) | click the graph's error-route toggle on the card | `on_error` edge appears in the card graph; persisted key now `true` |
| F13 | flow-authoring-renderers: expand-to-full-size | EP | L1 | automated | valid YAML card | click ⤢ expand | `ui:dialog` opened with `size="full"` containing a non-`fit` `FlowGraph` |
| F14 | flow-summary-view: Same graph and cards before and after completion (rendered) | state convergence | L3 | automated | docker harness runs the fan-out/decision fixture flow to completion | open the session, expand the finished panel and Agent cards | finished panel shows the fan-out group card with item cards and decision route chips, inside `flow-dashboard` `data-flow-mode="summary"` |
| F15 | proposal Why: same flow looks the same everywhere | visual/subjective | — | manual-only | a real flow written via `flow_write`, then opened, run and finished | human compares the transcript card, idle panel, running panel and finished panel | [judgment: the four views look like the same flow] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | flow-summary-view: Dismissal survives replay (regression) | state-transition | L1 | automated | finished run `r1` dismissed (`flow-run-close`) | replay events with the completed run | `FlowDashboardClaim` renders nothing for `r1` (summary mode never mounts) |
| X2 | flow-summary-view: Missing card falls back to summary line | fault (empty agent) | L1 | automated | completed flow where one agent has no tool history and no outputs | render summary | no throw; remaining cards render; that agent appears in `flow-summaries` when it has summary text |

---

## Coverage summary

- Requirements covered: 21/21 changed or added requirements (Purpose-only and wording-only deltas covered by E10/X1 regressions)
- Scenarios by class: edge 12 · perf 0 · frontend 15 · error 2
- Scenarios by level: L1 27 · L2 0 · L3 1
- Scenarios by disposition: automated 28 · manual-only 1

## New infra needed

- none
