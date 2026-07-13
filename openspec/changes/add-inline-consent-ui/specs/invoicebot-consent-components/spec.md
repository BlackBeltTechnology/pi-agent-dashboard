## ADDED Requirements

### Requirement: Consent surfaces are registered as inline interactive components

The plugin SHALL register a family of interactive components for the invoicebot
consent surfaces, keyed by kind: `rule-activation`, `rule-archive`,
`approval-request`, `repair`, `config`, and `handoff`. Each SHALL be registered
with a generic-dialog (inline) placement so it renders in the chat transcript.

#### Scenario: Consent component renders in the transcript

- **GIVEN** an `ask_user` prompt whose component type is one of the registered
  consent kinds
- **WHEN** the chat transcript renders
- **THEN** the prompt SHALL produce an inline interactive card in the transcript

#### Scenario: Consent component is never widget-bar placed

- **WHEN** any consent component kind is registered
- **THEN** its placement SHALL be generic-dialog (inline)
- **AND** it SHALL NOT resolve to a widget-bar placement (which would be
  suppressed from the chat transcript)

### Requirement: Consent components round-trip an accept/decline answer

Each consent component SHALL accept an operator answer of accept or decline over
the existing prompt-response path; the `approval-request` kind SHALL additionally
carry a reason when the answer is a rejection.

#### Scenario: Accept and decline are delivered

- **WHEN** the operator accepts or declines a consent component
- **THEN** the answer SHALL be delivered to the session via the prompt-response
  path

#### Scenario: Rejection carries a reason

- **WHEN** the operator rejects an `approval-request` component
- **THEN** the delivered answer SHALL include the reason
