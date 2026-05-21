## 1. Bridge primitive — `PromptAdapter.priority`

- [x] 1.1 In `packages/extension/src/prompt-bus.ts`, add `priority?: number` to the `PromptAdapter` interface with a doc comment: "default 1000, lower runs first."
- [x] 1.2 In `PromptBus.registerAdapter`, sort the internal adapter array by `(a.priority ?? 1000)` after the existing same-name replacement filter. Use a stable sort (the native `Array.prototype.sort` is stable in V8 ≥ ES2019, which the project relies on).
- [x] 1.3 In `packages/extension/src/dashboard-default-adapter.ts`, add `readonly priority = 9999`.
- [x] 1.4 In `packages/extension/src/__tests__/prompt-bus.test.ts` (or the dashboard-default-adapter tests, whichever already covers ordering): add tests
  - lower-priority adapter wins component slot
  - equal-priority preserves insertion order
  - undefined priority defaults to 1000
  - default adapter at 9999 is last
- [x] 1.5 Confirm no existing test relies on the previous registration-order behavior (search `rg -n "registerAdapter|adapterNames" packages/extension/src/__tests__`). Adjust if a test asserts a specific order that priority sort changes.

## 2. Flows-plugin bridge entry

- [x] 2.1 Create `packages/flows-plugin/src/bridge/flow-question-adapter.ts` exporting class `FlowQuestionAdapter implements PromptAdapter`:
  - `readonly name = "flow-question"`
  - `readonly priority = 100`
  - `onRequest(prompt)` returns the spec'd claim when `metadata.flowId` is a non-empty string; `null` otherwise
  - `onResponse` and `onCancel` are no-ops
- [x] 2.2 Create `packages/flows-plugin/src/bridge/index.ts`:
  ```ts
  import { FlowQuestionAdapter } from "./flow-question-adapter.js";
  export default function activate(ctx: any): void {
    const pi = ctx?.pi ?? ctx;
    pi?.events?.emit("prompt:register-adapter", new FlowQuestionAdapter());
  }
  ```
- [x] 2.3 Add `"bridge": "./src/bridge/index.ts"` to `packages/flows-plugin/package.json`'s `pi-dashboard-plugin` manifest block.
- [x] 2.4 Add a typed dep for `PromptAdapter`. Either (a) add `"@blackbelt-technology/pi-dashboard-extension": "*"` as a peer dep and import the type from there, or (b) inline a structural type interface in `flow-question-adapter.ts` so the plugin doesn't carry a hard dep on the main bridge package. Pick (b) — keeps coupling minimal and the type surface is tiny.
- [x] 2.5 Unit test `packages/flows-plugin/src/bridge/__tests__/flow-question-adapter.test.ts`:
  - claims on flowId-tagged prompt
  - declines on untagged prompt
  - declines on empty-string flowId
  - claim props match the input fields
  - `priority` is 100
- [x] 2.6 Smoke test that the bridge entry emits exactly one `prompt:register-adapter` event with a `FlowQuestionAdapter` instance.

## 3. Client — `flow-question` component type registration

- [x] 3.1 In `packages/flows-plugin/src/client/index.tsx`, call `registerPromptComponent({ type: "flow-question", placement: "widget-bar" })` at module top level (mirror of `installFlowsAvailabilitySubscriber()` pattern).
- [x] 3.2 Verify HMR idempotency — re-importing the module SHALL replace the registration without throwing.
- [x] 3.3 Unit test: `getPromptComponentInfo("flow-question")` returns the expected entry after the plugin client module loads.

## 4. Client — flow-reducer queue slice

- [x] 4.1 Extend `packages/flows-plugin/src/flow-reducer.ts` with a `pendingFlowQuestions: Map<string, PromptRequest[]>` slice keyed by `flowId`. Treat the reducer's existing input event stream — `prompt_request` / `prompt_dismiss` / `prompt_cancel` / `prompt_response` events flowing through `useSessionEvents` — as the source.
- [x] 4.2 On `prompt_request` with component type `flow-question`: append the request to `pendingFlowQuestions.get(props.flowId)` (creating the queue if absent).
- [x] 4.3 On `prompt_dismiss` / `prompt_cancel` / `prompt_response`: remove the matching prompt id from the per-flow queue. The reducer locates the queue by walking pendingFlowQuestions values (prompt id is unique across flows).
- [x] 4.4 On `flow_complete`: drop the queue for that flow id.
- [x] 4.5 Expose the queue head in `FlowState` (or a sibling state object returned by `useFlowsSessionState`) so `FlowDashboard` can read `flowState.pendingQuestion ?? null` and `flowState.pendingQuestionCount`.
- [x] 4.6 Unit tests covering: append, head-removal, mid-queue removal, per-flow isolation, flow-complete clears queue, empty-queue dismiss is a no-op.

