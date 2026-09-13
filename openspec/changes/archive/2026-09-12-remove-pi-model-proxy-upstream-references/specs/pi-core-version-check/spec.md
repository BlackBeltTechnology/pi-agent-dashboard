## MODIFIED Requirements

### Requirement: Core package discovery
The server SHALL discover all installed pi ecosystem core packages from both global npm and the managed install directory (`~/.pi-dashboard/node_modules/`) using a strict whitelist of package names. The `pi-*` name-prefix heuristic SHALL NOT be used.

The whitelist consists of:

- `@earendil-works/pi-coding-agent` (primary fork)
- `@mariozechner/pi-coding-agent` (legacy fork retained for backward compatibility)
- `@blackbelt-technology/pi-agent-dashboard`

The whitelist SHALL NOT include `@oh-my-pi/pi-coding-agent`, and SHALL NOT include `@blackbelt-technology/pi-model-proxy` (superseded by the dashboard's built-in model proxy).

#### Scenario: Global npm packages discovered
- **WHEN** the server runs `npm list -g --depth=0 --json`
- **THEN** it SHALL parse the output and identify pi ecosystem packages by matching ONLY the whitelist above
- **AND** each discovered package SHALL include its installed version from the JSON output

#### Scenario: Non-whitelisted pi-prefixed package ignored
- **WHEN** `npm list -g` includes a package whose name starts with `pi-` (e.g., `pi-agent-browser`, `pi-web-access`) but is NOT in the whitelist
- **THEN** the package SHALL NOT appear in the core discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/status`

#### Scenario: Installed upstream pi-model-proxy ignored
- **WHEN** `@blackbelt-technology/pi-model-proxy` is present in either global or managed install
- **THEN** it SHALL NOT appear in the discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/status` or the Update All set

#### Scenario: Legacy oh-my-pi install ignored
- **WHEN** `@oh-my-pi/pi-coding-agent` is present in either global or managed install
- **THEN** it SHALL NOT appear in the discovery result
- **AND** the user SHALL receive no upgrade hint for it (the dashboard does not support that fork)

#### Scenario: Both supported forks present uses earendil
- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` are present in global npm
- **THEN** both SHALL appear in the discovery result with their respective install sources
- **AND** the dashboard SHALL prefer earendil for runtime resolution (per the package-management spec)

#### Scenario: Managed install packages discovered
- **WHEN** the directory `~/.pi-dashboard/node_modules/` exists
- **THEN** the server SHALL scan it ONLY for packages matching the whitelist by reading each matching `package.json`
- **AND** mark their `installSource` as `"managed"`

#### Scenario: Managed directory does not exist
- **WHEN** `~/.pi-dashboard/node_modules/` does not exist
- **THEN** the server SHALL skip managed scanning without error
- **AND** only return globally installed whitelisted packages

#### Scenario: npm list command fails
- **WHEN** `npm list -g --depth=0 --json` fails or times out (30s)
- **THEN** the server SHALL log a warning and return an empty list for global packages

#### Scenario: Duplicate package in both sources
- **WHEN** a whitelisted package is found in both global npm and managed install
- **THEN** the managed install version SHALL take precedence
