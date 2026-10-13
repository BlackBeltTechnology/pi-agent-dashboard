## MODIFIED Requirements

### Requirement: Configurable PromptBus timeout for ask_user
The bridge's PromptBus SHALL accept a `timeoutMs` option that controls how long a `request(...)` waits before auto-cancelling. The bridge extension's `session_start` handler SHALL resolve the effective timeout in seconds with this precedence: a per-session override from the process environment variable `PI_EXT_PI_DASHBOARD_ASK_USER_PROMPT_TIMEOUT_SECONDS` (delivered by a plugin spawn as `extensionConfig: { "pi-dashboard": { askUserPromptTimeoutSeconds: "<int>" } }`) when it parses as an integer; otherwise `config.askUserPromptTimeoutSeconds`. An override that does not parse as an integer SHALL be ignored with a logged warning. The handler SHALL pass `timeoutMs = effectiveSeconds * 1000` when `effectiveSeconds > 0`, and SHALL pass a value `<= 0` when `effectiveSeconds <= 0` so the bus skips the cancellation timer entirely. With no timer scheduled, the request SHALL remain pending until either the user answers, the session ends, or another adapter explicitly responds.

The PromptBus implementation SHALL NOT call `setTimeout(...)` when the resolved `timeoutMs <= 0`. Equivalently, the per-request `timer` field SHALL be `null` (or otherwise non-firing) for infinite-wait requests, and any cleanup paths that `clearTimeout(...)` SHALL tolerate the null-timer case.

This applies uniformly to every PromptBus-routed prompt method (`select`, `input`, `confirm`, `multiselect`, `editor`), not just `ask_user`. The `ask_user` tool itself does not branch on the config or the override — it simply calls the bridge-patched `ctx.ui.*` wrappers, which inherit the bus-level timeout configured at `session_start`.

#### Scenario: Default timeout fires after 300 s
- **GIVEN** `config.askUserPromptTimeoutSeconds` is 300 (default), no override is set, and an `ask_user` prompt is dispatched
- **WHEN** 300 s elapse without any adapter responding
- **THEN** the PromptBus SHALL invoke its cancellation path, every adapter's `dismiss(id)` SHALL be called, and the awaiting `request(...)` promise SHALL resolve with `{ cancelled: true }`

#### Scenario: Custom positive timeout is honored
- **GIVEN** `config.askUserPromptTimeoutSeconds = 60` at session start and no override
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL schedule the cancellation timer for 60_000 ms (= `60 * 1000`)

#### Scenario: -1 disables the cancellation timer (infinite wait)
- **GIVEN** `config.askUserPromptTimeoutSeconds = -1`
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL NOT call `setTimeout(...)` for cancellation
- **AND** the request SHALL remain pending indefinitely until a user response, session end, or explicit cross-adapter dismissal arrives

#### Scenario: 0 also disables the cancellation timer
- **GIVEN** `config.askUserPromptTimeoutSeconds = 0`
- **WHEN** an `ask_user` prompt is dispatched
- **THEN** the PromptBus SHALL behave identically to the `-1` case (no `setTimeout`, infinite wait)

#### Scenario: Timeout applies to all PromptBus methods, not just ask_user
- **GIVEN** `config.askUserPromptTimeoutSeconds = 60`
- **WHEN** the bridge invokes any of `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.multiselect`, or `ctx.ui.editor` (each of which is patched at `session_start` to route through PromptBus)
- **THEN** the underlying PromptBus `request(...)` SHALL inherit the same 60_000 ms timeout
- **AND** an in-flight request from any of these methods SHALL auto-cancel after 60 s with `{ cancelled: true }` if no adapter responds first

#### Scenario: Per-session override wins over config
- **GIVEN** `config.askUserPromptTimeoutSeconds = 300` and the session's environment sets `PI_EXT_PI_DASHBOARD_ASK_USER_PROMPT_TIMEOUT_SECONDS=0`
- **WHEN** a question stays unanswered for 301 s
- **THEN** it SHALL still be pending

#### Scenario: Positive override narrows an infinite config
- **GIVEN** `config.askUserPromptTimeoutSeconds = -1` and the override is `120`
- **WHEN** a prompt is dispatched
- **THEN** the PromptBus SHALL schedule the cancellation timer for 120_000 ms

#### Scenario: Invalid override ignored
- **GIVEN** the override is `abc`
- **WHEN** the session starts
- **THEN** the bridge SHALL log a warning and use `config.askUserPromptTimeoutSeconds`
