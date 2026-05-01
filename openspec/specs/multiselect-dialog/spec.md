## ADDED Requirements

### Requirement: ask_user tool supports multiselect method
The `ask_user` tool SHALL accept `multiselect` as a valid `method` value. When `method` is `multiselect`, the tool SHALL require `title` (string) and `options` (string array) parameters. The tool SHALL return the user's selected items as an array of strings.

#### Scenario: LLM calls ask_user with multiselect
- **WHEN** the LLM calls `ask_user` with `method: "multiselect"`, `title: "Pick files"`, and `options: ["a.ts", "b.ts", "c.ts"]`
- **THEN** the tool SHALL present the options to the user and return `User responded: ["a.ts", "c.ts"]` (the items the user selected)

#### Scenario: User selects no options
- **WHEN** the user submits the multiselect dialog without selecting any options
- **THEN** the tool SHALL return `User responded: []` (empty array)

### Requirement: MultiselectRenderer component
The dashboard SHALL include a `MultiselectRenderer` component registered for the `multiselect` method. The renderer SHALL display each option as a toggleable checkbox row. A "Submit" button SHALL confirm the selection.

#### Scenario: Pending multiselect displays checkboxes
- **WHEN** a multiselect dialog is pending
- **THEN** the renderer SHALL display the title, one checkbox per option, and Submit/Cancel buttons

#### Scenario: User toggles and submits
- **WHEN** the user checks "a.ts" and "c.ts" then clicks Submit
- **THEN** the renderer SHALL call `onRespond` with `{ values: ["a.ts", "c.ts"] }`

#### Scenario: User cancels multiselect
- **WHEN** the user clicks Cancel on a pending multiselect
- **THEN** the renderer SHALL call `onCancel`

#### Scenario: Resolved multiselect shows summary
- **WHEN** the multiselect dialog is resolved
- **THEN** the renderer SHALL display a compact summary showing the title and the selected values

#### Scenario: Cancelled multiselect shows cancelled state
- **WHEN** the multiselect dialog was cancelled
- **THEN** the renderer SHALL display the title with "Cancelled" label

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

### Requirement: Bridge routes `ctx.ui.multiselect` through PromptBus

The bridge extension SHALL assign a `multiselect` method onto `ctx.ui` immediately after the existing `select` / `input` / `confirm` / `editor` PromptBus patching block in `packages/extension/src/bridge.ts`. The assignment SHALL invoke `bus.request({ pipeline: "command", type: "multiselect", question: title, options, metadata: opts?.message ? { message: opts.message } : undefined })` and decode the resolved `PromptResponse` as follows:

- `cancelled: true` → resolve to `undefined` (signals user cancellation).
- `cancelled: false` AND `answer` is a JSON-encoded `string[]` → resolve to the parsed array.
- `cancelled: false` AND `answer` is `null` / empty / unparseable → resolve to `[]` (empty selection, *not* cancellation).

