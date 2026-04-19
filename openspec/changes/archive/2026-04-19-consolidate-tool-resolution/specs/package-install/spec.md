## MODIFIED Requirements

### Requirement: Server installs pi packages via PackageManager
The server SHALL expose `POST /api/packages/install` accepting `{ source, scope, cwd? }`. It SHALL use pi's `DefaultPackageManager` — obtained through `ToolRegistry.resolveModule("pi-coding-agent")` rather than an ad-hoc `loadPiPackageManager()` chain — to install the package. For `scope: "global"` it installs to `~/.pi/agent/settings.json`. For `scope: "local"` it installs to `<cwd>/.pi/settings.json`. The endpoint SHALL return immediately with an `operationId` and stream progress via WebSocket.

#### Scenario: Install npm package globally
- **WHEN** client sends `POST /api/packages/install` with `{ source: "npm:pi-doom", scope: "global" }`
- **THEN** server calls `packageManager.installAndPersist("npm:pi-doom")` and returns `{ operationId }` with status 202

#### Scenario: Install npm package locally
- **WHEN** client sends `POST /api/packages/install` with `{ source: "npm:pi-tools", scope: "local", cwd: "/path/to/project" }`
- **THEN** server calls `packageManager.installAndPersist("npm:pi-tools", { local: true })` scoped to the given cwd

#### Scenario: Install git package
- **WHEN** client sends `POST /api/packages/install` with `{ source: "git:github.com/user/repo", scope: "global" }`
- **THEN** server installs via git clone and persists to settings

#### Scenario: Concurrent install rejected
- **WHEN** an install/remove/update operation is already running
- **THEN** server returns 409 Conflict

#### Scenario: pi-coding-agent resolution failure surfaces diagnostics
- **WHEN** `registry.resolveModule("pi-coding-agent")` fails because every registered strategy failed
- **THEN** the server SHALL respond with 500 and a body that includes the `tried[]` trail from the failed Resolution (strategy names + reasons)
- **AND** SHALL NOT emit the legacy generic `"pi-coding-agent is not installed. Package management requires pi to be installed..."` message without an accompanying strategy trail

#### Scenario: Package wrapper no longer contains its own loader chain
- **WHEN** the implementation of `packages/server/src/package-manager-wrapper.ts` is inspected
- **THEN** it SHALL NOT contain a local `loadPiPackageManager()` function with bare-import / managed / npm-global try/catch branches
- **AND** it SHALL obtain `DefaultPackageManager` + `SettingsManager` exclusively through `registry.resolveModule("pi-coding-agent")`
- **AND** the same consolidation SHALL apply to any equivalent loader in `packages/electron/src/lib/dependency-installer.ts` — both call the same registry API
