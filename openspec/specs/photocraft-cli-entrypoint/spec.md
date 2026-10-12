# photocraft-cli-entrypoint Specification

## Purpose
The `pi-photocraft` command-line entry point gives agents and users two routes to headless PhotoCraft image editing — a bash pass-through and a stdio MCP server confined to the project directory — plus opt-in MCP registration, a shipped pi skill, and discovery through the dashboard's recommended-extensions manifest.

## Requirements

### Requirement: Subcommand dispatch and exit codes
`pi-photocraft` SHALL accept the subcommands `ensure`, `path`, `exec`, `mcp` and `replace-region`. With no subcommand, an unknown subcommand, or `--help`, it SHALL print a usage text listing every subcommand. Exit codes SHALL be: `0` success, `1` usage error or a failed edit, `69` provisioning failure; `exec` additionally propagates the binary's own exit code (documented as possibly overlapping `1` or `69`).

#### Scenario: Unknown subcommand
- **WHEN** `pi-photocraft frobnicate` is run
- **THEN** usage is printed to stderr and the exit code is `1`

#### Scenario: Provisioning failure exit code
- **WHEN** any subcommand needs the binary and provisioning fails
- **THEN** the provisioning error is printed to stderr and the exit code is `69`

### Requirement: Executable from a shell
The `pi-photocraft` bin SHALL start from a plain shell — including an agent's bash tool inside a pi session, with no TypeScript loader configured — both from the monorepo checkout and from an npm install (including pi's `~/.pi/agent/npm` prefix).

#### Scenario: npm-installed bin runs without a TypeScript loader
- **WHEN** the packed package is installed with npm into a fresh prefix and `pi-photocraft --help` is run with an empty `NODE_OPTIONS`
- **THEN** usage is printed and the exit code is `0`

#### Scenario: Workspace bin runs from the checkout
- **WHEN** `node_modules/.bin/pi-photocraft --help` is run in the monorepo
- **THEN** usage is printed and the exit code is `0`

### Requirement: ensure and path
`pi-photocraft ensure` SHALL provision the binary and print the provisioning report as one JSON object on stdout. `pi-photocraft path` SHALL provision the binary and print only its absolute path.

#### Scenario: path output is script-friendly
- **WHEN** `pi-photocraft path` succeeds
- **THEN** stdout contains exactly one line holding the absolute binary path and nothing else

### Requirement: exec pass-through (bash route)
`pi-photocraft exec <args…>` SHALL provision the binary, run it with `<args…>` passed verbatim as an argument vector (no shell interpretation), stream its stdin, stdout and stderr through unbuffered and unchanged, and exit with the binary's exit code.

#### Scenario: Arguments are not shell-interpreted
- **WHEN** `pi-photocraft exec run in.png --cmd filter.blur.gaussianBlur --params '{"radius":3}' --out "out file.png"` is run
- **THEN** the binary receives `--params` with the literal JSON and `--out` with `out file.png` as single arguments

#### Scenario: Large output is streamed, not buffered
- **WHEN** the binary writes more than 10 MB to stdout
- **THEN** all of it reaches `pi-photocraft exec`'s stdout and the command succeeds

#### Scenario: Exit code is propagated
- **WHEN** the binary exits with code `1` (e.g. unknown command id)
- **THEN** `pi-photocraft exec` exits with code `1` and the binary's error text appears on stderr

### Requirement: mcp server confined to the project
`pi-photocraft mcp` SHALL provision the binary and run its stdio MCP server, translating `--root <dir>` (default: the current working directory) into BOTH the server's automation read root and write root, and printing the root in use to stderr. `--help`/`-h` SHALL print usage and exit `0`. It SHALL reject any other option (including direct automation-root, bridge or control-token options), SHALL NOT start the server with unrestricted path access, and SHALL never attach to a desktop app. Because the server handles requests concurrently, the wrapper SHALL forward client `tools/call` requests to the server one at a time — the next is forwarded only after the server has responded to the previous one — while forwarding every other message immediately. Server stdout lines that are not JSON SHALL be diverted to stderr, never into the MCP channel. On SIGINT/SIGTERM it SHALL terminate the server child and exit with `130` (SIGINT) or `143` (SIGTERM).

