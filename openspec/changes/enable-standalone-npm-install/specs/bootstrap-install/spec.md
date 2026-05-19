## ADDED Requirements

### Requirement: Standalone npm install reaches bootstrap ready without prerequisites

The `pi-dashboard` CLI launched from a clean `npm install -g @blackbelt-technology/pi-agent-dashboard` SHALL boot to a running HTTP server and serve the web UI within the normal startup window with **no** pi installation prerequisite, then transition the bootstrap state from `installing` → `ready` once `@earendil-works/pi-coding-agent` and `@fission-ai/openspec` are installed into the managed directory.

The runtime path SHALL be:

1. The bin wrapper (`packages/server/bin/pi-dashboard.mjs`) SHALL resolve `jiti` via `createRequire(argv[1]).resolve("jiti/package.json")` — succeeding because `jiti` is a direct dependency of `@blackbelt-technology/pi-dashboard-server` (regression guarded by the dep-shape gate in `scripts/verify-release-deps.mjs`).
2. `cli.ts::runForeground` SHALL start the HTTP server **before** any pi-install work begins, so the UI is available immediately in degraded mode.
3. After `server.start()`, `cli.ts::runDegradedModeBootstrap` SHALL probe the `ToolRegistry` for `pi`. When unresolvable AND no managed pi install exists, it SHALL transition `bootstrapState.status` to `installing` and call `bootstrapInstall({packages: ["@earendil-works/pi-coding-agent", "@fission-ai/openspec"]})` in the background (i.e. NOT awaited before `server.start()`).
4. Endpoints that require pi (session-spawn, openspec, resources) SHALL return HTTP 503 with a body referencing the current bootstrap state until the install completes.
5. On install success, `bootstrapState.status` SHALL transition to `ready`. On failure, it SHALL transition to `failed` with the error surfaced via `/api/bootstrap/status` and the existing bootstrap banner.

Pi installation pre-seeding via `installable.json` is **not** required for this path. The `runDegradedModeBootstrap` flow operates without an installable list and is the canonical mechanism for first-run pi-install on the standalone CLI.

The `maybeSeedDefaultInstallableList()` helper SHALL remain exported from `cli.ts` for explicit callers that want to write the installable list out-of-band (provisioning scripts, future Electron-equivalent wizards). It SHALL NOT be invoked by the default `runForeground` path because doing so causes `bootstrapInstallFromList` to block server startup on `npm install`, preventing the degraded-mode UI from coming up.

#### Scenario: Clean npm install, no pi anywhere

- **WHEN** a user runs `npm install -g @blackbelt-technology/pi-agent-dashboard` on a machine with no prior pi or openspec installation
- **AND** then runs `pi-dashboard` (or `pi-dashboard start`)
- **THEN** the server SHALL bind its configured port within the normal startup window
- **AND** `/api/bootstrap/status` SHALL return `status: "installing"` once the degraded-mode install begins
- **AND** a background `npm install` SHALL place `@earendil-works/pi-coding-agent` and `@fission-ai/openspec` under `~/.pi-dashboard/node_modules/`
- **AND** `/api/bootstrap/status` SHALL transition to `status: "ready"` on success
- **AND** `GET /` SHALL return HTTP 200 with the web UI bundle before the install completes

#### Scenario: npm install on a machine where pi is already managed

- **WHEN** the CLI starts and `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent` is present (and resolvable via ToolRegistry)
- **THEN** `runDegradedModeBootstrap` SHALL detect the resolved pi
- **AND** SHALL log `[bootstrap] ready (pi resolved via managed)`
- **AND** SHALL NOT start a background install
- **AND** `/api/bootstrap/status` SHALL report `status: "ready"` from the first response

#### Scenario: Electron-started server with managed pi

- **WHEN** the dashboard server is started by Electron (`starter === "Electron"`)
- **AND** the wizard has populated `~/.pi/dashboard/installable.json` with the required packages
- **THEN** `bootstrapInstallFromList` SHALL reconcile the list (existing behavior unchanged)
- **AND** the npm-install path described above SHALL NOT execute (different starter)

#### Scenario: Offline first run

- **WHEN** the CLI's `runDegradedModeBootstrap` begins a background install on a machine without network access
- **THEN** the background `bootstrapInstall` SHALL fail
- **AND** `/api/bootstrap/status` SHALL transition to `status: "failed"` with an error message
- **AND** the web UI SHALL remain available in degraded mode (sessions return 503, settings and docs work)

#### Scenario: Explicit programmatic seed of installable.json

- **WHEN** an external caller (provisioning script, custom wizard) invokes `maybeSeedDefaultInstallableList()` exported from `cli.ts`
- **AND** neither `installable.json` nor managed pi exists
- **THEN** the helper SHALL write the default list to `~/.pi/dashboard/installable.json`
- **AND** SHALL be idempotent against re-invocation while the file exists (never overwrites)
- **AND** the helper SHALL NOT be invoked by the default `runForeground` path of `pi-dashboard`
