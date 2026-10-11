## MODIFIED Requirements

### Requirement: Bridge does not call pi session-replacement APIs

The bridge extension SHALL NOT invoke `pi.newSession(...)`, `ctx.fork(...)`, or `ctx.switchSession(...)` from any code under `packages/extension/src/` (excluding `__tests__/`).

These three APIs trigger pi's session-replacement flow, which (per pi 0.69.0+) invalidates any captured pre-replacement `pi`/`ctx`/session-bound objects on next access. The bridge holds long-lived caches (`cachedCtx`, `cachedModelRegistry`, `cachedHasUI`, held by the bridge extension; `modelRegistry` in `provider-register.ts`) that depend on pi being the *only* originator of session replacement, so we can re-capture inside the resulting `session_start` handler (see the bridge extension's `pi.on("session_start", ...)` handler keying on `event.reason ∈ {"new","fork","resume"}`).

#### Scenario: Source-grep guard fails the build on a new replacement call
- **WHEN** any `.ts` file under `packages/extension/src/` (other than `__tests__/`) contains the literal substring `pi.newSession(`, `ctx.fork(`, or `ctx.switchSession(`
- **THEN** the test `packages/extension/src/__tests__/no-session-replacement-calls.test.ts` SHALL fail with the offending file:line

#### Scenario: Allowed within tests
- **WHEN** the same substrings appear under `packages/extension/src/__tests__/` (e.g. mocking pi for a unit test)
- **THEN** the guard test SHALL ignore them

### Requirement: Bridge cached session state is session-scoped

`cachedCtx`, `cachedModelRegistry`, and `cachedHasUI` held by the bridge extension, and the `modelRegistry` reference in `provider-register.ts`, SHALL be treated as session-scoped. They SHALL be re-captured in every `session_start` handler invocation (regardless of `event.reason`) and SHALL NOT be read after `session_shutdown` for that session has fired.

#### Scenario: session_start re-captures ctx and modelRegistry
- **WHEN** `pi.on("session_start", ...)` fires
- **THEN** `cachedCtx` and `cachedModelRegistry` SHALL be assigned from the freshly emitted `ctx`
- **AND** any later-registered listener that reads them SHALL see the new references, not the previous session's

#### Scenario: No session-bound access after shutdown
- **WHEN** `session_shutdown` fires for the current session
- **THEN** subsequent code paths SHALL NOT invoke session-bound methods on `cachedCtx` (e.g. `cachedCtx.sessionManager.getSessionId()`)
- **AND** the bridge SHALL wait for the next `session_start` re-capture before resuming session-bound work

### Requirement: Bridge SHALL NOT register a TUI multiselect arm that consumes `originals.custom`

The bridge extension's TUI PromptBus adapter (registered by the bridge extension when `ctx.hasUI === true`) MUST NOT contain an `else if (prompt.type === "multiselect" && ... originals.custom ...)` arm that calls `await originals.custom(...)` and uses its resolution to drive a `bus.respond(...)` call.

