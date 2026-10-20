## MODIFIED Requirements

### Requirement: Open inline terminal via bare `!!`
The system SHALL open an inline interactive terminal card in the chat stream when the user submits `!!` with no command, unless a terminal cap defined by the `server-capability-bounds` capability is reached. `!! <command>` and `! <command>` (with a command) SHALL retain their existing one-shot `bash_output` behavior unchanged.

#### Scenario: Bare `!!` opens inline terminal
- **WHEN** the user submits `!!` with no following command and no terminal cap is reached
- **THEN** the system SHALL spawn an ephemeral PTY terminal
- **THEN** an inline interactive terminal card SHALL appear in the chat stream
- **THEN** no `bash_output` event SHALL be emitted

#### Scenario: `!!` with a command is unchanged
- **WHEN** the user submits `!!docker ps`
- **THEN** the system SHALL execute it as a one-shot command and emit `bash_output` with `excludeFromContext: true`
- **THEN** no inline terminal card SHALL open

#### Scenario: `!` with a command is unchanged
- **WHEN** the user submits `!git status`
- **THEN** the system SHALL execute it as a one-shot command and emit `bash_output` with `excludeFromContext: false`

#### Scenario: Bare `!!` at a terminal cap
- **WHEN** the user submits `!!` with no following command and a terminal cap is reached
- **THEN** no PTY SHALL be spawned and no inline terminal card SHALL appear
- **AND** the chat SHALL show the terminal-limit notice

### Requirement: Open inline terminal via composer button
The chat composer SHALL provide a button that opens an inline interactive terminal card, using the same path as bare `!!`.

#### Scenario: Button opens inline terminal
- **WHEN** the user clicks the composer's open-inline-terminal button and no terminal cap is reached
- **THEN** an ephemeral PTY terminal SHALL be spawned
- **THEN** an inline interactive terminal card SHALL appear in the chat stream

#### Scenario: Button at a terminal cap
- **WHEN** the user clicks the composer's open-inline-terminal button and a terminal cap is reached
- **THEN** no PTY SHALL be spawned and the chat SHALL show the terminal-limit notice
