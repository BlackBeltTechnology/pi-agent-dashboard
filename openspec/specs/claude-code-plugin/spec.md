# claude-code-plugin Specification

## Purpose
A Claude plugin (skills only) that lets a Claude Code session on the user's own machine bring the local pi-dashboard server up without starting a second instance, and then orchestrate pi sessions through the dashboard's REST API. The plugin stays installable from every Claude surface.

## Requirements

### Requirement: Plugin is installable on every Claude surface

The repository SHALL ship a Claude plugin directory whose manifest, `.claude-plugin/plugin.json`:
- has the plugin name `pi-dashboard`;
- carries `name`, `version`, `description`, `author` and `license`;
- does not carry `displayName`, which Claude Code's validator rejects.

The directory SHALL contain a `README.md` of at least 40 words outside code blocks, and a license. It SHALL NOT contain a top-level `bin/` directory, a `.mcp.json`, or a `hooks/` directory.

#### Scenario: Manifest validates

- **WHEN** `claude plugin validate` runs on the plugin directory
- **THEN** it SHALL report that validation passed with no errors

#### Scenario: No component that blocks Cowork or claude.ai installation

- **WHEN** the plugin directory is inspected
- **THEN** it SHALL contain no top-level `bin/`, no `.mcp.json` and no `hooks/`
- **AND** the manifest SHALL contain every required key and no `displayName`

#### Scenario: Accepted by claude.ai Customize > Plugins

- **WHEN** the plugin directory is zipped and uploaded through Customize > Plugins > Add > Upload plugin
- **THEN** claude.ai SHALL accept it and list both skills

### Requirement: Marketplace manifest at the repository root

The repository SHALL contain `.claude-plugin/marketplace.json` with:
- marketplace name `pi-agent-dashboard`;
- a marketplace `description`;
- a `pi-dashboard` entry whose relative `source` resolves to the plugin directory.

#### Scenario: Install from the marketplace

- **WHEN** a user adds the repository as a marketplace and installs `pi-dashboard@pi-agent-dashboard`
- **THEN** the install SHALL succeed
- **AND** the plugin's component inventory SHALL list the skills `pi-dashboard-bootstrap` and `pi-dashboard-control`, with no agents, hooks or MCP servers

### Requirement: Bootstrap runs as one foreground invocation with a line protocol

The bootstrap skill SHALL instruct the agent to run one bundled POSIX `sh` script as a single foreground shell call, with an explicit tool timeout of at least 600 seconds. The skill SHALL forbid starting the server through a background tool call, and SHALL forbid carrying state across separate shell calls.

The script SHALL write exactly one `STATUS=<value>` line to stdout for every outcome. The values are `already-running`, `started`, `busy`, `recovery`, `port-conflict`, `not-installed`, `sandbox` and `failed`.
- When the dashboard is ready (`already-running` or `started`), it SHALL also write `BASE=<url>`.
- All other output, including every launcher's stdout and stderr, SHALL go to stderr.
- Exit statuses: 0 ready, 1 failed, 2 sandbox, 3 busy or recovery, 4 not-installed, 5 port-conflict.

The skill SHALL instruct the agent to:
- use the literal `BASE` URL in later calls;
- re-run the script when the tool call itself times out. The script is idempotent.

#### Scenario: Server already up

- **WHEN** the script runs while a verified dashboard answers on the resolved port
- **THEN** stdout SHALL contain `STATUS=already-running` and the `BASE` URL, and nothing else
- **AND** the script SHALL exit 0 without invoking any launcher

#### Scenario: Server down and started

- **WHEN** the start conditions hold and a launcher is available
- **THEN** the script SHALL start the server detached and wait for a verified dashboard
- **AND** stdout SHALL contain only `STATUS=started` and the `BASE` URL, with exit status 0
- **AND** the server SHALL keep running after the agent's process exits

#### Scenario: Re-run after a timed-out tool call

- **WHEN** a previous run was killed by the tool timeout after the server had started
- **THEN** a re-run SHALL report `STATUS=already-running` without invoking any launcher

### Requirement: Dashboard identity is verified against the instance records

The instance records are `$HOME/.pi/dashboard/server.lock.meta.json` (the lock metadata, authoritative) and `$HOME/.pi/dashboard/server.pid` (advisory; written only after the server listens).

