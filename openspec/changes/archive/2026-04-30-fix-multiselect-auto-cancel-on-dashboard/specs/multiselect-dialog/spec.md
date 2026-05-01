## REMOVED Requirements

### Requirement: UI proxy multiselect forwarding
**Reason:** The `ui-proxy` was replaced by `PromptBus` in an earlier (un-archived) refactor — see `packages/extension/src/bridge.ts:290` ("Legacy extension_ui_response removed — now handled by prompt_response → promptBus.respond()") and `packages/extension/src/prompt-bus.ts` ("Replaces the ui-proxy race pattern."). The original ui-proxy routing wrappers no longer exist in the codebase; this requirement describes a code path that has been deleted.

**Migration:** Replaced by the new "Bridge routes ctx.ui.multiselect through PromptBus" requirement below, which expresses the same end-to-end behavior in PromptBus terms.

### Requirement: UI proxy extracts multiselect result
**Reason:** Same as above — the `extractResult` function lived inside the deleted ui-proxy. PromptBus now carries the answer end-to-end as a `string` `answer` field on `PromptResponse`, with the values array JSON-encoded by the renderer-response encoder and JSON-decoded by the bridge wrapper.

**Migration:** Replaced by the new "Bridge decodes multiselect answer as JSON-stringified string array" and "Dashboard encoder JSON-stringifies multiselect values" requirements below.

## ADDED Requirements

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
