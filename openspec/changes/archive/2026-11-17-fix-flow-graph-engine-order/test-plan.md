# Test Plan — fix-flow-graph-engine-order

Stage: design   Generated: 2026-11-16

Hard gate passed. One clarification (where a terminal handler's error-only tail goes) was answered by the user: pool it into the sink. That answer is now in spec and design.

Fixture shapes (hand-copied step lists, raw engine `type`):
- **NTI** = `notes-to-issues`: read(code-decision some:triage none:report, on_error report), triage(agent, on_error report), cleanup(code, on_error report), report(code).
- **UPD** = `update-dashboard`:
  - pull(code-decision ok:build diverged:rebase, on_error report)
  - rebase(code-decision ok:build conflict:resolve, on_error resolve)
  - resolve(agent, on_error report)
  - check(code-decision retry:resolve ok:build, on_error report)
  - build(code-decision ok:launch fail:resolve, on_error report)
  - launch(code, on_error report)
  - report(code)
- **SD4** = `ship-dispatch` (current): start(code-decision run:dispatch busy:report), dispatch(code, on_error report), retire(code, on_error report), report(code).
- **CC10** = 10-step code-chain shape:
  - start(code-decision run:pick busy:report)
  - pick(code-decision go:worktree none:retire, on_error report)
  - worktree(code, on_error fail)
  - init(code, on_error fail)
  - spawn(code, on_error fail)
  - record(code-decision more:loop stop:retire, on_error report)
  - fail(code-decision more:loop stop:retire, on_error report)
  - loop(code-decision next:pick done:retire)
  - retire(code, on_error report)
  - report(code)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | flow-graph-edges / Consecutive code steps chain | state-transition (engine pc) | L1 | automated | CC10 steps | `deriveFlowEdges` | `implicit` edges `worktree→init`, `init→spawn`, `spawn→record` present; no edge `pick→init`, `pick→spawn`, `pick→record` |
| E2 | flow-graph-edges / DAG sinks fall through | state-transition | L1 | automated | NTI steps | `deriveFlowEdges` | `implicit` `triage→cleanup` and `cleanup→report` present; no edge `read→cleanup` |
| E3 | flow-graph-edges / Fall-through into step with incoming edges | decision-table | L1 | automated | SD4 steps | `deriveFlowEdges` | edges `start→report` (branch busy), `dispatch→retire` (implicit), `retire→report` (implicit) all present |
| E4 | flow-graph-edges / Fall-through coexists with on_error | decision-table | L1 | automated | UPD steps | `deriveFlowEdges` | exactly 2 edges `launch→report`: one `kind:"implicit"`, one `kind:"route"` label `on_error` |
| E5 | flow-graph-edges / Decisions without loop cap never fall through | decision-table | L1 | automated | SD4 steps (start has forward branches only) | `deriveFlowEdges` | no edge with `from:"start"` and `kind:"implicit"` |
| E6 | flow-graph-edges / Loop-capped decision falls through | decision-table | L1 | automated | `[a(agent), d(code-decision branches {retry:a}), x(code)]` and same with d `agent-decision` | `deriveFlowEdges` | `implicit` `d→x` present, `backward:false` |
| E7 | flow-graph-edges / Fork loop never falls through | decision-table | L1 | automated | `[a(agent), f(fork branches {again:a}), x(code)]` | `deriveFlowEdges` | no edge `f→x` |
| E8 | flow-graph-edges / In-segment on_error target is not a root | state-transition | L1 | automated | `[s(code), a(agent on_error b), b(agent), z(code)]` | `deriveFlowEdges` | edges `s→a` implicit, `a→b` sequential, `a→b` route on_error, `b→z` implicit; no `s→b`, no `a→z` |
| E9 | flow-graph-edges / Unknown step type joins the DAG segment | EP (invalid class) | L1 | automated | `[s(code), r(type "flow-ref"), u(no type), z(code)]` | `deriveFlowEdges` | no throw; `s→r`, `s→u`, `r→z`, `u→z` implicit; no edge `r→u` |
| E10 | flow-graph-edges / Agent siblings stay parallel | EP | L1 | automated | `[s(code), a(agent), b(agent), z(code)]` | `deriveFlowEdges` | `s→a`, `s→b`, `a→z`, `b→z` implicit; no edge between `a` and `b` |
| E11 | flow-graph-edges / on_complete-routed step connected | decision-table | L1 | automated | (i) `[a(code on_complete c), b(code), c(code)]`; (ii) `[a(code on_complete b), b(code)]` | `deriveFlowEdges` | (i) route `a→c` AND implicit `a→b`; (ii) exactly one edge `a→b` |
| E12 | flow-graph-edges / Routing target suppresses spurious implicit | decision-table | L1 | automated | `[a(code on_error h), d(code-decision branches {go:z}), h(code), z(code)]` | `deriveFlowEdges` | route `a→h` present; no `implicit` edge from `d` |
| E13 | flow-graph-edges / branch+on_error same pair | decision-table | L1 | automated | UPD steps | `deriveFlowEdges` | exactly one edge `rebase→resolve`, `kind:"branch"` label `conflict` |
| E14 | flow-graph-edges / last segment + duplicates | BVA (first/last segment) | L1 | automated | NTI steps | `deriveFlowEdges` | no edge with `from:"report"`; no duplicate non-error `{from,to}` pair in the list |
| E15 | flow-graph-edges / Terminal target on success path stays visible | decision-table | L1 | automated | SD4 steps as `FlowGraphStep` | `computeLayout` with showErrorRoutes false, then true | `report` in `nodes` both times; edge `start→report` present; `errorSink` absent or `report ∉ errorSink.handlers` |
| E16 | flow-graph-edges / Terminal handler tail pools into sink | state-transition | L1 | automated | `[a(code on_error cleanup), z(fork branches {again:a}), cleanup(code), notify(code)]` (fork loop never falls through, so `cleanup` is error-only; the earlier `end(code)` shape fell through into `cleanup`) | `computeLayout` showErrorRoutes true | `cleanup`, `notify` ∉ `nodes`; `errorSink.handlers` equals `["cleanup","notify"]` |
| E17 | flow-graph-edges / Root nodes never error-only | BVA (0 incoming) | L1 | automated | NTI steps | `computeLayout` showErrorRoutes false | `read` ∈ `nodes` |
| E18 | flow-graph-edges / Handler also a branch target stays visible | decision-table | L1 | automated | UPD steps | `computeLayout` showErrorRoutes false | `resolve` ∈ `nodes`; edge `rebase→resolve` present; `resolve` ∉ any sink handlers |
| E19 | flow-graph-edges / In-segment on_error target visible | state-transition | L1 | automated | E8 steps | `computeLayout` showErrorRoutes false | `b` ∈ `nodes`; edge `a→b` present |
| E20 | flow-graph-edges / parallel edges laid out (multigraph) | decision-table | L1 | automated | UPD steps | `computeLayout` showErrorRoutes true, then false | true: 2 edges `launch→report` each with ≥2 points, `edges.length` equals the number of derived edges laid out; false: exactly 1 edge `launch→report` (implicit) |
| E21 | flow-graph-edges / Hidden error layer costs no layout | invariant | L1 | automated | CC10 steps | `computeLayout` showErrorRoutes false | no edge with `isError`; `fail` ∉ `nodes`; no edge with `source:"fail"` |
| E22 | flow-graph-edges / Mid-flow handler reached by fall-through visible | decision-table | L1 | automated | `[a(code on_error h), b(code), h(code), z(code)]` (b falls through to h) | `computeLayout` showErrorRoutes false | `h` ∈ `nodes`; edge `b→h` present |
| E23 | flow-graph-edges / raw kind on live path | EP | L1 | automated | `FlowState.dagSteps` with `d` stepType `agent-decision` (backward branch) followed by `x`, and a copy with `fork` | `flowStateToGraphSteps` → `computeLayout` | agent-decision copy has edge `d→x`; fork copy has none |
| E24 | flow-graph-edges / idle path carries onError | EP | L1 | automated | idle YAML with `code-decision`, `fork`, `agent-decision` each declaring `on_error: h` | `flow-idle-state` step synthesis | each synthesized step has `onError:"h"` |
| E25 | flow-authoring-renderers / Implicit-segment edges in snapshot | EP | L1 | automated | NTI YAML text; UPD YAML text | `flow-yaml-parse` Mermaid generation | NTI Mermaid contains `triage --> cleanup` (or the renderer's equivalent edge token) and no `read --> cleanup`; UPD Mermaid contains two `launch`→`report` edges |
| E26 | flow-card-status / Fall-through edges render while running | state-transition | L3 | automated | EXISTING fixture flow `e2e/slow` (`wait`(code), `after`(code)) attached idle | open the session flow panel (`openIdleGrid`-style helper) | graph contains an edge element `data-edge="wait>after"` |
| E27 | flow-graph-edges / error routes on a real fixture | decision-table | L3 | automated | EXISTING fixture flow `e2e/fanout` (`fan` agent `on_error: done`; `done` code is the next segment) attached idle | open the panel with error routes hidden, then click the `⚠ error routes` toggle | hidden: `[data-node="done"]` visible and `data-edge="fan>done"` (implicit) present; shown: a second, error-styled `fan>done` edge is present and `done` is still a normal node (not pooled in the sink) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | flow-graph-edges / Shared derivation (dangling refs) | fault-injection (bad input) | L1 | automated | branch target `ghost` and `blockedBy:["ghost"]` not in steps | `deriveFlowEdges` | no throw; no edge with `ghost` endpoint; fall-through edges still present |
| X2 | flow-graph-edges / Shared derivation (empty / single) | BVA | L1 | automated | `[]`; `[a(code)]` | `deriveFlowEdges`, `computeLayout` | `[]` edges; single node, 0 edges, no sink |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | proposal / Why (readability) | visual/subjective | — | manual-only | mock site frames for NTI, UPD, CC10 after the fix | a human reads each graph | [judgment: "the next step after any node is obvious" — no automatable observable] |

---

## Coverage summary

- Requirements covered: 6/6 MODIFIED requirements (flow-graph-edges ×2, flow-authoring-renderers ×1, flow-card-status ×1, plus D4 idle path and the D2 multigraph behaviour)
- Scenarios by class: edge 27 · perf 0 · frontend 1 · error 2
- Scenarios by level: L1 27 · L2 0 · L3 2
- Scenarios by disposition: automated 29 · manual-only 1
- Performance: none. The spec sets no latency budget, and the derivation is O(steps + edges) on graphs of fewer than 50 nodes.

## New infra needed

- None. No flow YAML, fixture flow or pi-flows change: E26 and E27 reuse the existing `e2e/slow` and `e2e/fanout` fixtures. The only addition is a `data-edge="<from>><to>"` attribute on rendered edge `<g>` elements in `FlowGraph.tsx` (plugin visualization code).
