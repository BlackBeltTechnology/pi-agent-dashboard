## Why

The flow slot (`content-header-sticky` → `FlowDashboardClaim`) only renders after pi-flows emits `flow_started`, so a user cannot look at a flow's graph and node cards before running it. The FLOWS subcard only offers Run / New-Edit / Delete by name. Users want to open (attach) any flow into the real flow slot ahead of time, see it stale and empty, and have that same panel come alive when the flow starts.

## What Changes

- Add an **Open flow…** button to the FLOWS subcard (`SessionFlowActions`) listing every flow in the session's `flowsList` (project + pi-flows package flows). The button is disabled while any flow in the session is running.
- Picking a flow **attaches** it to the session's flow slot: the client fetches `FlowInfo.source` (absolute `flow.yaml` path) via the existing `GET /api/pi-resource-file`, maps its steps with pi-flows 0.5.0's per-node-kind field rules, and synthesizes a `flow_started` event that is fed through the **existing** `reduceFlowEvent` — so the idle panel has the exact card set and DAG topology a real start would produce.
- `FlowDashboard` gains an **idle** (not-started) mode: full graph + expand dialog + all cards in `pending`, YAML popover, AUTO toggle (last known autonomous mode, else the pi-flows default); the header shows "not started" with **Run** (opens `FlowLaunchDialog`) and **Close** (detach) instead of Abort; it never forwards to `FlowSummary`.
- A rejected start (`flow_complete` `status: "rejected"`) no longer marks the current running flow complete; the idle panel shows the rejection reason and re-enables Run.
- Live-panel selection no longer clears on every run event: a selected node stays selected across run progress (and across idle → live), clearing only on Esc, re-click, or a displayed-flow change.
- Slot priority in `FlowDashboardClaim`: running flow → attached (idle) flow → completed summary → nothing.
  - Attached flow X starts → the **same** opened panel updates live (no remount).
  - A different flow Y starts (or any flow starts after the attach) → the attachment is dropped and the slot is **replaced** by Y.
- The attachment persists per session in `localStorage` (survives reload, per device). It is consumed as soon as a running flow is observed, and on replay when a `flow_started` newer than the attach baseline appears, so a start that happened while the tab was closed also clears it.
- Based on pi-flows **0.5.0** (installed = npm `latest` = GitHub `develop` HEAD): bundled `<ns>/<name>/flow.yaml` layout, required `type` with node kinds `agent` / `agent-decision` / `fork` / `code` / `code-decision`, `on_complete` removed, `flow:flow-started` step payload `{id, stepType, agent, blockedBy, branches, onError}` — the idle state mirrors that payload exactly.
- Out of scope: any graph edge change, agent frontmatter enrichment of idle cards (model/tools/label), the dead `FlowYamlPreviewClaim`, server/bridge/protocol changes.

## Capabilities

### New Capabilities
- `flow-pre-run-attach`: attaching a flow to the session flow slot before it runs — the subcard Open action, idle panel rendering, slot priority / replacement rules, attach→live continuity, detach, and per-session persistence.

### Modified Capabilities
- `flows-plugin`: "flow_complete event handling" status/result updates now skip a `flow_complete` with `status: "rejected"` (a start pi-flows refused without any `flow_started`), so a rejected second start no longer marks the running flow complete.
<!-- Unchanged: flow-card-launcher, flow-card-status, flow-summary-view (FlowSummary selection untouched), dashboard-shell-slots, flow-panel-collapse-persistence. Live-panel (FlowDashboard) selection had no spec and is specified in the new capability. -->

## Impact

- `packages/flows-plugin/src/client/`: `SessionFlowActions.tsx` (Open button + picker), `FlowDashboard.tsx` (idle mode, selection-reset rule, claim priority), `FlowsSessionStateContext.tsx` (`lastFlowStartedAt`, `lastAutonomousMode`), new `flow-idle-state.ts` (0.5.0 step mapping, fake `flow_started`, slot resolution) + `flow-attach-store.ts` (per-session `localStorage` + cross-tab `storage` sync), `i18n.ts` keys. `flow-yaml-parse.ts` / `FlowWriteToolRenderer` untouched.
- `packages/flows-plugin/src/flow-reducer.ts`: `flow_complete` with `status: "rejected"` returns the current state unchanged (fixes a pre-existing clobber of the running panel reachable from subcard Run / automation).
- Plugin-owned file serving (design D11): the flows-plugin bridge reports flow/agent sources to the flows-plugin server, which serves the exact YAML / agent / handler files (runtime-registered dirs). Idle cards get file buttons; file buttons open in the host editor (Split view). No host flow-code, bridge-core, or protocol changes. Reuses `/api/pi-resource-file`, `reduceFlowEvent`, `FlowGraph`, `FlowAgentCard`, `FlowLaunchDialog`, `flow_management run`.
- Tests: vitest unit tests for the attach store, synth-event builder, claim priority; client component tests for idle rendering and the Open button gating.

## Discipline Skills

- `review-code` — non-trivial client change (new store + claim priority logic + FlowDashboard mode) before commit.
- No `security-hardening` / `performance-optimization` / `observability-instrumentation` / `doubt-driven-review` trigger: no new endpoint, untrusted-input path, latency budget, or irreversible step (reuses the existing allow-listed `/api/pi-resource-file`; state is client-local).
