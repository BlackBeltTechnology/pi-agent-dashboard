# Spec Delta

## ADDED Requirements

### Requirement: Bridge accepts follow-up handoff from extensions
The bridge SHALL accept follow-up text that another extension in the same session hands over on a documented `pi.events` channel. Accepted text SHALL enter the bridge follow-up buffer exactly like a dashboard-typed follow-up: shown in the queue, editable, and drained on `agent_settled` in order. When the agent is idle, it SHALL be sent as a fresh turn.

#### Scenario: Handoff while streaming
- **WHEN** an extension hands over follow-up text while the agent is streaming
- **THEN** the text appears as the last follow-up entry in the session's queue, and is sent after earlier queued entries once the agent settles

#### Scenario: Handoff while idle
- **WHEN** an extension hands over follow-up text while the agent is idle
- **THEN** the text is sent to the agent as a fresh turn

### Requirement: Bridge announces user-originated prompts
Before the bridge delivers a prompt that a user submitted from a dashboard client, it SHALL announce that prompt's text on a documented `pi.events` channel. Other extensions can then tell user prompts apart from other extension-sent messages. Prompts the bridge sends for its own machinery (drained system follow-ups, executable templates) SHALL NOT be announced as user-originated.

#### Scenario: Dashboard prompt announced
- **WHEN** a user sends a prompt from the dashboard
- **THEN** the bridge announces the prompt text as user-originated before delivering it to the agent

#### Scenario: System follow-up not announced
- **WHEN** the bridge drains a system-originated follow-up
- **THEN** no user-originated announcement is made for it
