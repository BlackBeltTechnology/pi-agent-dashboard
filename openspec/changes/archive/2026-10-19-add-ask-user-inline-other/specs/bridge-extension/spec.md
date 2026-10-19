## ADDED Requirements

### Requirement: Dialog prompts carry the inline Other opt-in
The bridge's patched `ctx.ui.select` and `ctx.ui.multiselect` SHALL accept an optional `opts.allowOther` boolean. When it is exactly `true`, the emitted `prompt_request` SHALL carry `metadata.allowOther: true`, including when `allowOther` is the only metadata the call supplies. When it is absent or not `true`, the bridge SHALL omit `metadata.allowOther`, and the prompt SHALL render exactly as before. `allowOther` SHALL be a core metadata key and SHALL NOT be settable through `opts.pluginMeta`. Batch sub-questions SHALL carry their own `allowOther: true` inside `metadata.questions[i]` when opted in. For an opted-in prompt the bridge SHALL return a custom answer to the caller unchanged: `ctx.ui.select` resolves to the custom string, and `ctx.ui.multiselect` resolves to an array that includes it. The TUI presentation SHALL ignore `allowOther`.

#### Scenario: Opt-in reaches the dashboard
- **WHEN** an extension calls `ctx.ui.select("Pick", ["A", "B"], { allowOther: true })` with no message, toolCallId or pluginMeta
- **THEN** the `prompt_request` SHALL carry `metadata.allowOther: true`

#### Scenario: Default emits nothing
- **WHEN** an extension calls `ctx.ui.select("Pick", ["A", "B"])` or passes `{ allowOther: false }`
- **THEN** the `prompt_request` metadata SHALL NOT contain `allowOther`

#### Scenario: pluginMeta cannot set the core key
- **WHEN** an extension passes `{ pluginMeta: { allowOther: true } }`
- **THEN** the value SHALL stay under `metadata.plugin` and SHALL NOT set `metadata.allowOther`

#### Scenario: Custom answer returned verbatim
- **WHEN** the dashboard answers an opted-in `select` prompt with `"something else"`
- **THEN** `ctx.ui.select` SHALL resolve to `"something else"`

## MODIFIED Requirements

### Requirement: Bridge registers ask_user tool
The bridge extension SHALL register an `ask_user` tool via `pi.registerTool()` during `initBridge()`. The tool's parameters, description, promptSnippet and promptGuidelines are defined by the `ask-user-tool` capability. The tool's `execute` method SHALL call `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, or `ctx.ui.multiselect` based on the `method` parameter — which are already proxied by the UI proxy to the dashboard. For `select` and `multiselect` the options argument SHALL carry `allowOther: true` unless the call opted out (see `ask-user-tool`).

#### Scenario: ask_user tool registered on init
- **WHEN** `initBridge(pi)` runs
- **THEN** `pi.registerTool()` SHALL be called with `name: "ask_user"`

#### Scenario: ask_user confirm call
- **WHEN** the LLM calls `ask_user` with `method: "confirm"` and `title: "Proceed?"`
- **THEN** the tool SHALL call `ctx.ui.confirm("Proceed?", message)` and return the result

#### Scenario: ask_user select call
- **WHEN** the LLM calls `ask_user` with `method: "select"`, `title: "Pick one"`, and `options: ["A", "B"]`
- **THEN** the tool SHALL call `ctx.ui.select("Pick one", ["A", "B"], opts)` where `opts.allowOther` is `true`, and return the result
