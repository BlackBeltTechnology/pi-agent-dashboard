## MODIFIED Requirements

### Requirement: Bridge SHALL NOT register a TUI multiselect arm that consumes `originals.custom`

The bridge extension's TUI PromptBus adapter (registered by the bridge extension when `ctx.hasUI === true`) MUST NOT contain an `else if (prompt.type === "multiselect" && ... originals.custom ...)` arm that calls `await originals.custom(...)` and uses its resolution to drive a `bus.respond(...)` call.

The reason: pi 0.70's RPC mode (used by every dashboard-spawned headless session) defines `ExtensionUIContext.custom` as an unconditional no-op:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
},
```

(source: `~/.nvm/.../@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js:150-152`)

Any TUI adapter arm that awaits `originals.custom(...)` in dashboard headless mode will therefore receive `undefined` synchronously (one event-loop tick), interpret it as cancellation, and call `bus.respond({ cancelled: true, source: "tui" })`. The PromptBus's first-response-wins semantics will then dismiss the dashboard's already-rendered `MultiselectRenderer` before the user can interact with it.

The bridge's `ctx.ui.multiselect` PromptBus patch (added by the predecessor change `fix-multiselect-auto-cancel-on-dashboard`) already routes multiselect through the bus to the `DashboardDefaultAdapter`, which renders a working browser dialog via the registered client `MultiselectRenderer`. No TUI adapter participation is needed for dashboard sessions, and pure-TUI sessions on pi 0.70 RPC have no working `ctx.ui.custom` path to participate through anyway. The TUI multiselect arm is therefore prohibited until pi-coding-agent restores `ctx.ui.custom` in RPC mode.

This requirement is enforced by a repository-level lint test (`packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`) that scans the bridge module owning the TUI PromptBus adapter and fails if the source contains the co-occurrence of `originals.custom` AND `prompt.type === "multiselect"`. Either substring alone is permitted — the prohibition is on the combination.

#### Scenario: Lint passes when `bridge.ts` does not contain the offending co-occurrence
- **WHEN** the lint test reads the source of the bridge module owning the TUI PromptBus adapter
- **AND** the source does NOT contain `originals.custom` and `prompt.type === "multiselect"` together
- **THEN** the lint test SHALL pass

#### Scenario: Lint fails if a contributor re-adds the TUI multiselect arm
- **WHEN** a future refactor adds back the `else if (prompt.type === "multiselect" && ... originals.custom)` arm
- **THEN** the lint test `no-tui-multiselect-arm-regression.test.ts` SHALL fail with a message that includes the file path, the matched lines, and a one-line pointer to this change name

#### Scenario: `originals.custom` capture without consumption is permitted
- **WHEN** the adapter module captures `originals.custom = ctx.ui.custom?.bind(ctx.ui)` (e.g., for a *different* future use that does not include `prompt.type === "multiselect"`)
- **THEN** the lint test SHALL pass — the prohibited pattern is the co-occurrence, not either substring alone

#### Scenario: `prompt.type === "multiselect"` outside the TUI adapter is permitted
- **WHEN** the adapter module references `type: "multiselect"` in the `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ type: "multiselect", ... })` patch
- **THEN** the lint test SHALL pass — that string is in the patch site, not in the TUI adapter, and is part of the working bus-routed primary path

### Requirement: Bridge SHALL patch `ctx.ui.multiselect` alongside select/input/confirm/editor

The bridge extension's `session_start` PromptBus patching block SHALL include an assignment of `multiselect` onto `ctx.ui`, parallel to the existing `select`, `input`, `confirm`, and `editor` patches. Omitting this assignment is the regression that caused the dashboard multiselect to silently auto-cancel — the `polyfillMultiselect` helper consults `ctx.ui.multiselect` as its primary path, and without the patch it falls into a TUI-only `ctx.ui.custom` branch that does not render a browser dialog in dashboard / RPC mode.

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

### Requirement: Bridge wires connection into slash-dispatch helper call sites
Both call sites of `tryDispatchExtensionCommand` (the bridge's `sessionPrompt` callback and `command-handler.ts`'s slash else-arm) SHALL pass the bridge's `ConnectionManager` as the `connection` argument.

In `command-handler.ts`'s slash else-arm (the test-shim path used when `options.sessionPrompt` is undefined), the `connection` argument MAY be undefined (e.g. unit tests without a real connection); the helper degrades to Path D as specified above.

#### Scenario: Bridge sessionPrompt passes connection
- **WHEN** the bridge's `sessionPrompt(text)` callback is invoked for an extension slash command in a headless RPC pi
- **THEN** `tryDispatchExtensionCommand` SHALL be called with `connection: <bridge's ConnectionManager>`
- **AND** Path C SHALL fire and emit `dispatch_extension_command` via the connection

#### Scenario: command-handler else-arm without connection
- **WHEN** `command-handler.ts`'s slash else-arm runs (in a unit test or non-bridge context) AND `options.sessionPrompt` is undefined AND `options.eventSink` is provided
- **THEN** `tryDispatchExtensionCommand` SHALL be called with `connection: undefined`
- **AND** the helper SHALL degrade to Path D for any extension slash command (no `dispatch_extension_command` emitted)
