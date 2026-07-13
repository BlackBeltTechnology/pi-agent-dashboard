# invoicebot-consent-components Specification

## Purpose
TBD - created by archiving change add-inline-consent-ui. Update Purpose after archive.
## Requirements
### Requirement: Consent prompts resolve to an inline placement

A consent confirmation raised via `ask_user` SHALL resolve to an inline
placement so it renders in the chat transcript, and SHALL NOT be claimed as a
widget-bar prompt (which `flow-question-routing` suppresses from the transcript).
This covers the consequential actions: rule activation, rule archive, invoice
approve/reject, repair, config apply, and handoff.

#### Scenario: An unclaimed consent prompt is inline

- **GIVEN** an `ask_user` consent prompt not claimed by a widget-bar adapter
- **WHEN** the prompt bus resolves its placement
- **THEN** the resolved placement SHALL be inline

#### Scenario: Consent prompts are never widget-bar claimed

- **WHEN** a consent prompt for any consequential action is raised
- **THEN** no adapter SHALL claim it with a widget-bar placement
- **AND** it SHALL therefore render in the chat transcript

### Requirement: Consent prompts round-trip an accept/decline answer

A consent prompt SHALL round-trip an operator answer of accept or decline over
the existing prompt-response path; a rejection SHALL carry a reason when the
action captures one (invoice reject, approval reject).

#### Scenario: Accept and decline are delivered

- **WHEN** the operator accepts or declines a consent prompt
- **THEN** the answer SHALL be delivered to the session via the prompt-response
  path

#### Scenario: Rejection carries a reason

- **WHEN** the operator rejects a consent prompt that captures a reason
- **THEN** the delivered answer SHALL include the reason

