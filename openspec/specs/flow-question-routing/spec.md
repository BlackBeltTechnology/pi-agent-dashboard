# flow-question-routing Specification

## Purpose
TBD - created by archiving change route-flow-asks-to-upper-slot. Update Purpose after archive.
## Requirements
### Requirement: `PromptAdapter.priority` orders adapter participation

The `PromptAdapter` interface in `packages/extension/src/prompt-bus.ts` SHALL accept an optional `priority?: number` field. Default value is 1000; lower numbers run first. `PromptBus.registerAdapter` SHALL maintain its internal adapter array in priority order via a stable sort; equal priorities preserve insertion order. The first adapter whose `onRequest` returns a non-null `PromptClaim` with a `component` wins dashboard rendering (existing first-match semantic in `PromptBus.request()`).

`DashboardDefaultAdapter.priority` SHALL be `9999` (last-resort fallback). Any plugin adapter with the default priority (1000) or lower beats the default adapter automatically; plugins do not need to know the default adapter's priority value beyond "less than 9999".

The field is OPTIONAL on the interface. Existing third-party `PromptAdapter` implementations that do not declare `priority` SHALL behave as if `priority: 1000`.

#### Scenario: Lower priority claims first

- **GIVEN** PromptBus has registered two adapters: `A` with `priority: 100` and `B` with `priority: 1000`, in that order
- **AND** both return non-null claims with `component` on `onRequest`
- **THEN** `B` SHALL NOT win the component slot

#### Scenario: Default adapter is last-resort

- **GIVEN** PromptBus has registered `DashboardDefaultAdapter` (priority 9999) and another adapter `X` (priority undefined)
- **WHEN** a prompt arrives that `X.onRequest` returns a non-null claim for
- **THEN** `X`'s claim SHALL win
- **AND** `DashboardDefaultAdapter`'s `generic-dialog` claim SHALL be ignored for that prompt

#### Scenario: Default-priority insertion order preserved

- **GIVEN** two adapters `M` and `N` are both registered with no `priority` (default 1000), `M` first
- **THEN** iteration order SHALL be `M, N` (stable sort preserves insertion order at equal priority)

### Requirement: Flows-plugin ships a bridge entry with `FlowQuestionAdapter`

