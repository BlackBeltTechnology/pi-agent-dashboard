## MODIFIED Requirements

### Requirement: Executable from a shell
The `pi-photocraft` bin SHALL start from a plain shell — including an agent's bash tool inside a pi session, with no TypeScript loader configured — both from the monorepo checkout and from an npm install (including pi's `~/.pi/agent/npm` prefix). It SHALL be shipped by `@blackbelt-technology/pi-dashboard-craft-apps`; the deprecated `@blackbelt-technology/pi-dashboard-photocraft` package SHALL keep a `bin/pi-photocraft` launcher at its previous path that forwards to the craft-apps implementation, so absolute paths written by earlier `mcp --register` runs stay valid.

#### Scenario: npm-installed bin runs without a TypeScript loader
- **WHEN** the packed package is installed with npm into a fresh prefix and `pi-photocraft --help` is run with an empty `NODE_OPTIONS`
- **THEN** usage is printed and the exit code is `0`

#### Scenario: Workspace bin runs from the checkout
- **WHEN** `node_modules/.bin/pi-photocraft --help` is run in the monorepo
- **THEN** usage is printed and the exit code is `0`

#### Scenario: Legacy registration keeps working
- **WHEN** a project's `.pi/mcp.json` `photocraft` entry points at the deprecated package's `bin/pi-photocraft` and that package is upgraded to the shim release
- **THEN** pi starts the MCP server through the shim and `tools/list` succeeds

### Requirement: Recommended-extensions manifest entry
The dashboard's curated recommended-extensions manifest SHALL NOT list `@blackbelt-technology/pi-dashboard-photocraft`; PhotoCraft is unlocked through the `@blackbelt-technology/pi-dashboard-craft-apps` entry, whose `unlocks` name the photocraft skill and the `pi-photocraft` CLI.

#### Scenario: Entry present
- **WHEN** the recommended-extensions manifest is loaded
- **THEN** it contains no entry with id `@blackbelt-technology/pi-dashboard-photocraft`, and the `@blackbelt-technology/pi-dashboard-craft-apps` entry's `unlocks` include `pi-photocraft`
