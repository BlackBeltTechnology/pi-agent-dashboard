## ADDED Requirements

### Requirement: Bridge SHALL patch `ctx.ui.multiselect` alongside select/input/confirm/editor

The bridge extension's `session_start` PromptBus patching block in `packages/extension/src/bridge.ts` (currently lines ~935-948) SHALL include an assignment of `multiselect` onto `ctx.ui`, parallel to the existing `select`, `input`, `confirm`, and `editor` patches. Omitting this assignment is the regression that caused the dashboard multiselect to silently auto-cancel — the `polyfillMultiselect` helper consults `ctx.ui.multiselect` as its primary path, and without the patch it falls into a TUI-only `ctx.ui.custom` branch that does not render a browser dialog in dashboard / RPC mode.

The assignment MUST issue `bus.request` with `type: "multiselect"` and decode the response per the rules in the `multiselect-dialog` capability ("Bridge routes `ctx.ui.multiselect` through PromptBus" requirement). The decode helper (referred to here as `decodeMultiselectAnswer`) SHALL be a pure function over `{ cancelled, answer }` so it can be exercised in unit tests without instantiating a live PromptBus.

If `(ctx.ui as any).multiselect` is already a function before the patch runs (defensive — covers future upstream additions to pi's `ExtensionUIContext`), the bridge SHALL emit a one-time `console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing")` and proceed with the assignment. The override is intentional: even if pi later ships a built-in `ctx.ui.multiselect`, the bridge's bus-routed version is the one that participates in PromptBus's first-response-wins semantics.

#### Scenario: Patch block assigns ctx.ui.multiselect
- **WHEN** the bridge's `session_start` handler runs through the PromptBus patching block on a stub `ctx`
- **THEN** `typeof ctx.ui.multiselect === "function"` SHALL be true after the block completes

#### Scenario: Patched method dispatches the correct bus.request
- **WHEN** an extension calls `ctx.ui.multiselect("Pick", ["a","b"], { message: "ctx" })` after the patch
- **THEN** `bus.request` SHALL be called with `{ pipeline: "command", type: "multiselect", question: "Pick", options: ["a","b"], metadata: { message: "ctx" } }`

#### Scenario: Decode helper handles all four response shapes
- **WHEN** `decodeMultiselectAnswer({ cancelled: true })` is called → SHALL return `undefined`
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: '["a","b"]' })` → SHALL return `["a","b"]`
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: "[]" })` → SHALL return `[]` (empty selection)
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: "not-json" })` → SHALL return `[]` (graceful degradation, no throw)

#### Scenario: Pre-existing ctx.ui.multiselect triggers a warning, not an error
- **WHEN** the bridge's patch block runs against a `ctx` whose `ui.multiselect` is already a function
- **THEN** `console.warn` SHALL be called with a message containing `"already exists"`
- **AND** the patch SHALL still complete (the bus-routed version replaces the prior assignment)
- **AND** subsequent calls to `ctx.ui.multiselect(...)` SHALL flow through `bus.request`, not the prior implementation