The flows-plugin manifest (`packages/flows-plugin/package.json`'s `pi-dashboard-plugin` block) SHALL declare a `"bridge"` field pointing at the plugin's pi-extension bridge entry. The bridge entry SHALL:

- On activation, instantiate `FlowQuestionAdapter` and emit it via `pi.events.emit("prompt:register-adapter", adapter)`.
- Do nothing else flow-specific — no flow-event-bridge subscription, no state mirroring. The adapter is the only contribution.

`FlowQuestionAdapter` SHALL:

- Have `name: "flow-question"` and `priority: 100`.
- Return a `PromptClaim` with `component: { type: "flow-question", props: { flowId, stepId, question, type, options?, defaultValue? } }` and `placement: "widget-bar"` WHEN `prompt.metadata?.flowId` is a non-empty string.
- Return `null` for prompts without `metadata.flowId` (deferring to the next adapter).
- Implement `onResponse` and `onCancel` as no-ops (no adapter-owned UI to dismiss).

The dashboard's main bridge SHALL NOT contain any flow-specific adapter or import. The only changes to `packages/extension/` for this capability are the generic `PromptAdapter.priority` primitive and the default adapter's priority value.

#### Scenario: Manifest declares bridge entry

- **WHEN** the manifest validator processes `packages/flows-plugin/package.json`'s `pi-dashboard-plugin` block
- **THEN** the validated manifest SHALL have a non-empty `bridge` field
- **AND** the file at that path SHALL exist when the loader resolves it

#### Scenario: Bridge auto-registers via existing discovery

- **GIVEN** the dashboard server starts and runs `discoverPlugins → registerAllPluginBridges`
- **WHEN** the flows-plugin is enabled
- **THEN** the bridge path SHALL be written into pi's `~/.pi/agent/settings.json` under `dashboardPluginBridges["dashboard-flows"]` and mirrored into `packages[]`
- **AND** pi SHALL load it as an extension on the next session start

#### Scenario: Adapter claims flow-tagged prompt

- **WHEN** a `PromptRequest` arrives at the bus with `metadata.flowId = "my-flow"` and `metadata.stepId = "s1"`
- **THEN** `FlowQuestionAdapter.onRequest(prompt)` SHALL return `{ component: { type: "flow-question", props: { flowId: "my-flow", stepId: "s1", ... } }, placement: "widget-bar" }`
- **AND** the bus's first-component-wins resolution SHALL pick this claim over `DashboardDefaultAdapter`'s `generic-dialog` claim

#### Scenario: Adapter declines untagged prompt

- **WHEN** a `PromptRequest` arrives without `metadata.flowId`
- **THEN** `FlowQuestionAdapter.onRequest(prompt)` SHALL return `null`
- **AND** the default adapter SHALL win (rendering inline in chat)

### Requirement: Client registers `flow-question` component type

The flows-plugin's client entry SHALL call `registerPromptComponent({ type: "flow-question", placement: "widget-bar" })` at module load time. Re-registration (HMR, remount) SHALL replace any prior entry without throwing.

#### Scenario: Component type registered at plugin init

- **WHEN** the flows-plugin client module loads in the dashboard
- **THEN** `getPromptComponentInfo("flow-question")` SHALL return `{ type: "flow-question", placement: "widget-bar" }`

#### Scenario: Component type stays registered across reloads

- **WHEN** the flows-plugin client module is loaded multiple times (HMR or remount)
- **THEN** subsequent registrations of `flow-question` SHALL replace prior entries without throwing

### Requirement: FlowDashboard renders the head of the per-flow question queue

The flows-plugin reducer SHALL maintain, per flow id, a FIFO queue of pending `flow-question` prompts. When a `prompt_request` arrives whose component type is `flow-question`, the reducer SHALL append it to the queue keyed by `props.flowId`. When a corresponding `prompt_dismiss`, `prompt_cancel`, or `prompt_response` arrives for the same prompt id, the reducer SHALL remove it from the queue.

`FlowDashboard` SHALL render the head element of the queue for the currently-displayed flow tab as a question card inside its `content-header-sticky` frame, above the agent grid. The card SHALL use the standard prompt component renderers for confirm/select/multiselect/input. When the queue depth exceeds 1, the card SHALL show a "+N more queued" badge.

#### Scenario: Pending question rendered in FlowDashboard

- **WHEN** a `prompt_request` arrives with component type `flow-question` and `props.flowId` equal to the active flow tab
- **THEN** the FlowDashboard SHALL display a question card showing the question text and the appropriate input affordance for the prompt's `type`

#### Scenario: Question card disappears after response

- **WHEN** the user submits an answer via the question card
- **THEN** the card SHALL be removed from the FlowDashboard immediately (optimistically)
- **AND** a `prompt_response` SHALL be sent via `usePluginSend`
- **AND** when the corresponding `prompt_dismiss` confirmation arrives, the head SHALL already be gone (idempotent)

#### Scenario: Second question waits behind the first

- **WHEN** a second `prompt_request` with component type `flow-question` and the same `props.flowId` arrives while a prior question is still pending
- **THEN** the second prompt SHALL be appended to the queue
- **AND** the visible head SHALL not change
- **AND** the card SHALL show a "+1 more queued" badge

#### Scenario: Queue is per-flow

- **WHEN** two flows in the same session each issue a `flow-question` concurrently
- **THEN** each flow's tab SHALL show its own head element
- **AND** the queue-depth badges SHALL count only that flow's queue

### Requirement: Cancellation clears the queue entry

When PromptBus cancels a pending prompt (timeout, flow abort, manual `prompt_cancel`), the corresponding `flow-question` queue entry SHALL be removed from the per-flow queue. If the cancelled prompt was the head, the next queued prompt SHALL become the new head.

#### Scenario: Flow abort cancels pending question

- **WHEN** the user clicks "Abort" on a flow that has a pending `flow-question`
- **THEN** PromptBus SHALL cancel the prompt, the bridge SHALL send `prompt_cancel`
- **AND** the FlowDashboard question card SHALL disappear

#### Scenario: Timeout cancels pending question

- **WHEN** a flow question's PromptBus timeout fires before the user answers
- **THEN** `prompt_cancel` SHALL be sent
- **AND** the queue entry SHALL be removed
- **AND** the producer's awaiting `ctx.ui` promise SHALL resolve with the bus's standard `{ cancelled: true }` shape

### Requirement: Producer attaches flow context to PromptBus requests

When pi-flows invokes a user prompt (`ctx.ui.confirm`, `ctx.ui.input`, `ctx.ui.select`, `ctx.ui.multiselect`) from inside a running flow step, the resulting `PromptRequest` SHALL carry `metadata: { flowId: string, stepId: string }` identifying the flow execution context. The dashboard SHALL NOT require any field beyond `flowId` to perform routing; `stepId` is informational for the rendered card.

This producer-side requirement is tracked here for capability completeness; the implementation lives in the `pi-flows` repository and ships independently.

#### Scenario: Flow-originated confirm prompt carries metadata

- **WHEN** pi-flows invokes `ctx.ui.confirm("Proceed?")` from inside a flow step with id `step-1` belonging to flow `my-flow`
- **THEN** the resulting `PromptRequest` on PromptBus SHALL have `metadata.flowId === "my-flow"` and `metadata.stepId === "step-1"`

#### Scenario: Session-level prompt outside any flow carries no flow metadata

- **WHEN** a non-flow extension or the user (via free-form chat) triggers an `ask_user` call
- **THEN** the resulting `PromptRequest` SHALL NOT have `metadata.flowId` set
- **AND** the prompt SHALL fall through to the default chat adapter unchanged

### Requirement: Backward compatibility — degrade to chat when either side is unaware

The routing SHALL be additive on both producer and consumer sides:

- If the producer (pi-flows) is older and does NOT attach `metadata.flowId`, the FlowQuestionAdapter SHALL decline (per scenario above), and the prompt SHALL render in chat as before.
- If the consumer (dashboard) is older and does NOT have the flows-plugin enabled (or the plugin's bridge entry hasn't loaded), no FlowQuestionAdapter is registered; the prompt SHALL still resolve via the default adapter and render in chat. The metadata field is ignored.

#### Scenario: Old pi-flows with new dashboard

- **WHEN** pi-flows emits a flow `ask_user` without `metadata.flowId`
- **THEN** `FlowQuestionAdapter` SHALL decline, the default adapter SHALL claim
- **AND** the question SHALL render inline in chat

#### Scenario: New pi-flows with flows-plugin disabled

- **WHEN** pi-flows emits a flow-tagged prompt to a dashboard whose flows-plugin is disabled (no bridge entry registered)
- **THEN** only the default adapter SHALL claim
- **AND** the question SHALL render inline in chat as a `generic-dialog`
- **AND** the producer's `ctx.ui` promise SHALL resolve normally when the user answers in chat

### Requirement: Chat suppresses widget-bar placed prompts

The dashboard chat view (`packages/client/src/components/ChatView.tsx`) SHALL NOT render an `<InteractiveUiCard>` for a message of role `interactiveUi` whose `params._promptBusComponent.type` resolves to a widget-bar placement via `isWidgetBarPrompt(componentType)` from the prompt-component registry. This applies to BOTH pending and resolved prompts.

The shell SHALL NOT pattern-match on specific component-type literals
(e.g. `"flow-question"`); it SHALL use only the placement-based
generic primitive.

#### Scenario: Flow-question prompt suppressed from chat

- **GIVEN** a session whose chat stream contains an `interactiveUi`
  message whose `params._promptBusComponent.type === "flow-question"`
  (registered with `placement: "widget-bar"`)
- **WHEN** the chat view renders
- **THEN** the `interactiveUi` message SHALL NOT produce an
  `<InteractiveUiCard>` in the rendered DOM

#### Scenario: Generic-dialog prompt still renders in chat

- **GIVEN** a session whose chat stream contains an `interactiveUi`
  message whose `params._promptBusComponent.type === "generic-dialog"`
  (registered with `placement: "inline"`)
- **WHEN** the chat view renders
- **THEN** the `interactiveUi` message SHALL render an
  `<InteractiveUiCard>` as before

#### Scenario: Suppression applies after the answer too

- **GIVEN** a flow-question prompt that was answered (status =
  `"resolved"`)
- **WHEN** the user scrolls back through chat to where the prompt
  previously appeared
- **THEN** the chat SHALL NOT contain an `<InteractiveUiCard>` for
  that prompt

### Requirement: Flow-question slot renders a transcript

`FlowQuestionsSection` (the slot consumer mounted by `FlowDashboard`) SHALL render every flow-question prompt for the active flow tab — both pending and answered — capped at the most recent N (default 10).

- Pending entries render as a full interactive card with input
  affordances (confirm / select / multiselect / input).
- Non-pending entries (status `resolved`, `cancelled`, `dismissed`)
  render as a collapsed pill showing the question text, the answer
  (when resolved), and a status icon.

Order: insertion order over the session's lifetime, oldest first.

#### Scenario: Answered question stays visible in slot

- **GIVEN** the user has answered a flow-question prompt
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the answered prompt SHALL appear as a collapsed pill in the
  transcript
- **AND** the pill SHALL show the question text plus the user's answer

#### Scenario: Pending question still rendered as full card

- **GIVEN** a flow-question prompt with status `pending`
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the prompt SHALL render as a full interactive card with the
  appropriate input affordance for the prompt's `type`

#### Scenario: Transcript capped at N entries

- **GIVEN** more than 10 flow-question prompts exist for the active flow
- **WHEN** the transcript renders
- **THEN** only the most recent 10 SHALL be visible
- **AND** older entries SHALL be omitted (no scroll-back inside the
  slot for now)

