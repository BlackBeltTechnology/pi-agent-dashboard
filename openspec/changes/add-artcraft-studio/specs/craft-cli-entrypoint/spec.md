## MODIFIED Requirements

### Requirement: Subcommand dispatch and exit codes
`pi-craft` SHALL accept `apps`, `status`, `install`, `launcher`, `verify`, `artcraft <install|update|status|launch|open|login|logout|whoami|mcp>` and `<app> <ensure|path|exec|mcp>`; with no arguments, an unknown subcommand or app, or `--help`, it SHALL print usage listing subcommands and app ids. `artcraft` SHALL NOT be an app id: `apps`, `status`, `install <app…>` and `install --all` cover only the 13 registry apps, and `pi-craft install artcraft` SHALL be an unknown-app usage error whose message names `pi-craft artcraft install`. Exit codes SHALL be `0` success, `1` usage error or failed operation, `69` provisioning failure; `exec` propagates the binary's exit code; `verify` uses its own codes.

#### Scenario: Unknown app
- **WHEN** `pi-craft paintcraft path` is run
- **THEN** usage listing the 13 app ids is printed to stderr and the exit code is `1`

#### Scenario: Provisioning failure
- **WHEN** `pi-craft filmcraft exec --version` needs the binary and provisioning fails
- **THEN** the error is printed to stderr and the exit code is `69`

#### Scenario: ArtCraft is a group, not an app
- **WHEN** `pi-craft install artcraft` is run
- **THEN** nothing is downloaded, stderr names `pi-craft artcraft install`, and the exit code is `1`

### Requirement: Lazy, opt-in MCP registration
No MCP server SHALL be registered as a side effect of any command. `pi-craft <app> mcp --register [--allow-unconfined]` SHALL add or update one entry `craft-<app>` (for `photocraft`: `photocraft`) under `mcpServers` in the project's `.pi/mcp.json`, with absolute Node and launcher paths and arguments `[<app>, "mcp"]` plus `--allow-unconfined` when given, preserving all other keys; it SHALL refuse unconfined apps without the flag; it SHALL print to stderr the machine-specific-paths, project-trust and start-in-project-root notes, and, for apps whose tool-count class is `large`, the tool count and a recommendation to prefer the bash route. `pi-craft artcraft mcp --register` SHALL register the entry `craft-artcraft` under the same rules, as defined by `artcraft-hosted-mcp`. A malformed existing file SHALL be left untouched with exit `1`.

#### Scenario: Register a confined app
- **WHEN** `pi-craft wordcraft mcp --register` runs in a project with an existing `filesystem` server
- **THEN** `.pi/mcp.json` contains `filesystem` unchanged and `craft-wordcraft` with arguments ending `["wordcraft","mcp"]`

#### Scenario: Large app warns
- **WHEN** `pi-craft lightcraft mcp --register --allow-unconfined` runs
- **THEN** the entry is written and stderr states the server exposes over 300 tools and recommends the bash route

#### Scenario: Nothing registered implicitly
- **WHEN** `pi-craft install --all`, `ensure`, `exec`, `mcp` (without `--register`), `artcraft login` or `artcraft mcp` (without `--register`) run
- **THEN** `.pi/mcp.json` is not created or modified

### Requirement: Recommended-extensions manifest entry
The dashboard's recommended-extensions manifest SHALL include `@blackbelt-technology/pi-dashboard-craft-apps` with `status: "optional"`, an npm source, and `unlocks` naming the `craft-studio` skill, the per-app skills, the `artcraft-studio` skill, the `pi-craft` CLI and the `pi-photocraft` CLI.

#### Scenario: Entry present
- **WHEN** the manifest is loaded
- **THEN** it contains `@blackbelt-technology/pi-dashboard-craft-apps` with `status: "optional"` and its `unlocks` names `artcraft-studio` and `pi-photocraft`
