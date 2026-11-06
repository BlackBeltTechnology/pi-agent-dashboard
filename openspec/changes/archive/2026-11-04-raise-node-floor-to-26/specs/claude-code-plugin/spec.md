## MODIFIED Requirements

### Requirement: Consented install of the latest release

With `--install`, the script SHALL first check prerequisites: npm must be resolvable (same lookup as the CLI), and Node must be in the dashboard's usable Node range: the repository's `engines.node` range (`>=26.0.0 <27`), the same accept-set the doctor uses. The script's range constants SHALL be pinned to `package.json#engines.node` by a repo-lint test. If either check fails, it SHALL write `STATUS=failed` and exit 1 without downloading.

It SHALL run `npm install -g @blackbelt-technology/pi-agent-dashboard@latest` with `npm_config_allow_remote=all` set on that command only.

It SHALL then resolve the installed CLI (on `PATH`, else under the npm global prefix) and read the installed package version. It SHALL refuse with `STATUS=failed` when that version is a prerelease (contains `-`). Otherwise it starts the CLI detached.

Only when the global install fails, the script SHALL:
- print a remediation hint to stderr that leads with configuring a user-writable npm prefix; it SHALL NOT recommend `sudo`;
- fetch the package into the npm cache with `npm_config_allow_remote=all`;
- start it with `npx --yes @blackbelt-technology/pi-agent-dashboard@latest start --port <resolved>` **without** that variable;
- report that this runtime lives in the npm cache and is not durable.

No server process SHALL be started with `npm_config_allow_remote` in its environment. Every npm or npx invocation that installs or executes the package SHALL use the spec `@blackbelt-technology/pi-agent-dashboard@latest`.

On success, stdout SHALL contain `INSTALL=global` or `INSTALL=npx-cache` besides the `STATUS` and `BASE` lines.

#### Scenario: Global install succeeds

- **WHEN** `--install` is passed and `npm install -g …@latest` succeeds with a non-prerelease version
- **THEN** the script SHALL start the installed CLI detached with `--port`
- **AND** stdout SHALL contain `INSTALL=global`, `STATUS=started` and `BASE`
- **AND** npx SHALL NOT be invoked

#### Scenario: Global prefix not writable

- **WHEN** `--install` is passed and the global install fails
- **THEN** the script SHALL print the npm-prefix hint and fetch with `npm_config_allow_remote=all`
- **AND** it SHALL start via `npx --yes …@latest start --port <resolved>` without that variable
- **AND** stdout SHALL contain `INSTALL=npx-cache`, and stderr the non-durable warning

#### Scenario: Node too old

- **WHEN** `--install` is passed and the resolved Node is outside the usable range (for example v22.19.0, v24.15.0, v25.9.0 or v27.0.0)
- **THEN** the script SHALL write `STATUS=failed`, exit 1 naming the usable range, and SHALL NOT run npm or npx

#### Scenario: Prerelease refused

- **WHEN** the installed package version contains `-`
- **THEN** the script SHALL write `STATUS=failed` and SHALL NOT start the server

#### Scenario: Later session after a global install

- **WHEN** a later run finds the globally installed CLI, with the server down
- **THEN** the script SHALL launch it without `--install`
