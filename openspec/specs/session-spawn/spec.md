# session-spawn Specification

## Purpose
TBD - created by archiving change fix-tmux-cwd-command-injection. Update Purpose after archive.
## Requirements
### Requirement: tmux session spawn performs no shell interpretation of inputs
Spawning a session through the tmux or WSL-tmux mechanism SHALL NOT subject the
workspace path or any session flag to shell interpretation.

#### Scenario: Workspace path containing a command substitution
- **WHEN** a session is spawned into a directory whose name contains a command
  substitution such as `$(...)` or backticks
- **THEN** the session SHALL be created for the literal directory name
- **AND** no substituted command SHALL execute

#### Scenario: Workspace path containing quotes and separators
- **WHEN** a session is spawned into a directory whose name contains double
  quotes, single quotes, semicolons or spaces
- **THEN** the directory SHALL be passed as a single argument
- **AND** no additional command SHALL execute

#### Scenario: Command is constructed as argv
- **WHEN** the tmux spawn command is constructed
- **THEN** it SHALL be an argument vector executed without a shell
- **AND** it SHALL NOT be assembled as a string requiring quoting

#### Scenario: Session flags are not shell-interpreted
- **WHEN** a session is spawned with flags whose values contain shell
  metacharacters
- **THEN** each flag value SHALL reach pi as a single literal argument

