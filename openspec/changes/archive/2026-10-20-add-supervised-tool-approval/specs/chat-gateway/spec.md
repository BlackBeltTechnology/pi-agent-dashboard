# chat-gateway — delta

## MODIFIED Requirements

### Requirement: Interactive prompts rendered natively via PromptBus
The gateway SHALL render a bound session's `prompt_request` (from pi `ask_user` or any
`ctx.ui` dialog method) as native Discord interactive UI and return the user's choice as
`prompt_response`. `select`, `confirm`, `input`, and `editor` SHALL be
supported; `multiselect` and `batch` SHALL be supported via a composition of native
controls. The gateway SHALL acknowledge each Discord interaction within Discord's ~3s
window by **deferring immediately** (deferred update) and then editing the deferred reply
when the session responds. On `prompt_dismiss`/`prompt_cancel` for that prompt, the gateway
SHALL remove or disable the interactive controls.

The gateway SHALL NOT render a supervised tool-approval prompt
(`metadata.kind === "supervised-tool-approval"`) nor a path-gate prompt enriched with
supervised content (`metadata.supervised === true`), for spawned and attached sessions
alike; those prompts are answered on the dashboard or the session's terminal only.

Submitting an answer SHALL require authorization at tier `control` or above. Where the
question arose from a command a specific principal invoked, only that principal SHALL be
able to answer it; where no principal invoked it, any principal holding at least `control`
on that binding SHALL be able to answer.

#### Scenario: Select renders as buttons
- **WHEN** a `prompt_request` of type `select` arrives with options
- **THEN** the gateway SHALL present the options as Discord controls and send the chosen value as `prompt_response`

#### Scenario: Answer elsewhere dismisses the chat prompt
- **WHEN** the same prompt is answered on another surface (e.g. the web UI) first
- **THEN** the gateway SHALL receive `prompt_dismiss` and SHALL disable/remove its Discord controls

#### Scenario: Interaction is acknowledged within 3 seconds
- **WHEN** a user activates a Discord control and the session round-trip exceeds 3 seconds
- **THEN** the gateway SHALL have deferred the interaction immediately and SHALL edit the deferred reply on response, with no Discord "interaction failed" error

#### Scenario: Observer activates a control
- **WHEN** a principal resolving below `control` activates a question's control
- **THEN** no `prompt_response` SHALL be sent and the session SHALL remain blocked

#### Scenario: Bystander answers another principal's question
- **WHEN** a principal other than the invoker activates a control for a question raised by that invoker's command
- **THEN** no `prompt_response` SHALL be sent

#### Scenario: Question from a session no Discord principal invoked
- **WHEN** a session bound by attaching to an existing dashboard session raises a question
- **THEN** any principal holding at least `control` on that binding SHALL be able to answer it

#### Scenario: Supervised approval is not posted to the channel
- **GIVEN** a bound session with supervised mode on
- **WHEN** it raises a supervised tool-approval prompt or a supervised-enriched path prompt
- **THEN** the gateway SHALL NOT post interactive controls for it
