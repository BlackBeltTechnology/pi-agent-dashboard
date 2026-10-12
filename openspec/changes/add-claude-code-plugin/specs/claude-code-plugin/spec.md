## Purpose

A Claude plugin (skills only) that lets a Claude Code session on the user's own machine bring the local pi-dashboard server up without ever starting a second instance, then orchestrate pi sessions through the dashboard's REST API. The plugin is installable from every Claude surface.

## ADDED Requirements

### Requirement: Plugin is installable on every Claude surface

The repository SHALL ship a Claude plugin directory whose manifest, `.claude-plugin/plugin.json`:
- has the plugin name `pi-dashboard`;
- has the fields `name`, `version`, `description`, `author` and `license`;
- has no field that Claude Code's validator rejects.

The plugin directory SHALL contain a `README.md` of at least 40 words outside code blocks, and a license. It SHALL NOT contain a top-level `bin/` directory, a `.mcp.json`, or hooks.

#### Scenario: Manifest validates

- **WHEN** `claude plugin validate` runs on the plugin directory
- **THEN** it SHALL report that validation passed with no errors

#### Scenario: No component that blocks Cowork or claude.ai installation

- **WHEN** the plugin directory is inspected
- **THEN** it SHALL contain no top-level `bin/` directory, no `.mcp.json` and no `hooks/` directory

### Requirement: Marketplace manifest at the repository root

The repository SHALL contain `.claude-plugin/marketplace.json`. It SHALL list the `pi-dashboard` plugin with a relative `source` that resolves to the plugin directory, and SHALL carry a marketplace `description`.

#### Scenario: Install from the marketplace

- **WHEN** a user adds the repository as a marketplace and installs `pi-dashboard@pi-agent-dashboard`
- **THEN** the install SHALL succeed
- **AND** the plugin's two skills, `pi-dashboard-bootstrap` and `pi-dashboard`, SHALL be listed in its component inventory

### Requirement: Bootstrap runs as one foreground invocation

The bootstrap skill SHALL instruct the agent to run a single bundled script as ONE foreground shell call. The skill SHALL NOT instruct the agent to start the server through a background tool call, or to carry state across separate shell calls.

On success the script SHALL print a machine-readable `STATUS=<already-running|started>` line and a `BASE=<url>` line. The skill SHALL instruct the agent to use the literal `BASE` URL in later calls.

#### Scenario: Server already up

- **WHEN** the script runs while a healthy dashboard answers `/api/health` on the resolved port
- **THEN** it SHALL print `STATUS=already-running` and the `BASE` URL
- **AND** it SHALL exit 0 without invoking any launcher

#### Scenario: Server down and started

- **WHEN** the resolved port refuses connections and a launcher is available
- **THEN** the script SHALL start the server detached
- **AND** it SHALL wait for `/api/health` to report healthy
- **AND** it SHALL print `STATUS=started` and the `BASE` URL, then exit 0
- **AND** the server SHALL keep running after the agent's process exits

### Requirement: A running or present instance is never started over

The script SHALL invoke a launcher ONLY when the resolved port refuses TCP connections. It SHALL probe `/api/health` up to three times, each with a 5-second timeout, before concluding anything.

#### Scenario: Port held but health silent

- **WHEN** a process holds the port but `/api/health` does not answer within the probes (for example, an overloaded dashboard)
- **THEN** the script SHALL NOT invoke any launcher
- **AND** it SHALL report `BUSY` with the path of the server log
- **AND** it SHALL exit with status 3
- **AND** the running server's `server.pid` and lock metadata SHALL be left unchanged

#### Scenario: Foreign service on the port

- **WHEN** the port answers HTTP, but not with a dashboard health response
- **THEN** the script SHALL NOT invoke any launcher
- **AND** it SHALL report `PORT_CONFLICT`, telling the user to set `DASHBOARD_PORT`
- **AND** it SHALL exit with status 5

### Requirement: Port resolution

The script SHALL resolve the port in this order:
1. `DASHBOARD_PORT`;
2. the `port` in `<home>/.pi/dashboard/config.json`, where `<home>` is `DASHBOARD_HOME` when set, otherwise `HOME`;
3. `8000`.

A resolved value that is not a positive integer SHALL abort the run before any probe or launch.

#### Scenario: Invalid port refused

- **WHEN** `DASHBOARD_PORT` is set to a non-numeric value
- **THEN** the script SHALL exit with status 1 without probing or invoking a launcher

#### Scenario: Config port used

- **WHEN** `DASHBOARD_PORT` is unset and the config file declares port 18555
- **THEN** the script SHALL probe `http://localhost:18555/api/health`

### Requirement: Launch-source order with consent before download

When a start is required, the script SHALL use the first available launch source, in this order:
1. the `pi-dashboard` CLI found on `PATH`, or else through the user's login shell, or else under the npm global prefix;
2. on macOS, the installed Electron app, opened by its bundle identifier `com.blackbelt-technology.pi-dashboard`;
3. a consented install of the latest release (see "Consented install of the latest release").

#### Scenario: No local install and no consent

- **WHEN** no CLI and no Electron app are found and `DASHBOARD_ALLOW_INSTALL` is unset
- **THEN** the script SHALL NOT run npm or npx
- **AND** it SHALL exit 4, printing `NOT_INSTALLED` with the install command and the approximate download size
- **AND** the skill SHALL instruct the agent to ask the user for consent before re-running with `DASHBOARD_ALLOW_INSTALL=1`

