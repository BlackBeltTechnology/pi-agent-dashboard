## REMOVED Requirements

### Requirement: Slot priority between running, attached, and completed flows
**Reason**: Its "Detach restores an undismissed summary" scenario contradicts the fix — Close now dismisses the finished run beneath.
**Migration**: Replaced by "Slot priority and Close over a finished run".

## ADDED Requirements

### Requirement: Slot priority and Close over a finished run

The session flow slot SHALL resolve what to render in this order: (1) a running flow; (2) an attached, not-started flow; (3) a completed-flow summary; (4) nothing. A running flow SHALL always take the slot. Activating **Close** on an attached not-started flow SHALL remove the attachment and SHALL dismiss (persistently, by `runId`) the finished run the slot would otherwise fall back to.

#### Scenario: Attached flow overrides a completed summary
- **GIVEN** a session showing a completed-flow summary
- **WHEN** the user attaches a flow
- **THEN** the slot SHALL show the attached not-started panel instead of the summary

#### Scenario: Close over a finished run empties the slot
- **GIVEN** an attached flow shown over an undismissed finished run with a `runId`
- **WHEN** the user activates **Close**
- **THEN** the attachment SHALL be removed, the finished run SHALL be dismissed with its `runId`, and the flow slot SHALL render nothing

#### Scenario: Close stays effective after replay
- **GIVEN** the user closed an attached flow over finished run `r1`
- **WHEN** the session is replayed
- **THEN** the flow slot SHALL render nothing

#### Scenario: Detach with nothing else to show
- **WHEN** the user activates **Close** on an attached flow and no running or completed flow exists
- **THEN** the flow slot SHALL render nothing and no dismiss SHALL be sent