The script SHALL classify a `GET /api/health` response:
- as a **verified dashboard** only when the status is 200, the body has `"ok":true` and a numeric `"pid"`, and that pid equals the lock metadata's pid, or `server.pid` when the metadata is absent;
- when the body is `"ok":true` but no record matches: poll the records for up to 10 seconds. Without a match by then, classify as **port-conflict**;
- as **recovery** when the body has `"ok":false` and `"mode":"recovery"`;
- as **port-conflict** for any other HTTP response.

Credentials are only ever sent to a verified dashboard.

#### Scenario: Recovery-mode dashboard

- **WHEN** the port answers `/api/health` with `{"ok":false,"mode":"recovery",…}`
- **THEN** the script SHALL write `STATUS=recovery`, exit 3 and invoke no launcher

#### Scenario: Foreign service answering an ok-shaped body

- **WHEN** the port answers `/api/health` with `{"ok":true}` without a numeric `pid`, or with a pid that no record matches within 10 seconds
- **THEN** the script SHALL write `STATUS=port-conflict`, exit 5 and invoke no launcher

#### Scenario: Verify-only mode

- **WHEN** the script runs with `--check`
- **THEN** it SHALL classify the resolved port and report `already-running` (exit 0) only for a verified dashboard
- **AND** it SHALL never acquire a lock or invoke a launcher

### Requirement: A running, starting or present instance is never started over

The script SHALL invoke a launcher only when all of these hold:
- every probe of the resolved port, repeated across a window of at least 10 seconds (each with a 5-second timeout), fails with "connection refused";
- no live process is recorded in the lock metadata or in `server.pid`;
- every existing record is readable. An unreadable or partly written record counts as **unknown**, never as absent.

When a live process is recorded, or a record is unknown, while the port refuses: the dashboard is starting, restarting or stuck. The script SHALL then poll for a verified dashboard for up to 60 seconds, SHALL NOT launch, and reports `STATUS=busy` (exit 3) if none appears.

When the lock metadata records a live process on a different `httpPort`:
- if the port came from `config.json` or the default, the script SHALL classify that port instead. A verified dashboard there is reported as `STATUS=already-running` with that port's `BASE`;
- if the port came from an environment variable, the script SHALL write `STATUS=failed` (exit 1), naming the running instance's port, and SHALL NOT launch.

Before launching, the script SHALL acquire a per-port bootstrap lock: an atomic directory create at `$HOME/.pi/dashboard/claude-bootstrap-<port>.lock`, holding a `holder` file with the holder's pid.
- The lock is stale only when:
  - the holder file names a dead pid;
  - the holder file is missing and the lock is older than 1 minute; or
  - the lock is older than 11 minutes.
- A run that finds a live lock SHALL poll every 2 seconds for up to 170 seconds for a verified dashboard. If none appears, it reports `STATUS=busy` (exit 3) without launching.
- After acquiring the lock, the script SHALL check the start conditions again before launching.
- It SHALL release the lock on exit through a shell trap, by removing the `holder` file and the directory. It SHALL never remove the lock recursively.

#### Scenario: Port held but health silent

- **WHEN** a process holds the port but `/api/health` does not answer within the probes
- **THEN** the script SHALL write `STATUS=busy` with the server log path on stderr, exit 3 and invoke no launcher
- **AND** the running server's `server.pid` and lock metadata SHALL be unchanged

#### Scenario: Foreign service on the port

- **WHEN** the port answers HTTP but not with a dashboard or recovery body
- **THEN** the script SHALL write `STATUS=port-conflict`, exit 5 and invoke no launcher

#### Scenario: Server starting or restarting

- **WHEN** the port refuses connections while the lock metadata names a live process, and a verified dashboard answers within 60 seconds
- **THEN** the script SHALL report `STATUS=already-running`, invoke no launcher, and leave `server.pid` and the lock metadata unchanged

#### Scenario: Unreadable lock metadata

- **WHEN** the port refuses and the lock metadata exists but cannot be parsed
- **THEN** the script SHALL NOT invoke a launcher, and SHALL report `STATUS=busy` if no verified dashboard appears within 60 seconds

#### Scenario: Instance running on another port

- **WHEN** the port comes from `config.json`, the resolved port refuses, and the lock metadata records a live verified dashboard on port 18600
- **THEN** the script SHALL report `STATUS=already-running` with `BASE=http://localhost:18600` and invoke no launcher

#### Scenario: Explicit port while the instance runs elsewhere

- **WHEN** `DASHBOARD_PORT=18999` is set and the lock metadata records a live dashboard on port 18600
- **THEN** the script SHALL write `STATUS=failed` naming port 18600, exit 1 and invoke no launcher