#### Scenario: CLI only reachable through the login shell

- **WHEN** `pi-dashboard` is absent from the process `PATH` but resolvable in the user's login shell
- **THEN** the script SHALL launch that resolved CLI

#### Scenario: Electron app present

- **WHEN** no CLI is found and the macOS app with bundle identifier `com.blackbelt-technology.pi-dashboard` is installed
- **THEN** the script SHALL open the app and wait for `/api/health` instead of running npx

### Requirement: Consented install of the latest release

With `DASHBOARD_ALLOW_INSTALL=1`, the script SHALL first check prerequisites: npm must be resolvable (on `PATH` or through the login shell), and Node must be at least the release's minimum version, 22.19. If either is missing, it SHALL exit 1 with the minimum Node version and without downloading.

It SHALL then install the latest published release globally with `npm install -g @blackbelt-technology/pi-agent-dashboard@latest`, resolve the installed CLI (on `PATH`, else under the npm global prefix), and start it detached.

Only when the global install fails, the script SHALL start the server with `npx -y @blackbelt-technology/pi-agent-dashboard@latest start`, and SHALL report that this runtime lives in the npm cache and is not durable.

The package spec SHALL always be pinned to the `latest` dist-tag. On success the script SHALL print `INSTALL=global` or `INSTALL=npx-cache` in addition to the `STATUS` and `BASE` lines.

#### Scenario: Global install succeeds

- **WHEN** consent is given and `npm install -g …@latest` succeeds
- **THEN** the script SHALL start the installed CLI detached
- **AND** it SHALL print `INSTALL=global`, `STATUS=started` and `BASE`
- **AND** npx SHALL NOT be invoked

#### Scenario: Global prefix not writable

- **WHEN** consent is given and the global install fails
- **THEN** the script SHALL start via `npx -y …@latest start`
- **AND** it SHALL print `INSTALL=npx-cache`
- **AND** it SHALL warn that the runtime is not durable and name the global install command for later

#### Scenario: Node too old

- **WHEN** consent is given and the resolved Node version is below 22.19
- **THEN** the script SHALL exit 1 naming the minimum Node version, without running npm or npx

#### Scenario: Later session after a global install

- **WHEN** a later session runs the script after a successful global install, with the server down
- **THEN** the script SHALL launch through the installed CLI (source 1) without asking for consent again

### Requirement: Bounded readiness wait

After launching, the script SHALL poll `/api/health` for at most 60 seconds. If the server is not healthy by then, the script SHALL exit with status 1 and name the server log path.

#### Scenario: Server never becomes healthy

- **WHEN** a launcher succeeds but `/api/health` stays unhealthy for 60 seconds
- **THEN** the script SHALL exit 1 and print the server log path

### Requirement: Sandbox refusal

When the environment shows that the session does not run on the user's computer (`CLAUDE_CODE_IS_COWORK` or `CLAUDE_CODE_REMOTE` is non-empty), the script SHALL exit with status 2 and print `SANDBOX` without probing or launching. The skill SHALL instruct the agent to tell the user to use Claude Code on their own machine, and SHALL forbid attempting workarounds.

#### Scenario: Cowork session

- **WHEN** the script runs with `CLAUDE_CODE_IS_COWORK=1`
- **THEN** it SHALL exit 2 without invoking any launcher
- **AND** the agent SHALL relay the "use Claude Code on your machine" message

### Requirement: Control skill derived from the extension skill

The plugin's `pi-dashboard` skill SHALL drive the dashboard through its REST API, using curl and the bundled `dashboard-api.sh`. It SHALL NOT reference the WebSocket bus CLI or the pi-only command templates.

Its `references/api-reference.md`, `references/recipes.md` and `scripts/dashboard-api.sh` SHALL be byte-identical to the same files under `packages/extension/.pi/skills/pi-dashboard/`.

#### Scenario: Drift detected

- **WHEN** a derived file differs from its source in the extension skill
- **THEN** the parity test SHALL fail, naming the file and the sync command that fixes it

#### Scenario: Control after bootstrap

- **WHEN** the agent has a `BASE` URL from the bootstrap and the user asks for the pi sessions
- **THEN** the agent SHALL list them via `GET <BASE>/api/sessions` without additional setup

### Requirement: Token handling stays with the user

The plugin SHALL NOT mint, store or cache dashboard credentials. When a dashboard call is refused with 401 or `local_proof_required`, the control skill SHALL instruct the agent to:
- ask the user to run `pi-dashboard token create --label claude-code --tier <tier>`;
- send the supplied token only in an `Authorization: Bearer` header;
- never write the token to a file and never repeat it in output.

#### Scenario: Strict mode refusal

- **WHEN** a control call returns 401 with `local_proof_required`
- **THEN** the agent SHALL ask the user for a token created with `pi-dashboard token create`
- **AND** it SHALL NOT attempt to create one itself

### Requirement: Plugin version tracks the repository version

The `version` in the plugin manifest SHALL equal the repository root `package.json` version after the release version bump, so that each release publishes a plugin update.

#### Scenario: Release bump stamps the plugin

- **WHEN** the release version-sync step runs after a version bump
- **THEN** `plugin.json` `version` SHALL equal the new root version
