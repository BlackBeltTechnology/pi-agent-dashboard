# route-flow-asks-to-upper-slot

## Why

When a flow runs and needs human input (a fork's decision, or any `ask_user` call inside a flow step), the question currently renders inline in the chat stream alongside agent assistant text. Users have to context-switch between the FlowDashboard upper slot (which shows the running flow visualization) and the chat view (which shows the question waiting for them). For long-running flows the question scrolls out of view as later agent text streams in, and the visual hierarchy implies the question is "just another tool call" rather than the load-bearing decision it actually is.

Flow-scoped questions belong with the flow visualization. The FlowDashboard already occupies the `content-header-sticky` slot above the chat — that is the right place to surface a "this flow is blocked on you" prompt. This change establishes the producer→consumer contract that routes flow-originated prompts out of the chat default-adapter pipeline and into the flow plugin's upper-slot region.

A precondition: the prompt-bus adapter that intercepts flow-tagged prompts MUST live in the flows-plugin's own bridge entry, not in the main dashboard bridge. Adapter ordering ("flow adapter beats default adapter") MUST be controllable from the plugin's load site, since plugin bridges activate AFTER the main bridge has already registered the default adapter. This change therefore also introduces a generic primitive: `PromptAdapter.priority` in `packages/extension/src/prompt-bus.ts`, with `DashboardDefaultAdapter` set to `priority: 9999` (last-resort) so any plugin-registered adapter with default priority (1000) or lower wins routing automatically.

## What Changes

### Bridge primitive (generic plumbing, lives in `packages/extension/`)

- **`PromptAdapter.priority?: number`** added to the interface in `packages/extension/src/prompt-bus.ts`. Default 1000; lower = earlier. `registerAdapter` SHALL maintain its internal array in priority order (stable sort).
- **`DashboardDefaultAdapter.priority = 9999`** (last-resort fallback). This is the ONLY change to the existing default adapter — its claim logic stays identical.
- **`PromptBus.adapterNames`** continues to return names in registration-order semantics; the visible ordering after registration is priority order.

No flow-specific code in the main bridge. The generic primitive applies equally to any future plugin that needs to claim prompts before the default adapter.

### Flows-plugin bridge entry (where the flow adapter actually lives)

- **NEW** `packages/flows-plugin/src/bridge/flow-question-adapter.ts` — implements `PromptAdapter` with `name: "flow-question"`, `priority: 100`, and the claim logic:
  - `onRequest(prompt)` returns `{ component: { type: "flow-question", props: { flowId, stepId, question, type, options?, defaultValue? } }, placement: "widget-bar" }` WHEN `prompt.metadata?.flowId` is a non-empty string; returns `null` otherwise.
  - `onResponse` and `onCancel` are no-ops (no adapter-owned UI to dismiss).
- **NEW** `packages/flows-plugin/src/bridge/index.ts` — pi-extension entry that emits `pi.events.emit("prompt:register-adapter", new FlowQuestionAdapter())` on activation. The main bridge already listens for this event (existing handler in `bridge.ts` around line 1460).
- **NEW manifest field** `"bridge": "./src/bridge/index.ts"` in `packages/flows-plugin/package.json`'s `pi-dashboard-plugin` block. Discovery + auto-registration via the existing `discoverPlugins → registerAllPluginBridges` chain writes the bridge path into pi's `settings.json#packages[]`, so pi loads it as an extension alongside the dashboard bridge.

### Client — `flow-question` component type registration

- **`packages/flows-plugin/src/client/index.tsx`** SHALL call `registerPromptComponent({ type: "flow-question", placement: "widget-bar" })` at module load time (idempotent — re-registration replaces).

### Client — flow-reducer queue slice

- **Extend `packages/flows-plugin/src/flow-reducer.ts`** (or add a sibling module) with a per-flow FIFO queue: `pendingFlowQuestions: Map<string, PromptRequest[]>` (key: `flowId`).
- On incoming `prompt_request` with `component.type === "flow-question"`: append to the queue keyed by `props.flowId`.
- On `prompt_dismiss` / `prompt_cancel` / `prompt_response` for that prompt id: remove the matching entry; if it was the head, the next becomes the head.
- On `flow_complete` for a flow id: drop that flow's queue.
- On session unsubscribe / clear: drop all queues for that session.

### Client — FlowDashboard renders the queue head

- **`packages/flows-plugin/src/client/FlowDashboard.tsx`** reads `pendingFlowQuestions` for the currently-displayed flow tab from the flows session-state context.
- When the head exists, renders a question card above the agent grid using the standard prompt component renderers (confirm / select / multiselect / input). Visual hierarchy consistent with FlowDashboard sub-sections.
- Queue depth > 1 → small "+N more queued" badge in card header.
- Per-flow tab isolation: switching tabs shows only that flow's head.
- Submit: optimistic local-queue removal + `usePluginSend({ type: "prompt_response", promptId, answer, source: "dashboard-flow-question" })`.
- Cancel affordance: small "dismiss" button on the card that sends `prompt_cancel`.

### Client — chat suppression for flow-tagged prompts

- **`packages/client/src/components/SessionCard.tsx`**: the `card-input-pulse` (purple) class SHALL be skipped when the pending PromptBus request has component type `"flow-question"`. Fall back to `card-working-pulse` (amber) if streaming.
- **`packages/client/src/components/ActivityIndicator.tsx`** (or equivalent): same guard — "Waiting for input" label suppressed for flow-routed prompts.
- The pending-prompt component-type field MUST be available on session state. If not already plumbed from `prompt_request`, add `pendingPromptComponentType?: string` to the session state slice.

### Scope policy

- **Option A — ALL `ask_user` calls inside a flow route to the upper slot.** Not just fork-step asks. Predictable; avoids "question appears in two places" confusion. (Options B and C rejected; see design.md.)
- **No new YAML knobs** in flow definitions. Routing is driven by *where* the call originates (inside a flow step), not by flow-author choice.
- **Coordination-only producer tasks** — pi-flows producer change is listed in tasks but lives in `/home/skrot1/BB/pi-packages/pi-flows/`. This proposal does not edit pi-flows source.

## Capabilities

### New Capabilities

- `flow-question-routing`: The producer→consumer contract for routing flow-originated `ask_user` prompts out of the chat pipeline and into the flow plugin's upper slot. Covers: the `metadata.flowId` / `metadata.stepId` tag shape on `PromptRequest`; the `PromptAdapter.priority` field with `DashboardDefaultAdapter.priority = 9999`; the `FlowQuestionAdapter` (priority 100) shipped from the flows-plugin's bridge entry; the manifest `bridge` field that auto-registers the plugin's bridge via existing discovery; the client `flow-question` component-type registration; the per-flow FIFO queue in the flow-reducer; FlowDashboard rendering within the `content-header-sticky` frame; response routing back via the standard PromptBus path; cancel-on-abort; serialization of concurrent flow questions; backward compatibility when either side hasn't shipped the new code.

### Modified Capabilities

- `ask-user-card-indicator`: Guard that the existing `ask_user` chat indicators (session card pulse, activity indicator label) SHALL NOT activate for flow-routed prompts (component type `flow-question`), since those render in the flow upper slot instead.

(`flow-event-bridge` and `flow-server-state` are intentionally NOT modified — design.md Decision 1 routes the question through the existing `prompt_request` PromptBus pipeline rather than new `flow_*` events.)

## Impact

**Affected code**

- `packages/extension/src/prompt-bus.ts` — add `priority` field + sort in `registerAdapter`. Generic, ~10 LOC.
- `packages/extension/src/dashboard-default-adapter.ts` — add `priority: 9999`. Single line.
- `packages/flows-plugin/src/bridge/index.ts` (NEW) — pi-extension entry, ~10 LOC.
- `packages/flows-plugin/src/bridge/flow-question-adapter.ts` (NEW) — the adapter implementation, ~40 LOC.
- `packages/flows-plugin/package.json` — `"bridge": "./src/bridge/index.ts"` in the manifest.
- `packages/flows-plugin/src/flow-reducer.ts` — pending-question queue slice.
- `packages/flows-plugin/src/client/FlowDashboard.tsx` — renders question card above the agent grid.
- `packages/flows-plugin/src/client/index.tsx` — `registerPromptComponent("flow-question", "widget-bar")` at module load.
- `packages/client/src/components/SessionCard.tsx` — guard against `flow-question` for the purple pulse.
- `packages/client/src/components/ActivityIndicator.tsx` (or equivalent) — same guard for the label.

**External (cross-repo)**

- `pi-flows` repo — modify `extensions/flow-engine/tools/ask-user.ts` to attach `flowId`/`stepId` metadata when the call originates inside a flow execution context. This proposal does not edit pi-flows source; the producer change ships independently.

**APIs / protocol**

- **No new wire-protocol message types.** Routing rides existing `prompt_request` / `prompt_response` / `prompt_dismiss` / `prompt_cancel`. Metadata field already propagates end-to-end through the bridge (`bridge.ts` ~line 1252).
- **One new interface field**: `PromptAdapter.priority?: number`. Optional, default 1000. Additive — does not break existing implementations.

**Plugin contract**

- Plugins can now ship a `bridge` entry as a pi extension auto-registered through `discoverPlugins → registerAllPluginBridges`. (Mechanism predates this change; flows-plugin is the first first-party consumer.)
- Plugins can register PromptBus adapters with deterministic ordering via `priority`. The shared event API `pi.events.emit("prompt:register-adapter", adapter)` continues to be the plugin-friendly registration path.

**Backward compatibility**

- pi-flows versions that don't emit the metadata tags continue working — their prompts fall through to the default adapter and render in chat as today.
- Dashboard versions without the flows-plugin bridge entry (e.g. the plugin disabled) see no `FlowQuestionAdapter` registered and behave as today.
- `PromptAdapter.priority` is optional — existing third-party adapters work without modification (they get the default 1000 priority).

**Risks**

- Cross-repo coordination — producer ships independently of dashboard. Mitigated by additive design.
- Parallel agent steps calling `ask_user` need serialization — FIFO queue per flow, single visible card, badge for queue depth.
- Plugin bridge auto-registration runs on server startup; existing pi sessions need a `/reload` to pick up the new extension. This is the standard plugin-bridge workflow (no new behavior).