#### Scenario: Two concurrent bootstraps

- **WHEN** two runs start together against a down dashboard
- **THEN** exactly one SHALL invoke a launcher
- **AND** the other SHALL wait on the lock and report `STATUS=already-running` once the dashboard is verified, or `STATUS=busy` after 170 seconds

### Requirement: Port resolution follows the dashboard's resolver

The script SHALL resolve the port with the precedence of the dashboard's shared port resolver:
1. `PI_DASHBOARD_PORT`;
2. `DASHBOARD_PORT`;
3. the top-level `port` in `$HOME/.pi/dashboard/config.json`;
4. `8000`.

A usable value is a plain decimal integer from 1 to 65535. An unusable value SHALL be ignored, and resolution continues with the next source.

Every CLI launch SHALL pass `--port <resolved>`, so the CLI binds where the script probes. The script SHALL NOT override `HOME` for any launcher.

#### Scenario: Unusable port ignored

- **WHEN** `DASHBOARD_PORT` is `abc`, `0` or `70000` and the config `port` is 18555
- **THEN** the script SHALL probe port 18555

#### Scenario: Launch passes the resolved port

- **WHEN** `DASHBOARD_PORT=18999` resolves and a CLI launch is required
- **THEN** the CLI SHALL be invoked as `start --port 18999`

#### Scenario: Precedence honoured

- **WHEN** `PI_DASHBOARD_PORT=18555` and `DASHBOARD_PORT=18999` are both set
- **THEN** the script SHALL probe port 18555

### Requirement: Launch-source order

When a start is required, the script SHALL use the first available launch source, in this order:
1. a `pi-dashboard` executable found, in order:
   - on `PATH`;
   - in known install directories: the npm global prefix's bin directory, the highest-versioned nvm Node, volta, `/opt/homebrew/bin`, `/usr/local/bin`;
   - through `"${SHELL:-/bin/zsh}" -lc 'command -v pi-dashboard'`. The login shell is non-interactive and never uses `-i`. Only the last output line that is an absolute path to an executable whose basename is `pi-dashboard` is accepted;
   - the most recent npx-cache copy (`~/.npm/_npx/*/node_modules/.bin/pi-dashboard`) whose package version is not a prerelease. It is reported as non-durable.
2. on macOS only (`uname` = Darwin, `open` available), and only when the port came from `config.json` or the default: `open -g -b com.blackbelt-technology.pi-dashboard`. A non-zero exit means the app is not installed.
3. a consented install (see "Consented install of the latest release").