#### Scenario: Default root is the cwd
- **WHEN** `pi-photocraft mcp` is started in `/work/proj` without `--root`
- **THEN** the MCP server can open and save files under `/work/proj` and rejects paths outside it

#### Scenario: Pipelined tool calls are serialized
- **WHEN** a client sends `doc_open` and then `command_run` without waiting for the first response
- **THEN** `command_run` reaches the server only after the `doc_open` response, and it succeeds against the opened document

#### Scenario: Unknown option rejected
- **WHEN** `pi-photocraft mcp --automation-read-root /` is run
- **THEN** a usage error is printed to stderr, no server is started, and the exit code is `1`

#### Scenario: MCP handshake works through the wrapper
- **WHEN** an MCP client sends `initialize` then `tools/list` to `pi-photocraft mcp`
- **THEN** it receives a successful initialize result with server name `photocraft` and a non-empty tool list including `doc_open`, `command_run` and `doc_save`

#### Scenario: Provisioning failure before the server starts
- **WHEN** provisioning fails during `pi-photocraft mcp`
- **THEN** nothing is written to stdout (the MCP channel stays clean), the error goes to stderr and the exit code is `69`

### Requirement: Opt-in MCP registration
`pi-photocraft mcp --register` SHALL add (or update) an entry named `photocraft` in the project's `.pi/mcp.json` under `mcpServers`, whose command is the absolute path of the running Node executable and whose arguments are the absolute path of the `pi-photocraft` launcher followed by `mcp` (no `--root`: pi starts project stdio servers with the session directory — the project root — as the working directory, which becomes the root), preserving every other key and server in the file, then exit without starting a server. It SHALL print to stderr that the entry is machine-specific (absolute paths), that pi only loads project MCP servers after the project is trusted, and that pi must be started in the project root (a session started in a subdirectory does not load `.pi/mcp.json`). Registration SHALL only happen on this explicit flag, never as a side effect of any other subcommand.

#### Scenario: Register into a missing file
- **WHEN** `.pi/mcp.json` does not exist
- **THEN** it is created containing only `mcpServers.photocraft`, whose command and first argument are absolute paths and whose remaining arguments are exactly `["mcp"]`
- **AND** stderr mentions the machine-specific paths, project trust and starting pi in the project root

#### Scenario: Register preserves other servers
- **WHEN** `.pi/mcp.json` already defines servers `filesystem` and `docs`
- **THEN** after registration both are unchanged and `photocraft` is added

#### Scenario: Malformed existing file
- **WHEN** `.pi/mcp.json` exists but is not valid JSON
- **THEN** the file is left untouched, an error naming the file is printed, and the exit code is `1`

#### Scenario: Registering outside a project root warns
- **WHEN** `mcp --register` runs in a directory containing neither `.git` nor `.pi/`
- **THEN** the entry is written and stderr warns that the directory does not look like a project root and that pi loads `.pi/mcp.json` only when started there

#### Scenario: Other subcommands never register
- **WHEN** `pi-photocraft mcp` (without `--register`), `ensure` or `exec` run
- **THEN** `.pi/mcp.json` is not created or modified

### Requirement: Shipped skill
The package SHALL ship a pi skill that teaches: provisioning via `pi-photocraft`; that the MCP route needs pi started in the project root of a trusted project; discovery of command ids and parameter schemas via `commands --filter` / `commands --json` before use; inspection via `info`; editing via `run` and `batch`; the bash and MCP routes and when to prefer each; that MCP tool calls must be issued sequentially (wait for each result); that MCP paths must lie under the project root; and recipes that combine with `pi-nano-banana` (replace part, remove object, insert generated asset, background swap, finishing/batch export).

#### Scenario: Skill is declared and discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists the photocraft skill, and its description names headless image editing with PhotoCraft and the nano-banana combination

### Requirement: Recommended-extensions manifest entry
The dashboard's curated recommended-extensions manifest SHALL include the package with `status: "optional"`, an npm source, and `unlocks` naming the photocraft skill and the `pi-photocraft` CLI.

#### Scenario: Entry present
- **WHEN** the recommended-extensions manifest is loaded
- **THEN** it contains an entry with id `@blackbelt-technology/pi-dashboard-photocraft` and `status: "optional"`
