# claude-subscription-compat Specification

## Purpose
Keeps pi sessions and pi-flows agents that run on an Anthropic Claude subscription billed as subscription usage rather than extra usage, by rewriting the two identifying lines in pi's built-in `docs` system-prompt section, under a user-controlled global switch.

## Requirements

### Requirement: Global compat switch defaults to off
The system SHALL keep a global boolean Claude subscription compat switch. When no value has been stored, the switch SHALL be treated as off. Its value SHALL survive a dashboard server restart.

#### Scenario: Default when never set
- **WHEN** the dashboard starts and no compat value has ever been stored
- **THEN** the switch SHALL read as off
- **AND** the dashboard SHALL NOT rewrite any session's system prompt

#### Scenario: Persisted across restart
- **WHEN** the user turns the switch on and the dashboard server restarts
- **THEN** the switch SHALL read as on after the restart

### Requirement: Switch value reaches every connected pi session
Every connected pi session SHALL receive the current switch value when it registers, before any initial prompt is dispatched to it, and again within one broadcast whenever the value changes, so the next agent run uses the new value without a session restart.

#### Scenario: Value on register
- **WHEN** a pi session spawned with an initial prompt registers while the switch is on
- **THEN** that session's first agent run on an `anthropic` model SHALL apply the rewrite

#### Scenario: Live change
- **WHEN** the user turns the switch off while sessions are connected
- **THEN** the next agent run in each connected session SHALL send pi's unmodified docs section

### Requirement: Docs-section rewrite on Anthropic sessions
While the switch is on, a run's model provider is `anthropic`, and the run uses pi's default prompt, its docs section SHALL read `the cli itself` and `cli packages` instead of `pi itself` and `pi packages`. Every other part of the docs section SHALL stay unchanged. A run with no model, a custom `SYSTEM.md` prompt, or a forced whole prompt SHALL NOT be rewritten.

#### Scenario: Anthropic run with switch on
- **WHEN** the switch is on and an agent run starts on an `anthropic` model
- **THEN** the outbound system prompt SHALL contain `the cli itself` and `cli packages`
- **AND** SHALL NOT contain `pi itself` or `pi packages`

#### Scenario: Other provider
- **WHEN** the switch is on and an agent run starts on a non-`anthropic` provider
- **THEN** the docs section SHALL be sent unmodified

#### Scenario: Switch off
- **WHEN** the switch is off and an agent run starts on an `anthropic` model
- **THEN** the dashboard SHALL send the docs section unmodified

#### Scenario: Custom system prompt
- **WHEN** the switch is on and the session uses a `SYSTEM.md` custom prompt
- **THEN** the dashboard SHALL NOT add or change any docs section, even if the custom prompt or a context file contains a `<docs>` tag

### Requirement: Rewrite preserves the rest of the prompt and tool names
The rewrite SHALL change only the docs section. It SHALL NOT replace the whole system prompt, SHALL NOT remove sections other extensions contribute (unless another extension forces the whole prompt, in which case the rewrite does not apply), and SHALL NOT rename any tool in the tool list, tool history, or mid-conversation tool additions and removals.

#### Scenario: Other contributions kept
- **WHEN** the rewrite applies to a run in which other extensions contribute prompt sections or tool guidelines
- **THEN** those sections and guidelines SHALL still appear in the outbound system prompt

#### Scenario: Tool names unchanged
- **WHEN** the rewrite applies to a run with custom tools such as `ask_user`
- **THEN** each tool SHALL be sent under its registered pi name

### Requirement: Flow agents receive the same rewrite
Agents spawned by pi-flows from a session SHALL receive the same docs-section rewrite under the same conditions, judged on the agent's own model and the parent session's switch value, through pi-flows' generic agent-extension registration. It SHALL work with pi-flows 0.8.0 and later.

#### Scenario: Flow agent on Anthropic
- **WHEN** the switch is on and a flow agent runs on an `anthropic` model
- **THEN** the flow agent's outbound system prompt SHALL NOT contain `pi itself` or `pi packages`

#### Scenario: Flow agent with switch off
- **WHEN** the switch is off and a flow agent runs on an `anthropic` model
- **THEN** the dashboard SHALL NOT rewrite the flow agent's docs section

