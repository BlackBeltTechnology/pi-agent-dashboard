## Context

`packages/extension/src/prompt-bus.ts` already provides the full plumbing this change needs:

- `PromptRequest.metadata?: Record<string, unknown>` — arbitrary tag bag that survives end-to-end (bridge → wire → client).
- Multi-adapter routing via `registerAdapter()`; first-component-wins per `claims.find(c => c.claim.component)`.
- Client side has `packages/client/src/lib/prompt-component-registry.ts` with explicit `placement: "inline" | "widget-bar" | "overlay"` and a precedent (`architect-prompt`, `widget-bar`) for rendering prompts outside the chat stream.
- `onDashboardRequest` already sends `metadata` over the wire as part of the `prompt_request` message (`packages/extension/src/bridge.ts` ~line 1252).

The flow renderer (`packages/flows-plugin/src/client/FlowDashboard.tsx`) claims the `content-header-sticky` slot today. It owns the upper-slot real estate where the question must appear.

The producer side (pi-flows) routes flow-originated questions through `ctx.ui.{confirm,select,input,multiselect}` from `extensions/flow-engine/tools/ask-user.ts`. pi-coding-agent's `ctx.ui` is the entry point that pi's runtime patches to drive PromptBus when the bridge is loaded.

What does NOT exist today:
- A way for the producer to attach flow context (`flowId`, `stepId`) to a prompt — the producer would have to thread `metadata` through `ctx.ui` calls, which today don't accept it.
- A bridge-side adapter that recognizes flow-tagged prompts.
- A FlowDashboard-scoped rendering site for prompts.
- Suppression in `AskUserToolRenderer` for flow-tagged calls.

## Goals / Non-Goals

**Goals:**
- Route every `ask_user` call originating inside a running flow to the FlowDashboard's content-header-sticky region.
- Suppress the corresponding chat indicators (AskUserToolRenderer expansion, SessionCard ask_user pulse) for those calls.
- Keep the path additive: pi-flows versions without the new metadata continue rendering in chat as today; dashboard versions without the new adapter render flow questions in chat as today.
- Serialize concurrent flow questions (multiple parallel agent steps each calling `ask_user`) into a deterministic FIFO queue.
- Reuse existing prompt component types where possible (confirm/select/multiselect/input) — no new client form renderers.

**Non-Goals:**
- Editing pi-flows source (cross-repo; coordination tasks only).
- Modifying `ctx.ui` upstream in pi-coding-agent. The producer change must work at the pi-flows level by either (a) using a thread-local "current flow context" the flow engine already tracks, or (b) a new pi-flows-internal helper that wraps `ctx.ui` calls. This proposal does not prescribe the producer's internals.
- Generalizing this routing to non-flow extensions. The contract is flow-specific; other extensions wanting "render outside chat" continue using the existing `widget-bar` placement / custom component types via `registerPromptComponent`.
- Mid-question session disconnects / resume. If the user closes the browser tab while a flow question is pending, the bridge keeps the promise alive; on reconnect, the pending request is replayed via `getPendingRequests()` (existing PromptBus mechanism). This change does not change that behavior — it just inherits it.
- Persisting pending questions across pi process restarts. PromptBus is in-memory; a process crash kills the awaiting promise. Out of scope.

## Decisions

### Decision 1: Route through PromptBus metadata (Option A), not a separate `flow:ask-user` event

**Choice:** pi-flows attaches `metadata: { flowId, stepId }` to the existing PromptBus request. The bridge gets a new `FlowQuestionAdapter` that inspects `metadata.flowId` in `onRequest`, claims when present (with `component: { type: "flow-question", props: {flowId, stepId, ...} }` and `placement: "widget-bar"` or a new flow-specific placement), and registers BEFORE `DashboardDefaultAdapter` so its claim wins.

**Alternative rejected:** Bypass PromptBus entirely — pi-flows emits a brand-new `flow:ask-user` event, the bridge forwards it as `flow_ask_user` event type, the server tracks state, the flow plugin renders, and the response routes back through a new `flow_ask_user_response` message. The bridge would resolve a stored promise to satisfy the producer's awaiting `ctx.ui` call.

**Why Option A over the separate-channel alternative:**
- The plumbing (PromptBus metadata, multi-adapter routing, component-type registry, placement, reconnect replay, cancel-on-abort) already exists end-to-end. We add one bridge adapter + one client component-type registration. Total bridge LOC ≈ 80; client LOC ≈ 60.
- The separate-channel alternative duplicates the entire ask_user pipeline — new events, new server-state slice, new browser→bridge message, new bridge-side promise registry. ≈ 400 LOC and three new wire-protocol message types.
- Reconnect replay falls out for free under Option A (PromptBus already serializes pending requests for reconnect).
- Concurrency / cancellation / timeout already handled by PromptBus.