The patching MUST be additive — if `ctx.ui.multiselect` is already a function before the assignment, the bridge SHALL log a one-time warning (so future upstream additions to pi's `ExtensionUIContext` are visible) and proceed with the assignment.

#### Scenario: ctx.ui.multiselect dispatches a bus request with the right shape
- **WHEN** the bridge's PromptBus patching block runs against a session context
- **AND** an extension calls `ctx.ui.multiselect("Pick", ["a", "b", "c"], { message: "ctx" })`
- **THEN** `bus.request` SHALL be invoked exactly once with `{ pipeline: "command", type: "multiselect", question: "Pick", options: ["a", "b", "c"], metadata: { message: "ctx" } }`

#### Scenario: ctx.ui.multiselect resolves successful selection
- **WHEN** `bus.request` resolves to `{ id, cancelled: false, answer: '["a","c"]', source: "dashboard-default" }`
- **THEN** the `ctx.ui.multiselect(...)` call SHALL resolve to `["a", "c"]`

#### Scenario: ctx.ui.multiselect resolves empty selection as []
- **WHEN** `bus.request` resolves to `{ id, cancelled: false, answer: "[]", source: "dashboard-default" }`
- **THEN** the call SHALL resolve to `[]` (empty selection is a valid, distinct-from-cancellation answer)

#### Scenario: ctx.ui.multiselect resolves cancellation as undefined
- **WHEN** `bus.request` resolves to `{ id, cancelled: true, source: "dashboard-default" }`
- **THEN** the call SHALL resolve to `undefined`

#### Scenario: ctx.ui.multiselect degrades gracefully on unparseable answer
- **WHEN** `bus.request` resolves to `{ id, cancelled: false, answer: "not-json", source: "dashboard-default" }`
- **THEN** the call SHALL resolve to `[]` and SHALL NOT throw

### Requirement: Dashboard encoder JSON-stringifies multiselect `values`

`packages/client/src/hooks/useSessionActions.ts`'s `handleRespondToUi` SHALL, when the renderer's `result` is an object with a `values` array (the `MultiselectRenderer`'s `onRespond({ values: string[] })` shape), encode the answer as `JSON.stringify(result.values)` in the emitted `prompt_response.answer` field. The encoder MUST distinguish empty selection (`answer: "[]"`, NOT `""` and NOT `undefined`) from cancellation (`cancelled: true`, `answer: undefined`), because the bridge wrapper's decoder uses the cancelled flag — not answer-shape — to decide between `undefined` and `[]`.

The existing `value` (select/input/editor) and `confirmed` (confirm) shapes MUST continue to encode unchanged. Encoding precedence is: `Array.isArray(result.values)` → JSON-stringify values; else `result.value !== undefined` → use `result.value`; else `result.confirmed?.toString()`.

#### Scenario: Multiselect with two values
- **WHEN** `handleRespondToUi("req-1", { values: ["a", "b"] })` is called
- **THEN** the emitted `prompt_response` SHALL have `answer: '["a","b"]'` and `cancelled: undefined`

#### Scenario: Multiselect with empty selection
- **WHEN** `handleRespondToUi("req-1", { values: [] })` is called
- **THEN** the emitted `prompt_response` SHALL have `answer: "[]"` (NOT `""`, NOT `undefined`) and `cancelled: undefined`

#### Scenario: Multiselect cancellation
- **WHEN** `handleRespondToUi("req-1", undefined, true)` is called
- **THEN** the emitted `prompt_response` SHALL have `answer: undefined` and `cancelled: true`

#### Scenario: Existing select shape unchanged
- **WHEN** `handleRespondToUi("req-1", { value: "X" })` is called
- **THEN** the emitted `prompt_response` SHALL have `answer: "X"` (regression guard for SelectRenderer)

#### Scenario: Existing confirm shape unchanged
- **WHEN** `handleRespondToUi("req-1", { confirmed: true })` is called
- **THEN** the emitted `prompt_response` SHALL have `answer: "true"` (regression guard for ConfirmRenderer)

### Requirement: `polyfillMultiselect` prefers bridge-routed `ctx.ui.multiselect`

`packages/extension/src/multiselect-polyfill.ts`'s `polyfillMultiselect(ctx, title, options, opts)` SHALL first check whether `ctx.ui.multiselect` is a function and, if so, delegate to it (returning the same `Promise<string[] | undefined>`). Only when `ctx.ui.multiselect` is absent SHALL the polyfill fall back to the legacy `ctx.ui.custom` + `MultiSelectList` path. This keeps the polyfill compatible with both the bridge's PromptBus-routed primary path AND with non-bridge embeddings or older pi versions where the patch is not applied.

#### Scenario: Polyfill delegates to bridge-routed primitive when present
- **WHEN** `ctx.ui.multiselect` is a function and `polyfillMultiselect(ctx, "t", ["a","b"])` is called
- **THEN** `ctx.ui.multiselect("t", ["a","b"], undefined)` SHALL be invoked
- **AND** `ctx.ui.custom` SHALL NOT be invoked

#### Scenario: Polyfill falls back to TUI overlay when ctx.ui.multiselect is absent
- **WHEN** `ctx.ui.multiselect` is `undefined` and `polyfillMultiselect(ctx, "t", ["a","b"])` is called
- **THEN** `ctx.ui.custom` SHALL be invoked with a factory that constructs a `MultiSelectList`
- **AND** `done(["b"])` from the factory SHALL resolve the polyfill to `["b"]`

#### Scenario: Polyfill fallback signals cancellation as undefined
- **WHEN** the legacy fallback's factory invokes `done(undefined)` (Escape pressed)
- **THEN** the polyfill's promise SHALL resolve to `undefined`
