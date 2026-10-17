## MODIFIED Requirements

### Requirement: Subcommand dispatch and exit codes
`pi-craft` SHALL accept `apps`, `status`, `install`, `launcher`, `verify`, `doc prepare` and `<app> <ensure|path|exec|mcp>`. With no arguments, an unknown subcommand or app, or `--help`, it SHALL print usage listing the subcommands and app ids. Exit codes SHALL be `0` success (including `--help`), `1` usage error or failed operation, and `69` provisioning failure. `pi-craft doc` with no or an unknown subcommand SHALL print usage and exit `1`. `exec` propagates the binary's exit code. `verify` and `doc prepare` use their own codes.

#### Scenario: Unknown app
- **WHEN** `pi-craft paintcraft path` is run
- **THEN** usage listing the 13 app ids is printed to stderr and the exit code is `1`

#### Scenario: Provisioning failure
- **WHEN** `pi-craft filmcraft exec --version` needs the binary and provisioning fails
- **THEN** the error is printed to stderr and the exit code is `69`

#### Scenario: doc subcommand listed
- **WHEN** `pi-craft --help` is run
- **THEN** the usage lists `doc prepare`