## 5. Client — FlowDashboard renders the question card

- [x] 5.1 In `packages/flows-plugin/src/client/FlowDashboard.tsx`, read `pendingQuestion` for the currently-displayed flow tab from the flows session-state context.
- [x] 5.2 When `pendingQuestion` exists, render a question card above the agent grid using the existing prompt component renderers (confirm / select / multiselect / input). The card SHALL match the visual hierarchy of FlowDashboard sub-sections (border, padding, color tokens).
- [x] 5.3 Queue depth > 1 → render a small "+N more queued" badge in the card header.
- [x] 5.4 Per-flow tab isolation: switching tabs SHALL show only that flow's head.
- [x] 5.5 Wire submit: optimistic local removal + `usePluginSend({ type: "prompt_response", promptId, answer, source: "dashboard-flow-question" })`.
- [x] 5.6 Wire cancel: small "dismiss" button on the card that sends `prompt_cancel`.
- [x] 5.7 Component test rendering each of the four prompt types (`confirm` / `select` / `multiselect` / `input`) in the FlowDashboard card with a fake reducer slice.

## 6. Client — suppression in chat indicators

- [x] 6.1 In `packages/client/src/components/SessionCard.tsx`, the `card-input-pulse` (purple) class SHALL be skipped when the session's currently pending PromptBus request has component type `"flow-question"`; fall back to `card-working-pulse` (amber) when streaming.
- [x] 6.2 In `packages/client/src/components/ActivityIndicator.tsx` (or equivalent), apply the same guard for the "Waiting for input" label.
- [x] 6.3 Verify the pending-prompt component-type field is already on session state. If not, plumb `pendingPromptComponentType?: string` from `prompt_request` via the shell event reducer (or via a plugin-provided context — pick whichever has lower blast radius).
- [x] 6.4 Tests: SessionCard renders amber pulse (not purple) when `currentTool === "ask_user"` AND the pending prompt's component type is `"flow-question"`; renders purple pulse when component type is `"generic-dialog"` or absent.

## 7. Cross-repo coordination (pi-flows producer, tracking-only)

These tasks live in `/home/skrot1/BB/pi-packages/pi-flows/` and ship as a separate PR. Tracked here for capability completeness.

- [x] 7.1 In pi-flows, identify the wrap point for `ctx.ui.{confirm,select,input,multiselect}` calls made from inside a flow step (design.md Decision 6, Shape A: thread-local flow context).
- [x] 7.2 Attach `metadata: { flowId, stepId }` to the underlying PromptBus request from the wrapped call site.
- [x] 7.3 Ensure `flowId` and `stepId` match the values emitted in `flow:flow-started` / `flow:agent-started`.
- [x] 7.4 Ensure metadata propagates when an inner tool (not pi-flows' own `ask_user`) calls `ctx.ui.*` from within a flow step.
- [x] 7.5 Smoke test: run a flow with a fork step that calls `ask_user`; verify the dashboard shows the question in FlowDashboard's upper slot and NOT in the chat stream.

## 8. Backward compatibility verification

- [x] 8.1 Smoke test: old pi-flows (no metadata) with new dashboard → question renders in chat (default adapter wins).
- [x] 8.2 Smoke test: new pi-flows (with metadata) with flows-plugin disabled → question renders in chat (no FlowQuestionAdapter registered).
- [x] 8.3 Smoke test: new pi-flows with new dashboard, flows-plugin enabled → question renders in FlowDashboard upper slot, NOT in chat.

## 9. Spec verification

- [x] 9.1 `openspec validate route-flow-asks-to-upper-slot --strict` passes.
- [x] 9.2 Confirm no requirements are needed against `flow-event-bridge` or `flow-server-state` (per design.md Decision 1).

## 10. Documentation

- [x] 10.1 Delegate to subagent (per AGENTS.md): add file-index rows in `docs/file-index-plugins.md` for `packages/flows-plugin/src/bridge/index.ts` and `packages/flows-plugin/src/bridge/flow-question-adapter.ts`.
- [x] 10.2 Update file-index row for `packages/flows-plugin/src/client/FlowDashboard.tsx` to note the upper-slot question card.
- [x] 10.3 Update file-index row for `packages/extension/src/prompt-bus.ts` to note the new `priority` field.
- [x] 10.4 No AGENTS.md backbone changes needed (plugin-internal routing + a generic primitive; not architectural backbone).
