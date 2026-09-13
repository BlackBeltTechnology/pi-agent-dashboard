## MODIFIED Requirements

### Requirement: Bridge routes `ctx.ui.multiselect` through PromptBus

The bridge extension SHALL assign a `multiselect` method onto `ctx.ui` immediately after the existing `select` / `input` / `confirm` / `editor` PromptBus patching block of the bridge extension. The assignment SHALL invoke `bus.request({ pipeline: "command", type: "multiselect", question: title, options, metadata: opts?.message ? { message: opts.message } : undefined })` and decode the resolved `PromptResponse` as follows:

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