When a launch source fails (for example the CLI's `start` exits non-zero), the script SHALL write `STATUS=failed` and exit 1 without trying a later source.

When no source is available and `--install` was not passed, the script SHALL write `STATUS=not-installed` with the install command on stderr, exit 4, and run neither npm nor npx. The skill SHALL instruct the agent to tell the user what the install does, and to wait for an explicit yes, before re-running with `--install`:
- a global npm install of the latest release, on the machine running this Claude session;
- about 1 GB and about a minute;
- it adds the `pi-dashboard` command and the pi bridge;
- the user should decline if this session runs in Cowork or on the web.

#### Scenario: No local install and no consent

- **WHEN** no CLI and no app are found and `--install` is absent
- **THEN** the script SHALL exit 4 with `STATUS=not-installed` and SHALL NOT run npm or npx

#### Scenario: CLI only in a known install directory

- **WHEN** `pi-dashboard` is absent from `PATH` but present under the highest-versioned nvm Node's `bin`
- **THEN** the script SHALL launch that executable

#### Scenario: Electron app present on macOS

- **WHEN** no CLI is found on macOS, the port came from config or the default, and `open -g -b com.blackbelt-technology.pi-dashboard` succeeds
- **THEN** the script SHALL wait for a verified dashboard instead of installing

#### Scenario: Not macOS

- **WHEN** the script runs on Linux or Windows
- **THEN** it SHALL NOT invoke `open`

#### Scenario: Launcher fails

- **WHEN** the selected CLI's `start` exits non-zero
- **THEN** the script SHALL write `STATUS=failed`, exit 1, and SHALL NOT try another launch source

### Requirement: Consented install of the latest release

With `--install`, the script SHALL first check prerequisites: npm must be resolvable (same lookup as the CLI), and Node must be in the dashboard's usable Node range: the repository's `engines.node` range (`>=22.19.0 <27`), excluding the Fastify-affected versions v22.0–v22.18 and v24.1–v24.2, the same accept-set the doctor uses. If either check fails, it SHALL write `STATUS=failed` and exit 1 without downloading.

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

- **WHEN** `--install` is passed and the resolved Node is outside the usable range (for example v22.18.0, v24.2.0 or v27.0.0)
- **THEN** the script SHALL write `STATUS=failed`, exit 1 naming the usable range, and SHALL NOT run npm or npx

#### Scenario: Prerelease refused

- **WHEN** the installed package version contains `-`
- **THEN** the script SHALL write `STATUS=failed` and SHALL NOT start the server

#### Scenario: Later session after a global install

- **WHEN** a later run finds the globally installed CLI, with the server down
- **THEN** the script SHALL launch it without `--install`

### Requirement: Bounded readiness wait

After launching, the script SHALL poll for a verified dashboard for at most 60 seconds. If none is verified by then, it SHALL write `STATUS=failed`, exit 1, and print the server log path to stderr.

#### Scenario: Server never becomes healthy

- **WHEN** a launcher succeeds but no dashboard is verified within 60 seconds
- **THEN** the script SHALL exit 1 with `STATUS=failed` and the server log path

### Requirement: Sandbox refusal

The script SHALL write `STATUS=sandbox` and exit 2, before any probe, lock or launch, when any of these hold:
- `CLAUDE_CODE_IS_COWORK` is non-empty;
- `CLAUDE_CODE_REMOTE` is non-empty;
- `CLAUDE_CONFIG_DIR` begins with `/sessions/` (the Cowork VM layout).

The skill SHALL instruct the agent to tell the user to use Claude Code on their own machine, and SHALL forbid workarounds.

#### Scenario: Cowork session

- **WHEN** the script runs with `CLAUDE_CODE_IS_COWORK=1`
- **THEN** it SHALL exit 2 with `STATUS=sandbox` and invoke no launcher
- **AND** the agent SHALL relay the "use Claude Code on your machine" message

#### Scenario: Local Claude Code session

- **WHEN** the script runs in a local Claude Code CLI or desktop Code-tab session
- **THEN** none of the sandbox markers SHALL be set, and the script SHALL NOT report `sandbox`

### Requirement: Control skill drives the REST API with curl

The plugin's `pi-dashboard-control` skill SHALL drive the dashboard through its REST API with curl against the bootstrap's `BASE`.

Its `references/api-reference.md` SHALL equal `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md` with the "WebSocket bus verbs" section removed, and with no other difference. Derivation SHALL fail when that section heading is not found in the source.

No file the plugin ships SHALL reference the WebSocket bus client, `dashboard-bus.ts`, `dashboard-api.sh`, or the pi-only command templates.

Every REST route the skill names (method and path) SHALL be registered by the server.

#### Scenario: Drift detected

- **WHEN** the derived reference differs from the transformed source
- **THEN** the parity test SHALL fail, naming the file and the sync command that fixes it

#### Scenario: Forbidden reference

- **WHEN** any shipped plugin file mentions the bus client, `dashboard-bus.ts`, `dashboard-api.sh` or a pi command template
- **THEN** the plugin test SHALL fail, naming the file and the reference

#### Scenario: Control after bootstrap

- **WHEN** the agent has a `BASE` URL from the bootstrap and the user asks for the pi sessions
- **THEN** the agent SHALL list them via `GET <BASE>/api/sessions` without additional setup

### Requirement: Token handling stays with the user

The plugin SHALL NOT mint, write, store or cache dashboard credentials.

A dashboard call is refused when it returns 401, or 403 with `"reason":"local_proof_required"`. In that case the control skill SHALL instruct the agent to ask the user to run `pi-dashboard token create --label claude-code --tier control`. A higher tier is requested only when the user explicitly asks for one.

The skill SHALL instruct the agent:
- preferably, to have the user save the line `Authorization: Bearer <token>` into a file they create with owner-only permissions, and to send it with `curl -H @<file>`;
- otherwise, to accept a pasted token, send it only in an `Authorization: Bearer` header, and never write it to a file or repeat it in output;
- to run every credentialed request in the same shell command after a successful `ensure-dashboard.sh --check`;
- never to create the header file itself;
- never to use curl verbose or trace options on credentialed requests.

#### Scenario: Strict mode refusal

- **WHEN** a control call returns 403 with `"reason":"local_proof_required"`
- **THEN** the agent SHALL ask the user for a token created with `pi-dashboard token create --label claude-code --tier control`
- **AND** it SHALL NOT attempt to create one itself

#### Scenario: Header file used

- **WHEN** the user has saved the header file and names its path
- **THEN** the agent SHALL send requests as `sh <script> --check && curl -H @<path> …`, and the token SHALL NOT appear in the conversation

#### Scenario: Port re-bound after bootstrap

- **WHEN** the dashboard exits and another process binds its port before a credentialed call
- **THEN** `--check` SHALL fail, and the credentials SHALL NOT be sent

### Requirement: Plugin version tracks the repository version

The `version` in the plugin manifest SHALL equal the repository root `package.json` version after the release version-sync step. The stamped manifest SHALL be part of the release commit on both release paths: the dispatched workflow, and the local `release-cut` tag push.

A tag-push release whose tagged tree carries a different plugin version SHALL fail before any version sync rewrites the working copy, and before publishing. The local `release-cut` flow SHALL verify the equality before creating the tag.

#### Scenario: Release bump stamps the plugin

- **WHEN** the release version-sync step runs after a version bump
- **THEN** `plugin.json` `version` SHALL equal the new root version
- **AND** the release commit SHALL include `plugin.json`

#### Scenario: Stale plugin version at release

- **WHEN** a release tag points at a tree whose `plugin.json` version differs from the tag version
- **THEN** the release workflow SHALL fail before running the version sync and before publishing any package

### Requirement: Each release attaches an uploadable plugin package

The release pipeline SHALL attach `pi-dashboard-claude-plugin-<version>.zip` to the GitHub Release. The zip SHALL contain the contents of the plugin directory with `.claude-plugin/plugin.json` at the zip root, and no `.DS_Store` entries. The build SHALL fail when the manifest `version` differs from the release version.

#### Scenario: Zip layout

- **WHEN** the zip build runs with the plugin's own version
- **THEN** the archive SHALL list `.claude-plugin/plugin.json`, both `SKILL.md` files, `README.md` and `LICENSE` at its root-relative paths
- **AND** it SHALL contain no top-level `bin/`, `.mcp.json` or `hooks/`

#### Scenario: Version mismatch refused

- **WHEN** the zip build runs with a version that differs from `plugin.json`
- **THEN** it SHALL exit non-zero naming both versions and write no zip

#### Scenario: Attached to the release

- **WHEN** the `github-release` job runs
- **THEN** it SHALL build the zip before creating the release, and the release's `files` SHALL include it

### Requirement: Control skill shows a session in the browser
The `pi-dashboard-control` skill SHALL include a "View a session in the browser" section: use the full `id` or `uiUrl` / `diffUrl` from `GET /api/sessions` (never a shortened id), open it in the agent's browser (`?embed=1` for a narrow pane), let the user sign in inside the pane, treat "Session not found" as a wrong or archived id, and point to the reference's "UI routes" section.

#### Scenario: Never shorten the id
- **WHEN** the agent builds a session URL without `uiUrl`
- **THEN** the skill SHALL direct it to use `<BASE>/session/<full id>` exactly as listed

#### Scenario: Not found page
- **WHEN** the opened page shows "Session not found"
- **THEN** the skill SHALL direct the agent to re-list sessions and use a full id from the response
- **AND** for a session that is no longer listed, to look it up in `GET /api/sessions/archived` and open `<BASE>/session/<full id>?archived=1`

#### Scenario: Agent shows a session to the user
- **WHEN** the user asks the agent to show a pi session and the agent has `BASE`
- **THEN** the agent SHALL list sessions via `GET <BASE>/api/sessions` and open that row's `uiUrl` (with `?embed=1` in a narrow pane) in its browser

#### Scenario: Derived reference carries UI routes
- **WHEN** `node scripts/sync-claude-plugin.mjs` regenerates `references/api-reference.md`
- **THEN** the plugin reference SHALL contain the "UI routes (browser)" section from the extension source
- **AND** the parity test SHALL assert that section is present and SHALL pass

### Requirement: UI links never carry credentials
The control skill SHALL instruct the agent never to place a token, header value or other credential in a dashboard UI URL; when the page asks to sign in, the user signs in inside the browser pane.

#### Scenario: Listing with auth enabled
- **WHEN** auth is enabled and the agent lists sessions to find a `uiUrl`
- **THEN** the skill SHALL direct it to the existing token rules for the REST call, independent of the user's sign-in in the pane

#### Scenario: Auth enabled
- **WHEN** the opened page shows the dashboard sign-in screen
- **THEN** the agent SHALL ask the user to sign in in the browser pane
- **AND** it SHALL NOT append a token to the URL