#### Scenario: Flow agent on another provider
- **WHEN** the switch is on, the parent session runs on `anthropic`, and a flow agent runs on a non-`anthropic` model
- **THEN** the flow agent's docs section SHALL be sent unmodified

### Requirement: Sign-in prompts to turn the switch on
When an Anthropic subscription sign-in completes in Provider Authentication while the switch is off, the dashboard SHALL ask the user once for that completion whether to turn the switch on, offering Turn on and Not now. Turn on SHALL set the switch on. Not now SHALL leave it off. The prompt SHALL NOT block the sign-in. No package install SHALL be started.

#### Scenario: Turn on
- **WHEN** an Anthropic subscription sign-in completes with the switch off and the user chooses Turn on
- **THEN** the switch SHALL be on
- **AND** no package install SHALL be enqueued

#### Scenario: Not now
- **WHEN** the user chooses Not now
- **THEN** the switch SHALL stay off and the sign-in SHALL remain completed

#### Scenario: Already on
- **WHEN** an Anthropic subscription sign-in completes while the switch is already on
- **THEN** no prompt SHALL be shown

#### Scenario: Switch value unreadable
- **WHEN** an Anthropic subscription sign-in completes and the current switch value cannot be read
- **THEN** the prompt SHALL be shown

### Requirement: Anthropic row shows and controls the switch
The authenticated `anthropic` subscription row in Provider Authentication SHALL show whether the switch is on and SHALL offer a control that changes it. Changing it there SHALL have the same effect as changing it anywhere else. The control SHALL NOT gate sign-out, the Connected marker or the expiry display.

#### Scenario: Off state visible
- **WHEN** the `anthropic` subscription row is authenticated and the switch is off
- **THEN** the row SHALL show that compat is off with a control to turn it on

#### Scenario: Flows plugin disabled
- **WHEN** the `anthropic` subscription row is authenticated and the Flows plugin is disabled
- **THEN** the row SHALL say that the compat switch needs the Flows plugin to take effect

#### Scenario: Toggle from the row
- **WHEN** the user turns the switch on from the `anthropic` row
- **THEN** the switch SHALL be on and the next agent run on an `anthropic` model SHALL apply the rewrite

### Requirement: One-time uninstall notice for existing package installs
When the switch is on and `pi-anthropic-messages` is still installed, the dashboard SHALL show a dismissible notice saying the package can be uninstalled, until it is dismissed in that browser. The dashboard SHALL NOT uninstall it automatically.

#### Scenario: Package still installed
- **WHEN** the switch is on and `pi-anthropic-messages` appears in the installed packages
- **THEN** a notice SHALL say it can be uninstalled
- **AND** dismissing it SHALL keep it hidden on later loads in the same browser

#### Scenario: Package not installed
- **WHEN** `pi-anthropic-messages` is not installed
- **THEN** no notice SHALL be shown

### Requirement: Applied compat state is logged per session
Each pi session SHALL log, once per session and again whenever it changes, which compat state its runs get: applied, switch off, not an `anthropic` model, custom or forced prompt, or switch on but neither phrase found. The log SHALL NOT contain prompt text.

#### Scenario: Phrases not found
- **WHEN** the switch is on, the run is on `anthropic` with pi's default prompt, and the docs section contains neither phrase
- **THEN** the session SHALL log one warning that the rewrite matched nothing
- **AND** SHALL NOT log it again for later runs of that session

#### Scenario: Applied
- **WHEN** the rewrite applies for the first time in a session
- **THEN** the session SHALL log one line stating the rewrite is applied, without prompt text

### Requirement: A failed switch change reverts with an error toast
Any dashboard control that changes the switch (sign-in prompt, `anthropic` row, Landing Step ①) SHALL show the new value immediately. If saving it fails, the control SHALL revert to the previous value and an error toast SHALL say the change was not saved.

#### Scenario: Save rejected
- **WHEN** the user turns the switch on and the save returns an error
- **THEN** the control SHALL first show on, then revert to off
- **AND** an error toast SHALL say the change was not saved

#### Scenario: Server unreachable
- **WHEN** the user turns the switch on while the dashboard server is unreachable
- **THEN** the control SHALL revert to off with the same error toast
- **AND** no session SHALL receive a changed switch value
