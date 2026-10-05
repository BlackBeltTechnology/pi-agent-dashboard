# packaging Specification

## Purpose
Distribution surface of the dashboard: npm package shape, bin entry wrapper, peer/runtime dependencies, bundled web client, configuration file location, and architecture documentation. Defines what shipped artifacts contain and how they are installed.

## Requirements

### Requirement: Pi package format
The project SHALL be distributed as a pi package installable via `pi install` under the `@blackbelt-technology/pi-dashboard` npm scope. The `package.json` SHALL declare the bridge extension under the `pi.extensions` key so it auto-loads in all pi sessions after installation.

#### Scenario: Install via pi
- **WHEN** a user runs `pi install npm:@blackbelt-technology/pi-dashboard`
- **THEN** the bridge extension SHALL be registered globally and load in all subsequent pi sessions

#### Scenario: Extension auto-loads
- **WHEN** pi starts after the package is installed
- **THEN** the bridge extension SHALL load automatically and attempt to connect to the dashboard server

#### Scenario: Uninstall via pi
- **WHEN** a user runs `pi remove npm:@blackbelt-technology/pi-dashboard`
- **THEN** the bridge extension SHALL no longer load in pi sessions

### Requirement: Dashboard server CLI
The package SHALL provide a `pi-dashboard` CLI command (via `bin` in package.json) for starting the dashboard server. The CLI SHALL accept subcommands (`start`, `stop`, `restart`, `status`) and flags (`--port`, `--pi-port`, `--dev`, `--no-tunnel`). Precedence: CLI flags → environment variables (`PI_DASHBOARD_PORT`, `PI_DASHBOARD_PI_PORT`) → config file defaults.

#### Scenario: Start server
- **WHEN** a user runs `pi-dashboard`
- **THEN** the server SHALL start in the foreground on default ports (8000 for HTTP, 9999 for Pi Gateway) and print the URL

#### Scenario: Custom ports
- **WHEN** a user runs `pi-dashboard --port 3000 --pi-port 3001`
- **THEN** the server SHALL start on the specified ports

#### Scenario: Development mode
- **WHEN** a developer runs `pi-dashboard --dev`
- **THEN** the server SHALL skip serving static files (expects Vite dev server running separately)

#### Scenario: Disable tunnel
- **WHEN** a user runs `pi-dashboard --no-tunnel`
- **THEN** the server SHALL not create a zrok tunnel even if `tunnel.enabled` is `true` in config

### Requirement: Bin entry is plain JavaScript wrapper
The package's `bin.pi-dashboard` field SHALL point to `bin/pi-dashboard.mjs`, a plain ESM JavaScript file that selects a TypeScript loader at runtime (Node-native by default, jiti when `PI_DASHBOARD_TS_LOADER=jiti`, per `server-launch`) and re-execs Node with `--import <loader-url> packages/server/src/cli.ts <args>`. The wrapper SHALL NOT carry a tsx fallback; when jiti is selected and jiti resolution fails it SHALL exit 1 with an install-hint stderr message.

#### Scenario: Package bin entry after npm install
- **WHEN** the package is installed via `npm install`
- **THEN** the `pi-dashboard` symlink SHALL point to `bin/pi-dashboard.mjs`, an executable plain JS file that requires no TypeScript loader to parse itself

### Requirement: tsx removed from dependencies
The `tsx` package SHALL NOT appear in `dependencies` or `devDependencies` of any workspace `package.json`. `npm ls tsx` SHALL report no resolved entry under any workspace package (transitive shadow-installs by unrelated optional deps are exempt).

#### Scenario: Lockfile audit
- **WHEN** running `npm ls tsx` at the repo root after `npm install`
- **THEN** no workspace package SHALL list `tsx` as a direct dependency

### Requirement: Bundled web client
The web client SHALL be built with Vite and the production output SHALL be bundled into the npm package as static files. The dashboard server SHALL serve these files without requiring a separate build step.

#### Scenario: Serve bundled client
- **WHEN** the dashboard server starts from an installed package (non-dev mode)
- **THEN** it SHALL serve the pre-built web client from `dist/client/` using `@fastify/static`

#### Scenario: SPA fallback
- **WHEN** a GET request is made to a path that does not match a static file, `/api/*`, or `/ws`
- **THEN** the server SHALL return `index.html` to support client-side routing

### Requirement: Configuration file
The dashboard server SHALL support a configuration file at `~/.pi/dashboard/config.json` for persistent settings. See the `shared-config` spec for the full schema.

#### Scenario: Config file created on first run
- **WHEN** the server starts and no config file exists
- **THEN** it SHALL create `~/.pi/dashboard/config.json` with default values

#### Scenario: CLI overrides config file
- **WHEN** the config file sets `port: 3000` and the CLI passes `--port 4000`
- **THEN** the server SHALL use port 4000 (CLI wins)

### Requirement: Peer dependencies
The package SHALL declare `@earendil-works/pi-coding-agent` as an optional peer dependency so that the bridge extension resolves core packages from the host runtime's installation.

#### Scenario: Installed under pi
- **WHEN** the package is installed as a pi package via `pi install`
- **THEN** `@earendil-works/pi-coding-agent` satisfies the peer dependency

#### Scenario: No legacy fork peers
- **WHEN** the root `package.json` or any `packages/*/package.json` is inspected
- **THEN** neither `peerDependencies` nor `peerDependenciesMeta` SHALL contain `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai` or `@mariozechner/pi-tui`

### Requirement: Architecture documentation
The project SHALL maintain a `docs/architecture.md` file that describes the system architecture, data flow, protocol, and component interactions. This file SHALL be updated with every significant change per the project's code instructions.

#### Scenario: Architecture doc exists
- **WHEN** the project is initialized
- **THEN** a `docs/architecture.md` file SHALL exist describing the three-component architecture (extension, server, client), the protocol, and the data model

### Requirement: Root tarball excludes tests, fixtures and DOX sidecars under packages/

The root package's published file set SHALL NOT contain, under `packages/`, any `__tests__`, `__fixtures__` or `__mocks__` directory entry, any `*.test.*` or `*.spec.*` file, or any `AGENTS.md` or `*.AGENTS.md` file. The root `AGENTS.md` SHALL still be shipped. The exclusions SHALL be listed after every include in `files`, because npm-packlist ignores a negation that precedes the include it would narrow.

#### Scenario: Packed root has no test, fixture or sidecar files under packages/
- **WHEN** `npm pack --dry-run --json` runs at the repository root with CI's npm
- **THEN** no packed path under `packages/` contains `__tests__/`, `__fixtures__/` or `__mocks__/`, or matches `.test.`, `.spec.`, `AGENTS.md` or `.AGENTS.md`

#### Scenario: Root AGENTS.md still ships
- **WHEN** `npm pack --dry-run --json` runs at the repository root
- **THEN** the packed file set contains `AGENTS.md`

#### Scenario: Installed root boots without the excluded files
- **WHEN** the standalone install smoke (`scripts/test-standalone-npm-install.sh`, run by `publish.yml` through `_smoke.yml`) installs the packed root tarball and its workspace tarballs into an isolated `HOME`, then starts `pi-dashboard`
- **THEN** `/api/health` reports `ok: true` within the smoke's 60 s probe, and the installed root package directory contains no path under `packages/` that matches the excluded patterns
