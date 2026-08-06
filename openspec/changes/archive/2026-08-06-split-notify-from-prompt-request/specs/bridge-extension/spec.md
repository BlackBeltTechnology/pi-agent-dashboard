# bridge-extension

## MODIFIED Requirements

### Requirement: Bridge SHALL flip `ctx.hasUI` to `true` after wiring the UI proxy

After the bridge has installed PromptBus wrappers on `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.editor`, `ctx.ui.multiselect`, and `ctx.ui.notify` in the `session_start` handler, the bridge SHALL assign `ctx.hasUI = true` on the live `ctx` object.

The assignment SHALL happen AFTER the bridge has captured the original `ctx.hasUI` value into its `cachedHasUI` state (used by `source-detector.detectSessionSource`). `cachedHasUI` MUST retain the pi-supplied original value; only the live `ctx.hasUI` is flipped.

The assignment SHALL be guarded with try/catch so that if a future pi release makes `ctx.hasUI` non-writable, the bridge logs a single `[dashboard] failed to flip ctx.hasUI` warning and continues without crashing.

Rationale: extensions branch on `ctx.hasUI` to decide whether to call `ctx.ui.notify`, render dialogs, or short-circuit interactive flows. The bridge already provides a working UI surface via PromptBus over the patched `ctx.ui.*` methods — `ctx.hasUI` MUST reflect that reality so extensions like `context-mode` (`/ctx-stats`, `/ctx-doctor`) and `pi-agent-browser` (binary auto-install prompt) take their UI-present branch and render output in the dashboard.

The transport for a forwarded `ctx.ui.notify` is the `notify` message, NOT `prompt_request`. A notification is fire-and-forget and produces no dismissal, so routing it over the prompt channel makes it an unanswerable pending prompt. See the `notify-message-channel` capability.

#### Scenario: Headless RPC session — flip happens
- **WHEN** the bridge's `session_start` handler runs in a dashboard-spawned `pi --mode rpc` session where pi initialized `ctx.hasUI = false`
- **AND** the bridge has executed the `ctx.ui.*` PromptBus patching block
- **THEN** `ctx.hasUI` SHALL be `true` on the live `ctx` object
- **AND** the bridge's `cachedHasUI` field SHALL be `false` (preserving the pre-flip value)

#### Scenario: Source detection unaffected
- **WHEN** the bridge calls `detectSessionSource(cachedHasUI, sessionFile)` after the flip
- **THEN** `cachedHasUI` SHALL still be the original pi-supplied value (e.g. `false` for dashboard-spawned RPC, `true` for tmux)
- **AND** session source classification ("dashboard" vs "tmux") SHALL be identical to behavior before this change

#### Scenario: Tmux session — flip is a no-op
- **WHEN** the bridge's `session_start` handler runs in a tmux-spawned session where pi initialized `ctx.hasUI = true`
- **THEN** `ctx.hasUI` SHALL remain `true` after the flip
- **AND** `cachedHasUI` SHALL be `true`

#### Scenario: Context-mode slash command renders in dashboard RPC session
- **WHEN** a user dispatches `/ctx-stats` from the dashboard in a headless-RPC session
- **AND** context-mode's handler reads `ctx.hasUI`
- **THEN** `ctx.hasUI` SHALL evaluate truthy
- **AND** context-mode SHALL call `ctx.ui.notify(text, "info")`
- **AND** the bridge's patched `notify` SHALL forward a `notify` message to the dashboard server
- **AND** it SHALL NOT forward a `prompt_request`
- **AND** the dashboard SHALL render the notify body as a chat card

#### Scenario: Non-writable `ctx.hasUI` is handled gracefully
- **WHEN** the bridge attempts `ctx.hasUI = true` and the assignment throws (e.g. pi made `hasUI` a getter / frozen field in a future release)
- **THEN** the bridge SHALL catch the error
- **AND** the bridge SHALL log `[dashboard] failed to flip ctx.hasUI` exactly once
- **AND** `session_start` SHALL continue without crashing
