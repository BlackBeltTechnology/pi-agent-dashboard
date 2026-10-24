# blender-cli-entrypoint Specification

## Purpose
The `pi-blender` command gives agents and users one way to provision and inspect the headless Blender WebAssembly runtime, run its stdio MCP server, and opt in to registering that server for a project. It ships with an agent skill and is listed as an optional recommended extension.

## Requirements

### Requirement: Subcommand dispatch and exit codes
`pi-blender` SHALL accept `ensure`, `status`, `mcp` and `mcp --register`. With no arguments or an unknown subcommand it SHALL print usage listing every subcommand to stderr and exit `1`. With `--help` it SHALL print the same usage and exit `0`. A provisioning or runtime-gate failure SHALL exit `69`.

#### Scenario: Unknown subcommand
- **WHEN** `pi-blender render` runs
- **THEN** usage listing `ensure`, `status` and `mcp` is printed to stderr and the exit code is `1`

#### Scenario: Help
- **WHEN** `pi-blender --help` runs from a plain shell
- **THEN** usage is printed and the exit code is `0`

### Requirement: Executable from a shell
The `pi-blender` bin SHALL start from a plain shell with no TypeScript loader configured, both from the monorepo checkout and from an npm install, including pi's `~/.pi/agent/npm` prefix.

#### Scenario: Installed package
- **WHEN** the packed package is installed under an npm prefix and `pi-blender status` runs from a plain shell
- **THEN** it prints a status report and exits `0`

### Requirement: ensure probes, then provisions
`pi-blender ensure [--json]` SHALL first probe JSPI support and, only when it is `native` or `flag`, provision the runtime. It SHALL then print the provisioning report and exit `0`, or exit `69` with the report's failure code.

#### Scenario: Ready on Node 24
- **WHEN** `pi-blender ensure --json` runs on Node 24 with access to the pinned tarball URL and an empty cache
- **THEN** it prints one JSON report with `source: "download"` and `jspi: "flag"`, and exits `0`

#### Scenario: Node 22
- **WHEN** `pi-blender ensure` runs on Node 22 with an empty cache
- **THEN** it reports `jspi: "unavailable"` with the "Node 24 or newer" requirement, makes no network request, and exits `69`

### Requirement: status reads the cache only
`pi-blender status [--json]` SHALL report the pinned version, the cached versions with their on-disk bytes, the active source (`override` when `BLENDER_WASM_DIR` is set), the licence and the JSPI probe result. It SHALL never download.

#### Scenario: Empty cache
- **WHEN** `pi-blender status` runs with an empty cache and no network
- **THEN** it reports the pinned version as not cached, makes no network request, and exits `0`

### Requirement: Lazy, opt-in MCP registration
No command SHALL register an MCP server as a side effect. `pi-blender mcp --register [--root <dir>]` SHALL add or update exactly one entry, `blender-wasm`, under `mcpServers` in `<cwd>/.pi/mcp.json`, preserving every other entry. It SHALL set the entry's `command` to the absolute Node executable and its `args` to the absolute launcher, `mcp` and, when given, `--root` with the root's absolute real path. It SHALL keep every other key of an existing `blender-wasm` entry.

#### Scenario: Register into an existing file
- **WHEN** `<cwd>/.pi/mcp.json` already defines a server `blender` and `pi-blender mcp --register` runs
- **THEN** the file gains `mcpServers["blender-wasm"]` with `args` ending `["mcp"]`, `mcpServers["blender"]` is unchanged, and the exit code is `0`

#### Scenario: Disabled entry stays disabled
- **WHEN** `mcpServers["blender-wasm"]` exists with `enabled: false` and an `env` object, and `pi-blender mcp --register` runs
- **THEN** the entry's `command` and `args` are updated, and `enabled: false` and `env` are unchanged

#### Scenario: Relative root stored absolute
- **WHEN** `pi-blender mcp --register --root assets` runs in `/work/proj` where `assets` exists
- **THEN** the stored `args` end with `["mcp", "--root", "/work/proj/assets"]`, or that directory's real path when it is a symlink

#### Scenario: ensure registers nothing
- **WHEN** `pi-blender ensure` or `pi-blender mcp` without `--register` runs in a project
- **THEN** `<cwd>/.pi/mcp.json` is not created or modified

### Requirement: Registration refuses unsafe or malformed targets
Registration SHALL leave the configuration byte-identical, print an error and exit `1` when:
- `<cwd>/.pi` or `<cwd>/.pi/mcp.json` is a symbolic link;
- the file is not valid JSON;
- its top-level value is not an object;
- its `mcpServers` is present but not an object.

A successful write SHALL be atomic.

#### Scenario: Malformed file untouched
- **WHEN** `<cwd>/.pi/mcp.json` is not valid JSON and `pi-blender mcp --register` runs
- **THEN** the file is left byte-identical, an error is printed, and the exit code is `1`

#### Scenario: Array root refused
- **WHEN** `<cwd>/.pi/mcp.json` contains `[1, 2]` and `pi-blender mcp --register` runs
- **THEN** the file is left byte-identical and the exit code is `1`

#### Scenario: Symlinked configuration refused
- **WHEN** `<cwd>/.pi/mcp.json` is a symbolic link and `pi-blender mcp --register` runs
- **THEN** nothing is written through the link and the exit code is `1`

### Requirement: Registration notes
After a successful registration, the command SHALL print to stderr:
- that the entry holds machine-specific absolute paths;
- that pi loads project MCP servers only after the project is trusted;
- that pi must be started in the project root;
- that running `pi-blender ensure` first avoids a slow first tool call.

It SHALL also warn when the cwd contains neither `.git` nor `.pi/`.

#### Scenario: Notes printed
- **WHEN** `pi-blender mcp --register` succeeds in a directory without `.git`
- **THEN** stderr contains the machine-specific-paths, project-trust, project-root and `pi-blender ensure` notes and the not-a-project-root warning

### Requirement: Agent skill
The package SHALL ship a `blender` skill telling agents:
- when to use the server and how to register it;
- the build limits: no Subsurf/OpenSubdiv, no rendering, no USD or Alembic, no network or subprocess, about 1.2 GB per live session;
- that a `sessionReset: true` result means the scene was lost;
- that multi-file assets are imported through `blender_python` with `inputs`;
- a GLB-first workflow.

#### Scenario: Skill discoverable
- **WHEN** the package is installed in pi
- **THEN** pi lists a skill named `blender` whose description names headless Blender, 3D modelling and GLB export

### Requirement: Recommended-extensions manifest entry
The dashboard's recommended-extensions manifest SHALL include `@blackbelt-technology/pi-dashboard-blender` with `status: "optional"`, an npm source, and `unlocks` naming the `blender` skill, the `pi-blender` CLI and the `blender-wasm` MCP server.

#### Scenario: Entry present
- **WHEN** the manifest is loaded
- **THEN** it contains `@blackbelt-technology/pi-dashboard-blender` with `status: "optional"`
