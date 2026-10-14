# craft-cli-entrypoint Specification

## Purpose
The `pi-craft` command-line entry point gives agents and users one way to list, provision, run and verify every ArtCraft Crafting App headlessly — a bash pass-through, a per-app stdio MCP server with an explicit confinement policy and lazy registration — while keeping the `pi-photocraft` command working as a compatibility alias.

## Requirements

### Requirement: Subcommand dispatch and exit codes
`pi-craft` SHALL accept `apps`, `status`, `install`, `launcher`, `verify` and `<app> <ensure|path|exec|mcp>`; with no arguments, an unknown subcommand or app, or `--help`, it SHALL print usage listing subcommands and app ids. Exit codes SHALL be `0` success, `1` usage error or failed operation, `69` provisioning failure; `exec` propagates the binary's exit code; `verify` uses its own codes.

#### Scenario: Unknown app
- **WHEN** `pi-craft paintcraft path` is run
- **THEN** usage listing the 13 app ids is printed to stderr and the exit code is `1`

#### Scenario: Provisioning failure
- **WHEN** `pi-craft filmcraft exec --version` needs the binary and provisioning fails
- **THEN** the error is printed to stderr and the exit code is `69`

### Requirement: Executable from a shell
The `pi-craft` and `pi-photocraft` bins SHALL start from a plain shell with no TypeScript loader configured, both from the monorepo checkout and from an npm install (including pi's `~/.pi/agent/npm` prefix).

#### Scenario: npm-installed bin runs without a TypeScript loader
- **WHEN** the packed package is installed into a fresh prefix and `pi-craft --help` is run with an empty `NODE_OPTIONS`
- **THEN** usage is printed and the exit code is `0`

### Requirement: apps and status
`pi-craft apps [--json]` SHALL list every app with id, one-line purpose, repository, MCP confinement support and MCP tool-count class, without network access. `pi-craft status [--json]` SHALL additionally show, per app, the installed versions, cache size, the version that would be used and the active source — without downloading anything.

#### Scenario: apps works offline
- **WHEN** `pi-craft apps --json` runs with no network
- **THEN** it prints a JSON array of 13 entries and exits `0`

#### Scenario: status never downloads
- **WHEN** `pi-craft status` runs on an empty cache
- **THEN** every app is reported as not installed and no release asset is requested

### Requirement: install
`pi-craft install <app…>` and `pi-craft install --all` SHALL provision each named app (as `ensure`) and print one provisioning report per app; a failure for one app SHALL NOT stop the others, and the exit code SHALL be `69` if any failed.

#### Scenario: Partial failure
- **WHEN** `pi-craft install soundcraft filmcraft` runs and only `filmcraft` fails to provision
- **THEN** `soundcraft` is installed, both reports are printed, and the exit code is `69`

### Requirement: ensure, path and exec per app
`pi-craft <app> ensure` SHALL print the provisioning report as one JSON object; `pi-craft <app> path` SHALL print only the absolute binary path; `pi-craft <app> exec <args…>` SHALL run the binary with `<args…>` as a verbatim argument vector (no shell interpretation), stream stdio unbuffered, and exit with the binary's code.

#### Scenario: Arguments are not shell-interpreted
- **WHEN** `pi-craft effectcraft exec run comp.new '{"name":"My Title"}'` is run
- **THEN** the binary receives `{"name":"My Title"}` as one argument

#### Scenario: path output is script-friendly
- **WHEN** `pi-craft soundcraft path` succeeds
- **THEN** stdout is exactly one line with the absolute binary path

### Requirement: Per-app MCP server with confinement policy
`pi-craft <app> mcp` SHALL provision the binary and run its stdio MCP server through a proxy that forwards `tools/call` requests one at a time (the next only after the previous response), forwards other messages immediately, diverts non-JSON server stdout to stderr, rejects bridge/connect, control-token and direct automation-root options, and maps SIGINT/SIGTERM to exit `130`/`143`. For apps whose server supports path confinement, `--root <dir>` (default cwd) SHALL be applied as both read and write root (as `--root` for PdfCraft, whose server takes a single root) and printed to stderr. For apps that offer a compact tool list (LightCraft, PdfCraft), `--compact` SHALL be passed through; for others it SHALL be a usage error. For apps without confinement support, the command SHALL refuse to start unless `--allow-unconfined` is given, and SHALL then print to stderr that the server can read and write any path the user can. Provisioning failure SHALL leave stdout empty and exit `69`.

#### Scenario: Confined app defaults to the cwd
- **WHEN** `pi-craft vectorcraft mcp` starts in `/work/proj`
- **THEN** the server is started with `/work/proj` as read and write root

#### Scenario: Unconfined app refuses without opt-in
- **WHEN** `pi-craft filmcraft mcp` is run without `--allow-unconfined`
- **THEN** no server is started, stderr explains that FilmCraft's MCP server has no path confinement and names `--allow-unconfined`, and the exit code is `1`

#### Scenario: Bridge option rejected
- **WHEN** `pi-craft soundcraft mcp --allow-unconfined --connect 7979` is run
- **THEN** a usage error is printed, no server is started, and the exit code is `1`

#### Scenario: Pipelined calls are serialized
- **WHEN** a client sends two `tools/call` requests without waiting
- **THEN** the second reaches the server only after the first response

### Requirement: Lazy, opt-in MCP registration
No MCP server SHALL be registered as a side effect of any command. `pi-craft <app> mcp --register [--allow-unconfined]` SHALL add or update one entry `craft-<app>` (for `photocraft`: `photocraft`) under `mcpServers` in the project's `.pi/mcp.json`, with absolute Node and launcher paths and arguments `[<app>, "mcp"]` plus `--allow-unconfined` when given, preserving all other keys; it SHALL refuse unconfined apps without the flag; it SHALL print to stderr the machine-specific-paths, project-trust and start-in-project-root notes, and, for apps whose tool-count class is `large`, the tool count and a recommendation to prefer the bash route. A malformed existing file SHALL be left untouched with exit `1`.

#### Scenario: Register a confined app
- **WHEN** `pi-craft wordcraft mcp --register` runs in a project with an existing `filesystem` server
- **THEN** `.pi/mcp.json` contains `filesystem` unchanged and `craft-wordcraft` with arguments ending `["wordcraft","mcp"]`

#### Scenario: Large app warns
- **WHEN** `pi-craft lightcraft mcp --register --allow-unconfined` runs
- **THEN** the entry is written and stderr states the server exposes over 300 tools and recommends the bash route

#### Scenario: Nothing registered implicitly
- **WHEN** `pi-craft install --all`, `ensure`, `exec` or `mcp` (without `--register`) run
- **THEN** `.pi/mcp.json` is not created or modified

### Requirement: pi-photocraft compatibility alias
The package SHALL ship `pi-photocraft` with the same subcommands, options, exit codes and outputs as before this change (`ensure`, `path`, `exec`, `mcp`, `mcp --register`, `replace-region`), backed by the shared provisioning and MCP proxy; its `mcp --register` SHALL keep writing the entry name `photocraft`.

#### Scenario: Existing script keeps working
- **WHEN** a script runs `pi-photocraft exec run in.png --cmd image.flipHorizontal --out out.png`
- **THEN** it behaves as before and exits with the binary's code

### Requirement: Recommended-extensions manifest entry
The dashboard's recommended-extensions manifest SHALL include `@blackbelt-technology/pi-dashboard-craft-apps` with `status: "optional"`, an npm source, and `unlocks` naming the `craft-studio` skill, the per-app skills and the `pi-craft` CLI.

#### Scenario: Entry present
- **WHEN** the manifest is loaded
- **THEN** it contains `@blackbelt-technology/pi-dashboard-craft-apps` with `status: "optional"`
