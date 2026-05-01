## ADDED Requirements

### Requirement: Dashboard multiselect prompts SHALL NOT be auto-dismissed by an in-process TUI adapter

The PromptBus adapter set registered by the bridge extension MUST NOT include any adapter that synthesizes a non-`dashboard-default` `bus.respond({ ... })` call within one event-loop tick of receiving a `prompt.type === "multiselect"` request, when the response is derived from a synchronous-immediate resolution of an `ExtensionUIContext.custom` (or any other primitive that is a no-op in pi 0.70 RPC mode).

The PromptBus's first-response-wins semantics interpret `bus.respond({ cancelled: true, source: <non-dashboard> })` as "another adapter answered this prompt, dismiss the dashboard renderer". A TUI-adapter arm that synthesizes such a response from a no-op primitive will reliably auto-dismiss the dashboard's `MultiselectRenderer` before the user can interact with it, producing the user-visible "Answered in terminal" greyed-out state observed during the failure mode that motivated this requirement.

This requirement is satisfied today by a single decision: the bridge extension does not register a TUI multiselect arm at all (see `bridge-extension` capability's "Bridge SHALL NOT register a TUI multiselect arm that consumes `originals.custom`" requirement). Future adapters (custom extensions, pi-flows, etc.) that wish to participate in multiselect prompts MAY register, but they MUST NOT respond synchronously-cancelled within one tick of `onRequest`.

#### Scenario: Dashboard multiselect prompt remains pending until user interaction
- **WHEN** the agent invokes `ask_user` with `method: "multiselect"` on a dashboard headless session (pi `--mode rpc`)
- **AND** the bridge dispatches `bus.request({ type: "multiselect", ... })` to the PromptBus
- **AND** the user does NOT interact with the rendered dialog
- **THEN** the prompt SHALL remain in `status: "pending"` for at least the PromptBus default timeout window (300 seconds)
- **AND** no `prompt_dismiss` SHALL be emitted to the browser
- **AND** the `MultiselectRenderer` SHALL continue to display the checkbox UI

#### Scenario: User Submit click round-trips through the bus
- **WHEN** a multiselect dialog is pending and the user checks two options and clicks Submit
- **THEN** the client emits `prompt_response { answer: '["opt1","opt3"]', cancelled: false, source: "dashboard-default" }`
- **AND** the bridge's `decodeMultiselectAnswer` returns `["opt1", "opt3"]`
- **AND** `polyfillMultiselect` resolves with the array
- **AND** the agent receives `User responded: ["opt1","opt3"]` from `ask_user`'s tool result

#### Scenario: User Cancel click round-trips through the bus
- **WHEN** the user clicks Cancel on a pending multiselect dialog
- **THEN** the client emits `prompt_response { cancelled: true, source: "dashboard-default" }`
- **AND** `decodeMultiselectAnswer` returns `undefined`
- **AND** the agent receives `User responded: undefined`

#### Scenario: Pure-TUI session multiselect times out gracefully (acknowledged trade-off)
- **WHEN** a pure-TUI session (no dashboard attached) invokes `ask_user` with `method: "multiselect"`
- **AND** `ctx.ui.multiselect` is bus-patched but no dashboard adapter is registered to render the dialog
- **AND** no other adapter responds within the 5-minute PromptBus timeout
- **THEN** the bus SHALL cancel the prompt at the timeout boundary
- **AND** `decodeMultiselectAnswer` SHALL return `undefined`
- **AND** the agent SHALL receive `User responded: undefined` after the 5-minute wait
- **AND** this behaviour is the explicitly-accepted graceful degradation — pi 0.70 RPC mode's `ctx.ui.custom` is a no-op, so no working pure-TUI multiselect path exists in the codebase today

#### Scenario: Custom adapters MAY participate but MUST NOT auto-cancel synchronously
- **WHEN** a future extension (e.g. pi-flows) registers a PromptBus adapter for `prompt.type === "multiselect"`
- **AND** that adapter's `onRequest` returns a `PromptClaim` that intends to render in some external UI
- **THEN** the adapter MAY call `bus.respond(...)` after a real user interaction
- **AND** the adapter MUST NOT call `bus.respond({ cancelled: true, source: <name> })` within one event-loop tick of `onRequest` based on a synchronous-immediate resolution of a pi UI primitive that is documented as a no-op in the active pi mode