The reason: pi 0.70's RPC mode (used by every dashboard-spawned headless session) defines `ExtensionUIContext.custom` as an unconditional no-op:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
},
```

(source: `~/.nvm/.../@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js`)

Any TUI adapter arm that awaits `originals.custom(...)` in dashboard headless mode will therefore receive `undefined` synchronously (one event-loop tick), interpret it as cancellation, and call `bus.respond({ cancelled: true, source: "tui" })`. The PromptBus's first-response-wins semantics will then dismiss the dashboard's already-rendered `MultiselectRenderer` before the user can interact with it.

The bridge's `ctx.ui.multiselect` PromptBus patch (added by the predecessor change `fix-multiselect-auto-cancel-on-dashboard`) already routes multiselect through the bus to the `DashboardDefaultAdapter`, which renders a working browser dialog via the registered client `MultiselectRenderer`. No TUI adapter participation is needed for dashboard sessions, and pure-TUI sessions on pi 0.70 RPC have no working `ctx.ui.custom` path to participate through anyway. The TUI multiselect arm is therefore prohibited until pi-coding-agent restores `ctx.ui.custom` in RPC mode.

This requirement is enforced by a repository-level lint test (`packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`) that scans the module owning the TUI PromptBus adapter and fails if the source contains the co-occurrence of `originals.custom` AND `prompt.type === "multiselect"`. Either substring alone is permitted — the prohibition is on the combination.

#### Scenario: Lint passes when `bridge.ts` does not contain the offending co-occurrence
- **WHEN** the lint test reads the source of the module owning the TUI PromptBus adapter
- **AND** the source does NOT contain `originals.custom` and `prompt.type === "multiselect"` together
- **THEN** the lint test SHALL pass

#### Scenario: Lint fails if a contributor re-adds the TUI multiselect arm
- **WHEN** a future refactor adds back the `else if (prompt.type === "multiselect" && ... originals.custom)` arm
- **THEN** the lint test `no-tui-multiselect-arm-regression.test.ts` SHALL fail with a message that includes the file path, the matched lines, and a one-line pointer to this change name

#### Scenario: `originals.custom` capture without consumption is permitted
- **WHEN** the scanned module captures `originals.custom = ctx.ui.custom?.bind(ctx.ui)` (e.g., for a *different* future use that does not include `prompt.type === "multiselect"`)
- **THEN** the lint test SHALL pass — the prohibited pattern is the co-occurrence, not either substring alone

#### Scenario: `prompt.type === "multiselect"` outside the TUI adapter is permitted
- **WHEN** the scanned module references `type: "multiselect"` in the `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ type: "multiselect", ... })` patch
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

### Requirement: Slash dispatch helper dispatches in-process without a pi version gate
The `tryDispatchExtensionCommand(pi, text, sessionId, sink, delivery?)` helper in `packages/extension/src/slash-dispatch.ts` SHALL:

1. Return `false` (no feedback emitted) when `isExtensionSlashCommand(text, pi.getCommands())` is false, or when `pi.getCommands()` throws (stale ctx) — the caller proceeds with the existing passthrough.
2. Otherwise emit `command_feedback {status:"started"}`; then call `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs: delivery ?? "followUp" })` and emit `{status:"completed"}`, or `{status:"error", message}` if the call throws synchronously.
3. Return `true` whenever it emitted `started`.

The helper SHALL NOT accept a `connection` parameter, SHALL NOT feature-detect `pi.dispatchCommand`, and SHALL NOT emit `dispatch_extension_command`. Both call sites (the bridge extension's `sessionPrompt` callback, `command-handler.ts` slash else-arm) SHALL pass the requested `delivery` when known.

#### Scenario: In-process dispatch
- **GIVEN** `text` is `/ctx-stats`, `ctx-stats` is in `pi.getCommands()` with `source: "extension"`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, "followUp")` is called
- **THEN** `pi.sendUserMessage("/ctx-stats", { expandPromptTemplates: true, deliverAs: "followUp" })` SHALL be invoked
- **AND** sink SHALL receive `command_feedback {status:"started"}` then `{status:"completed"}`
- **AND** the helper SHALL return `true`

#### Scenario: Steer delivery forwarded
- **WHEN** called with `delivery: "steer"`
- **THEN** `pi.sendUserMessage` SHALL receive `deliverAs: "steer"`

#### Scenario: Synchronous throw
- **GIVEN** `pi.sendUserMessage` throws
- **WHEN** the helper is called with an extension command
- **THEN** sink SHALL receive `started` then `error` with the thrown message, and no `completed`

#### Scenario: Non-extension command unaffected
- **GIVEN** `text` is `/skill:foo` (source: "skill") OR `/totally-unknown` (no match)
- **WHEN** the helper is called
- **THEN** it SHALL return `false` and sink SHALL receive no `command_feedback`

#### Scenario: No version read
- **WHEN** the helper dispatches any extension command
- **THEN** it SHALL NOT read the running pi's version
