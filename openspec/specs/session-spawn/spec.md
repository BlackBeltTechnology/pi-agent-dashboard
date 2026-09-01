# session-spawn Specification

## Purpose
Session spawn dispatch. Chooses mechanism (`tmux` / `wsl-tmux` / `wt` / `headless`) and constructs the argv that launches a pi session in a chosen workspace directory.
## Requirements
### Requirement: tmux session spawn performs no shell interpretation of inputs
Spawning a session through the tmux or WSL-tmux mechanism SHALL NOT subject the
workspace path or any session flag to shell interpretation.

> WSL-tmux note: the workspace path reaches tmux as a literal argv element (no
> shell interpretation), but it is a Windows path handed to a Linux tmux with no
> `wslpath` conversion — a pre-existing path-translation gap, tracked separately
> from this requirement's shell-interpretation guarantee.

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

