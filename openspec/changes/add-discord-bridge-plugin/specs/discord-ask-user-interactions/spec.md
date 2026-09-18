## Purpose

Renders a session's `ask_user` question into Discord's interactive components so a blocked agent can be unblocked from chat, while surviving the platform's interaction-token expiry — which is far shorter than the time a pi question may stay open.

## ADDED Requirements

### Requirement: Questions render as interactive components
A session's pending question SHALL be posted into its bound thread with components matching the question's method: buttons for confirm, a select menu for single choice, a multi-select menu for multiple choice, and a prompt for free-text reply for input.

#### Scenario: Confirm question
- **WHEN** a bound session asks a yes/no question
- **THEN** the thread shows the question text with two mutually exclusive choice components

#### Scenario: Multi-choice question
- **WHEN** a bound session asks the user to choose several items from a list
- **THEN** the thread shows a component permitting multiple selections before submission

#### Scenario: Batch question
- **WHEN** a bound session asks several questions at once
- **THEN** each sub-question is answerable in the thread and the session receives them as one answer set

### Requirement: Only a permitted principal may answer
Answering a question SHALL require at least `control` tier. When a question arose from a command a specific principal invoked, only that principal SHALL be able to answer it.

#### Scenario: Bystander presses a button
- **WHEN** a principal other than the invoker interacts with a question raised by another's command
- **THEN** the interaction is refused and the session remains blocked

#### Scenario: Observer attempts to answer
- **WHEN** an `observe` principal interacts with a question's components
- **THEN** the interaction is refused

### Requirement: Answer delivery is exactly-once
The plugin SHALL deliver at most one answer per question. Once answered, the posted components SHALL no longer accept input.

#### Scenario: Double submission
- **WHEN** a principal submits an answer twice in rapid succession
- **THEN** exactly one answer reaches the session

#### Scenario: Question answered in the dashboard first
- **WHEN** the same question is answered in the dashboard UI while the Discord components are still posted
- **THEN** the Discord components stop accepting input and show the question as already answered

### Requirement: Survives interaction-token expiry via text fallback
When the platform's interaction window for a posted question has expired, the plugin SHALL provide a text-reply path to the same question, so a question outliving that window remains answerable without operator intervention.

#### Scenario: Question answered after the interaction window closes
- **WHEN** a question has been open longer than the platform permits component interactions
- **THEN** the thread indicates that the question must be answered by replying in text
- **AND** a valid text reply from a permitted principal is delivered to the session as the answer

#### Scenario: Ambiguous text reply
- **WHEN** a text-fallback reply does not match any offered option
- **THEN** the plugin reports the valid options and delivers nothing to the session

### Requirement: Unanswerable questions remain visible
If no Discord principal can answer a question — because the plugin is disarmed, the binding is inactive, or no principal holds sufficient tier — the thread SHALL show the session as blocked on a question rather than failing silently.

#### Scenario: Question raised while disarmed
- **WHEN** a bound session asks a question while the plugin is disarmed
- **THEN** the thread shows the session is blocked awaiting an answer
- **AND** no answer can be submitted from Discord until the plugin is re-armed