**Consequence:** This change does NOT introduce `flow_ask_user` / `flow_ask_user_cancelled` / `flow_ask_user_response` as new wire-protocol message types. The proposal's "What Changes" list naming of these is **superseded by this design decision** — they were the Option-B framing. The capability stays named `flow-question-routing` but its requirements are written against the PromptBus-metadata path.

**Side effect on proposal:** `flow-event-bridge`'s modified-capability scope shrinks to "the bridge SHALL forward `metadata` field on `prompt_request` messages unchanged" (which it already does — confirmed in `bridge.ts:1252`). May reduce to zero changes if existing behavior already satisfies the requirement; in that case the modified capability is dropped from specs.

### Decision 2: Component type `flow-question`, placement `widget-bar`

**Choice:** Register a new prompt component type `flow-question` in `prompt-component-registry.ts` with `placement: "widget-bar"`. The flows-plugin client side hooks into widget-bar rendering when component type is `flow-question` and routes the prompt through FlowDashboard's content-header-sticky claim instead.

**Why `widget-bar`:** It already means "render outside the chat stream, in the upper area." `architect-prompt` is the existing precedent. ChatView already skips `widget-bar`-placed prompts via `isWidgetBarPrompt(componentType)`. No new placement enum value needed.

**Alternative considered:** New placement `"flow-upper-slot"`. Rejected — requires extending the placement enum in three places (PromptBus, client registry, shell ChatView dispatch) and offers no functional benefit over `widget-bar` since FlowDashboard already owns the upper-slot real estate.

### Decision 3: Render via FlowDashboard, NOT a generic widget-bar component

**Choice:** When a `flow-question` component arrives, do NOT render it as a standalone top-of-screen card. Instead, the flows-plugin reducer captures the pending prompt (from the `prompt_request` event) and surfaces it inside `FlowDashboard` (above the agent grid). The flow plugin renders the question card itself, using the existing prompt component renderers (`<Confirm>`/`<Select>`/`<Multiselect>`/`<Input>`) but inside the flow's visual frame.

**Why:** The question is contextually a flow event — it belongs visually nested with the flow visualization (flow name, step indicator, agent grid). A free-floating widget-bar card would feel disconnected from the flow it belongs to.

**Mechanism:** flows-plugin registers a widget-bar slot handler for `flow-question` that returns `null` from the top-level widget-bar position (effectively suppressing the standalone render) and writes the prompt into a flow-reducer slice keyed by `flowId`. FlowDashboard reads that slice and renders the question inline within its own frame.

**Alternative considered:** Render the question in the widget-bar AND have FlowDashboard reach into the widget-bar via portal. Rejected — bidirectional reach is fragile.

### Decision 4: Concurrency — FIFO queue per flow, one visible at a time

**Choice:** flow-reducer maintains `pendingFlowQuestions: PromptRequest[]` keyed by flow id. The head is rendered; the tail shows as a small "+N more" badge in the question card. When the head is answered, it's shifted off and the next becomes the head.

**Why FIFO:** Predictable ordering matches the producer's `await ctx.ui...` semantics (the call site that fires first gets answered first). Stack semantics (LIFO) would surprise the producer because the latest call would be answered while earlier `await`s remain pending — confusing for parallel agent steps.

**Why per-flow:** Multiple flows in the same session (e.g., sub-flows) get independent queues. The FlowDashboard's existing tab bar already distinguishes flows; each tab's question card is independent.

**Trade-off:** A flow step calling `ctx.ui.confirm` twice in a row (sequentially in one agent) is degenerate but supported — the second call replaces the first only after the first resolves, exactly like the existing PromptBus behavior.

### Decision 5: Suppression in chat — driven by component type, not metadata sniffing

**Choice:** `AskUserToolRenderer` and `SessionCard`'s pulse logic SHALL skip rendering when the corresponding prompt has component type `flow-question` (looked up via the existing prompt-request slot already plumbed into session state). They MUST NOT pattern-match on `metadata.flowId` directly.

**Why:** Component type is the single source of truth for "where does this render." Metadata is a tag bag and other producers might use `flowId` for unrelated reasons. Keying off component type aligns with the existing `isWidgetBarPrompt(componentType)` check.

### Decision 6: Producer change shape (informational; not enforced by this change)

The pi-flows producer cannot modify `ctx.ui` itself, but it controls `extensions/flow-engine/tools/ask-user.ts` and the flow execution loop. Two viable shapes:

