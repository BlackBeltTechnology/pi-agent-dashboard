# Spec Delta

## MODIFIED Requirements

### Requirement: Flow-question slot renders a transcript

`FlowQuestionsSection` (the slot consumer mounted by `FlowDashboard`) SHALL render every flow-question prompt for the active flow tab — both pending and answered — capped at the most recent N (default 10), while the flow runs. In a not-started or completed flow panel it SHALL render pending prompts only, and in a completed panel it SHALL stay visible when the panel body is collapsed.

- Pending entries render as a full interactive card with input
  affordances (confirm / select / multiselect / input).
- Non-pending entries (status `resolved`, `cancelled`, `dismissed`)
  render as a collapsed pill showing the question text, the answer
  (when resolved), and a status icon.

Order: insertion order over the session's lifetime, oldest first.

#### Scenario: Answered question stays visible in slot

- **GIVEN** the user has answered a flow-question prompt
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the answered prompt SHALL appear as a collapsed pill in the
  transcript
- **AND** the pill SHALL show the question text plus the user's answer

#### Scenario: Pending question still rendered as full card

- **GIVEN** a flow-question prompt with status `pending`
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the prompt SHALL render as a full interactive card with the
  appropriate input affordance for the prompt's `type`

#### Scenario: Transcript capped at N entries

- **GIVEN** more than 10 flow-question prompts exist for the active flow
- **WHEN** the transcript renders
- **THEN** only the most recent 10 SHALL be visible
- **AND** older entries SHALL be omitted (no scroll-back inside the
  slot for now)

#### Scenario: Completed panel shows only pending prompts
- **GIVEN** a completed flow with one answered and one pending flow-question prompt
- **WHEN** the completed panel renders, expanded or collapsed
- **THEN** the pending prompt SHALL render as a full interactive card
- **AND** the answered prompt SHALL NOT render