- **Shape A: thread-local flow context.** The flow execution module sets a module-level "current flow" before invoking each agent step and clears it after. The flow's wrapped `ask_user` tool reads that context and attaches metadata to the PromptBus request. Requires a tiny wrap layer over `ctx.ui` to inject metadata.
- **Shape B: pi-flows-internal `ctx.ui` shim.** Replace `ctx.ui` references inside the flow engine with a `flowCtx.ui` that wraps the underlying ctx and adds metadata. Producer-internal refactor; cleaner, but more code touched.

This design recommends Shape A for the smallest producer diff. The dashboard side is shape-agnostic — both produce the same `metadata: { flowId, stepId }` on the wire.

## Risks / Trade-offs

- **[Risk] PromptBus adapter ordering.** If the flow adapter is registered AFTER `DashboardDefaultAdapter`, the default adapter's `generic-dialog` claim wins and the question still renders in chat.
  → **Mitigation:** Adapter registration in `bridge.ts` follows declarative order. Add a code comment + unit test asserting `FlowQuestionAdapter` registers before `DashboardDefaultAdapter`. The lint test should fail if order is swapped.

- **[Risk] Pi-flows ships independently; users may run mismatched versions.** A new dashboard with old pi-flows: producer doesn't tag prompts, no metadata, fallback to chat — works as today. Old dashboard with new pi-flows: dashboard ignores `metadata.flowId`, renders via default adapter — works as today.
  → **Mitigation:** Additive design is sufficient; both directions degrade gracefully. Cross-repo coordination is purely about *adoption*, not correctness.

- **[Risk] Flow question renderers must match the inputs of the four ask_user methods.** If we miss a method (e.g., `multiselect`), the user sees a broken card.
  → **Mitigation:** The existing prompt component renderers already handle all four. We reuse them, not reimplement. Test: render each of confirm/select/multiselect/input via the FlowDashboard surface.

- **[Risk] A flow can issue an `ask_user` from an extension other than pi-flows' own tools.** If a flow agent calls a different tool that internally calls `ctx.ui.confirm`, that call has no flow context unless the wrap layer propagates it.
  → **Mitigation:** Shape A (thread-local flow context, see Decision 6) covers this transparently if pi-flows patches `ctx.ui` at the runtime level for the duration of agent execution. Shape B doesn't. Document this in the cross-repo task list.

- **[Trade-off] Reusing `widget-bar` placement vs adding a `flow-upper-slot` placement.** We chose to reuse — the cost is conceptual overloading: `widget-bar` now means "render either as a standalone widget-bar card OR as a flow-plugin-internal element." The benefit: no new placement enum value, no new ChatView suppression path. Net win: less code, slightly muddier semantics.

- **[Trade-off] No new wire-protocol message types vs the proposal's stated additions.** Decision 1 supersedes the proposal's `flow_ask_user` / `flow_ask_user_cancelled` / `flow_ask_user_response` framing. The capability spec (`flow-question-routing`) needs to be written against the PromptBus-metadata path, not the separate-channel path. Reviewer must read design before specs.

## Migration Plan

This is an additive feature. No migration of existing data or sessions. Rollout order:

1. **Land dashboard side first.** New `FlowQuestionAdapter`, new client component-type registration, FlowDashboard renders pending question, AskUserToolRenderer + SessionCard suppression. Without pi-flows producing metadata, this is invisible to users.
2. **Land pi-flows producer change** (separate repo, separate PR). Metadata starts flowing on the wire. Dashboard surfaces the question in the upper slot.
3. **No rollback needed for dashboard alone.** If the pi-flows producer is reverted, the dashboard adapter sees no metadata and the default adapter handles all asks → identical to pre-change behavior.

If the dashboard side needs to be rolled back after pi-flows has shipped: pi-flows still works; questions just render in chat again (degraded UX, not broken).

## Open Questions

- **Should `flow-question` component live in the prompt-component-registry as a built-in, or be registered at flow-plugin client init time?** Built-in is simpler (no init order concerns). Plugin-registered is cleaner (the registry stays generic). Lean: plugin-registered, because the renderer logic for "route into FlowDashboard" is plugin-specific anyway.
- **Should the question card show the flow step name?** The producer has `stepId` but not necessarily the step's human-readable label. If pi-flows ships `stepLabel` in metadata, we show it. If not, we show `stepId`. Producer decides.
- **What happens to a pending flow question if the user manually clicks "Abort Flow"?** Expected: the abort sends `flow_control { action: "abort" }`, the producer's `ctx.ui` promise gets cancelled by pi-flows' abort handling, PromptBus.cancel fires, the FlowDashboard question card disappears. Confirm this end-to-end in the producer-side change, not here.
- **Telemetry / observability?** No metrics for first cut. If question dwell time matters, add later.
