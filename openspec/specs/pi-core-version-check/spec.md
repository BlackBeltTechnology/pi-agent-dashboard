# pi-core-version-check Specification

## Purpose
Server-side discovery and reporting of installed pi ecosystem core package versions so the dashboard can surface version skew and upgrade hints.
## Requirements
### Requirement: Core package discovery
The server SHALL discover all installed pi ecosystem core packages from both global npm and the managed install directory (`~/.pi-dashboard/node_modules/`) using a strict whitelist of package names. The `pi-*` name-prefix heuristic SHALL NOT be used.

The whitelist consists of:

- `@earendil-works/pi-coding-agent` (primary fork)
- `@mariozechner/pi-coding-agent` (legacy fork retained for backward compatibility)
- `@blackbelt-technology/pi-agent-dashboard`
- `@blackbelt-technology/pi-model-proxy`

The whitelist SHALL NOT include `@oh-my-pi/pi-coding-agent`.

#### Scenario: Global npm packages discovered
- **WHEN** the server runs `npm list -g --depth=0 --json`
- **THEN** it SHALL parse the output and identify pi ecosystem packages by matching ONLY the whitelist above
- **AND** each discovered package SHALL include its installed version from the JSON output

#### Scenario: Non-whitelisted pi-prefixed package ignored
- **WHEN** `npm list -g` includes a package whose name starts with `pi-` (e.g., `pi-agent-browser`, `pi-web-access`) but is NOT in the whitelist
- **THEN** the package SHALL NOT appear in the core discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/status`

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

### Requirement: Version comparison against registry
The server SHALL compare each discovered package's installed version against the latest version available on npm or GitHub.

#### Scenario: npm package version check
- **WHEN** a discovered package is an npm package
- **THEN** the server SHALL fetch its latest version via `fetchPackageMeta()` from the npm registry
- **AND** set `updateAvailable` to `true` when installed version differs from latest

#### Scenario: Registry unreachable
- **WHEN** the npm registry is unreachable for a package
- **THEN** `latestVersion` SHALL be `null` and `updateAvailable` SHALL be `false`

### Requirement: Version status caching
The server SHALL cache version status results for 5 minutes to avoid excessive registry queries.

#### Scenario: Cached result returned
- **WHEN** a version check was performed less than 5 minutes ago
- **THEN** the cached result SHALL be returned without querying the registry

#### Scenario: Force refresh
- **WHEN** `GET /api/pi-core/versions?refresh=true` is called
- **THEN** the cache SHALL be invalidated and a fresh check SHALL be performed

### Requirement: Version status REST endpoint
The server SHALL expose `GET /api/pi-core/versions` returning `PiCoreStatus` with all discovered packages, their versions, and update availability.

#### Scenario: Successful version check
- **WHEN** a client calls `GET /api/pi-core/versions`
- **THEN** the response SHALL contain `{ success: true, data: PiCoreStatus }` with `packages` array, `updatesAvailable` count, and `lastChecked` ISO timestamp

#### Scenario: No packages found
- **WHEN** no pi ecosystem packages are discovered
- **THEN** the response SHALL return an empty `packages` array with `updatesAvailable: 0`

### Requirement: Core package update execution
The server SHALL expose `POST /api/pi-core/update` to update one or more core packages. The endpoint SHALL accept either supported pi fork name in the `packages` array.

#### Scenario: Update earendil global package
- **WHEN** a client calls `POST /api/pi-core/update` with `{ packages: ["@earendil-works/pi-coding-agent"] }` and the package has `installSource: "global"`
- **THEN** the server SHALL run `npm update -g @earendil-works/pi-coding-agent`
- **AND** broadcast progress events via WebSocket

#### Scenario: Update legacy mariozechner global package
- **WHEN** a client calls `POST /api/pi-core/update` with `{ packages: ["@mariozechner/pi-coding-agent"] }` and the package has `installSource: "global"`
- **THEN** the server SHALL run `npm update -g @mariozechner/pi-coding-agent`
- **AND** the legacy fork SHALL be updated in place without being silently swapped to earendil

#### Scenario: Update managed package
- **WHEN** a package has `installSource: "managed"`
- **THEN** the server SHALL run `npm update <pkg>` in the `~/.pi-dashboard/` directory using the discovered package name (earendil or mariozechner)

#### Scenario: Update crosses minor-version boundary
- **WHEN** the installed version is in a different minor than the npm `latest` dist-tag (e.g. installed `0.70.6`, latest `0.73.1`)
- **AND** the consuming `package.json` declares the dependency with a caret range (e.g. `^0.70.0`)
- **THEN** the server SHALL still successfully install the `latest` version
- **AND** the post-update `installedVersion` reported by `PiCoreChecker` SHALL match the npm `latest`

#### Scenario: Update all packages
- **WHEN** `POST /api/pi-core/update` is called with `{ packages: [] }` or no `packages` field
- **THEN** all packages with `updateAvailable: true` SHALL be updated sequentially
- **AND** each SHALL use the `npm install <pkg>@latest` argv shape

#### Scenario: Concurrent operation blocked
- **WHEN** a package operation (extension install/update or core update) is already running
- **THEN** the server SHALL return 409 Conflict

#### Scenario: Permission error on global update
- **WHEN** `npm install -g <pkg>@latest` fails with a permission error (EACCES / EPERM / EROFS)
- **THEN** the error message SHALL be surfaced to the client
- **AND** SHALL include a remediation hint that references `sudo npm install -g <pkg>@latest` (NOT `sudo npm update -g`)

### Requirement: Session auto-reload after update
The server SHALL auto-reload all connected pi sessions after a successful core package update.

#### Scenario: Successful update triggers reload
- **WHEN** a core package update completes successfully
- **THEN** all connected pi sessions SHALL be reloaded
- **AND** the completion message SHALL include `sessionsReloaded` count

### Requirement: Display name mapping
Known core packages SHALL have human-readable display names that distinguish the primary fork from the legacy one.

#### Scenario: Earendil pi-coding-agent gets primary display name
- **WHEN** `@earendil-works/pi-coding-agent` is discovered
- **THEN** its `displayName` SHALL be `"pi (core agent)"`

#### Scenario: Mariozechner pi-coding-agent gets legacy display name
- **WHEN** `@mariozechner/pi-coding-agent` is discovered
- **THEN** its `displayName` SHALL be `"pi (core agent — legacy fork)"`
- **AND** the dashboard UI SHALL surface this label so users can see which fork is active

#### Scenario: Unknown package uses npm name
- **WHEN** a discovered package has no display name mapping
- **THEN** its npm package name SHALL be used as `displayName`

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent` and a `minimum` version that matches the version actually exercised in the dashboard's tests and the bundled-extensions peer-dep constraints in `packages/electron/resources/bundled-extensions/*/package.json`.

The legacy offline-cache (`packages/electron/offline-packages.json`) was removed under change `eliminate-electron-runtime-install`; bundled-extension peer-deps are now the sole pin surface that must move in lockstep with `piCompatibility.minimum`.

#### Scenario: Recommended tracks earendil 0.78 line

- **WHEN** the latest published `@earendil-works/pi-coding-agent` is `0.78.0`
- **AND** every bundled-extension `package.json` declares peer-dep `@earendil-works/pi-coding-agent` at `>=0.78.0` (or `^0.78.0`)
- **THEN** `piCompatibility.minimum` SHALL be `"0.78.0"`
- **AND** `piCompatibility.recommended` SHALL be `"0.78.0"`

#### Scenario: Recommended moves ahead of floor when a 0.78 patch ships

- **WHEN** `@earendil-works/pi-coding-agent@0.78.1` is published
- **AND** the dashboard wants to surface the soft upgrade hint without raising the hard floor
- **THEN** `piCompatibility.recommended` MAY be lifted to `"0.78.1"` while `piCompatibility.minimum` stays at `"0.78.0"`
- **AND** users on `0.78.0` SHALL see `upgradeRecommended: true` but no `compatibility.error`

#### Scenario: Recommended tracks earendil when both forks publish in lockstep

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` publish `0.78.0`
- **THEN** `piCompatibility.recommended` MAY be set to `"0.78.0"` and the dashboard SHALL accept either fork at that version

#### Scenario: Recommended version drives the upgrade hint

- **WHEN** the running pi-coding-agent version is below `piCompatibility.recommended`
- **THEN** `bootstrapState.compatibility.upgradeRecommended` is `true`
- **AND** the bootstrap status response is still `status: "ready"` (non-blocking)

#### Scenario: Minimum version drives the blocking error

- **WHEN** the running pi-coding-agent version is below `piCompatibility.minimum`
- **THEN** `bootstrapState.compatibility` includes a 503-blocking `error` message
- **AND** the bootstrap banner renders in the red "below minimum" state

#### Scenario: Pi 0.75 / 0.76 / 0.77 user sees blocking error after bump

- **WHEN** `piCompatibility.minimum` is `"0.78.0"`
- **AND** the running pi-coding-agent reports a version in the `0.75.x` / `0.76.x` / `0.77.x` range
- **THEN** the bootstrap status SHALL render the red "below minimum" banner with a clear upgrade hint pointing at `0.78.0`

#### Scenario: Maximum is unbounded

- **WHEN** `piCompatibility.maximum` is `null`
- **THEN** no upper-bound block is produced regardless of the running pi version

### Requirement: Node engines floor tracks pi minimum supported Node

The dashboard's declared Node engines floor SHALL be ≥ the Node minimum that `piCompatibility.minimum` requires. Pi 0.75.0 raised its Node floor from `22.18.0` to `22.19.0`; the dashboard SHALL mirror this transitively so users do not encounter pi-side Node errors after the dashboard reports "ready".

The floor applies to two manifests:

- Root `package.json::engines.node` (informational; surfaced by `npm install` warnings).
- `packages/server/package.json::engines.node` (enforced for users installing the server package directly via npm).

The runtime-side `packages/server/src/node-guard.ts::isAffectedNode` SHALL refuse to start on any Node version below the declared floor, with a clear stderr message naming the required version.

#### Scenario: Root engines.node matches pi floor
- **WHEN** `piCompatibility.minimum` is `"0.75.0"`
- **THEN** root `package.json::engines.node` SHALL be `">=22.19.0 <25"` (lower bound matches pi 0.75.0's minimum Node; upper bound preserved at current ceiling)

#### Scenario: Server engines.node matches pi floor
- **WHEN** `piCompatibility.minimum` is `"0.75.0"`
- **THEN** `packages/server/package.json::engines.node` SHALL be `">=22.19.0"` (no upper bound; the server consumes its host's Node)

#### Scenario: node-guard refuses below floor
- **WHEN** the server starts on Node `v22.18.0`
- **AND** `piCompatibility.minimum` is `"0.75.0"`
- **THEN** `assertNodeVersionSupported()` SHALL print the upgrade message and exit with code 1
- **AND** the upgrade message SHALL name `>=22.19.0` as the required version

#### Scenario: node-guard accepts at floor
- **WHEN** the server starts on Node `v22.19.0` exactly
- **THEN** `assertNodeVersionSupported()` SHALL return without exiting
- **AND** the server proceeds to its normal startup path

### Requirement: Bundled Node version meets pi minimum Node

The Electron-bundled Node version (`packages/electron/scripts/_node-version.sh::BUNDLED_NODE_VERSION`) SHALL meet or exceed the Node minimum that `piCompatibility.minimum` requires. This invariant SHALL be enforced by a repo-lint test so that a future bundled-Node downgrade cannot silently cross under the pi floor.

#### Scenario: Bundled Node satisfies floor
- **WHEN** `BUNDLED_NODE_VERSION` is `"v24.15.0"`
- **AND** `piCompatibility.minimum` is `"0.75.0"` (requires Node `22.19.0`)
- **THEN** the lint test SHALL pass because `24.15.0 > 22.19.0`

#### Scenario: Lint fires on bundled-Node regression
- **WHEN** a hypothetical change lowers `BUNDLED_NODE_VERSION` to `"v22.18.0"`
- **AND** `piCompatibility.minimum` still requires Node `22.19.0`
- **THEN** the lint test SHALL fail with a message naming both versions and pointing to `_node-version.sh` as the file to edit

### Requirement: pi-core-updater resolves npm via ToolRegistry and inherits managed Node on PATH

The pi-core-updater SHALL resolve the `npm` binary it spawns through `ToolRegistry.resolve("npm")` rather than invoking a bare `"npm"` command, AND SHALL apply `prependManagedNodeToPath(env)` to the spawned child's environment so that nested `node`/`npm` resolution inside the npm subprocess also picks up the managed runtime.

#### Scenario: Managed-source update uses registry-resolved npm

- **WHEN** `pi-core-updater.ts::defaultRunNpmUpdate` is invoked for a package with `installSource: "managed"`
- **THEN** the spawned binary SHALL be the absolute path returned by `ToolRegistry.resolve("npm")`
- **AND** the spawn SHALL NOT use a bare `"npm"` command name
- **AND** the spawned process's `env.PATH` SHALL contain the managed Node directory as its first entry when `<managedDir>/node/` exists

#### Scenario: Global-source update uses registry-resolved npm

- **WHEN** `pi-core-updater.ts::defaultRunNpmUpdate` is invoked for a package with `installSource: "global"`
- **THEN** the spawned binary SHALL be the absolute path returned by `ToolRegistry.resolve("npm")`
- **AND** the spawned process's `env.PATH` SHALL contain the managed Node directory as its first entry when `<managedDir>/node/` exists

#### Scenario: ToolRegistry resolution failure surfaces a clear error

- **WHEN** `pi-core-updater.ts::defaultRunNpmUpdate` is invoked
- **AND** `ToolRegistry.resolve("npm")` returns no path (no override, no managed runtime, no npm on PATH)
- **THEN** the updater SHALL reject with an error message naming `npm` as unresolved
- **AND** SHALL NOT attempt a bare `spawn("npm", ...)` fallback

#### Scenario: Permission-error hint preserved

- **WHEN** the registry-resolved `npm update -g <pkg>` fails with stderr matching `permission|EACCES|EPERM|EROFS`
- **AND** the package's `installSource` is `"global"`
- **THEN** the rejected error message SHALL include the existing remediation hint suggesting `sudo npm update -g <pkg>`

### Requirement: pi.dev version check
The server SHALL query `https://pi.dev/api/latest-version` for `@mariozechner/pi-coding-agent` (and any successor `packageName` returned by previous pi.dev responses) instead of querying the npm registry directly. The npm registry SHALL be used as a fallback when pi.dev is unreachable, returns an error, or is skipped via environment variables.

#### Scenario: pi.dev queried for pi-coding-agent
- **WHEN** `PiCoreChecker.getStatus()` runs and a managed/global install of `@mariozechner/pi-coding-agent` is discovered
- **THEN** the server SHALL issue `GET https://pi.dev/api/latest-version` with header `User-Agent: pi/<currentVersion> (<platform>; <runtime>; <arch>)` matching pi's own self-update User-Agent
- **AND** parse the JSON response into `{ version: string, packageName?: string }`
- **AND** populate `PiCorePackage.latestVersion` from `response.version`

#### Scenario: pi.dev unreachable falls back to npm registry
- **WHEN** the pi.dev request fails (network error, non-2xx status, malformed JSON)
- **THEN** the server SHALL fall back to `fetchPackageMeta` against the npm registry for the same package name
- **AND** the fallback path SHALL produce a `PiCorePackage` with the same shape as the pi.dev path

#### Scenario: PI_OFFLINE skips pi.dev
- **WHEN** the `PI_OFFLINE` environment variable is set (any non-empty value)
- **THEN** the server SHALL NOT issue the pi.dev request
- **AND** SHALL fall back to the npm registry path immediately

#### Scenario: PI_SKIP_VERSION_CHECK skips pi.dev
- **WHEN** the `PI_SKIP_VERSION_CHECK` environment variable is set (any non-empty value)
- **THEN** the server SHALL NOT issue the pi.dev request
- **AND** SHALL fall back to the npm registry path immediately

#### Scenario: pi.dev returns dynamic packageName
- **WHEN** the pi.dev response includes a non-empty `packageName` field
- **THEN** the server SHALL treat that name as a trusted alias for `@mariozechner/pi-coding-agent`
- **AND** subsequent calls to `discoverGlobal()` and `discoverManaged()` SHALL include packages installed under that name in the result list, even if the name is not in the static `CORE_PACKAGE_NAMES` whitelist

#### Scenario: pi.dev not queried for non-pi packages
- **WHEN** `PiCoreChecker` checks any package other than `@mariozechner/pi-coding-agent` and its declared successors
- **THEN** the server SHALL use the npm registry path directly
- **AND** SHALL NOT issue any request to pi.dev

#### Scenario: 10-second timeout
- **WHEN** the pi.dev request takes longer than 10 seconds
- **THEN** the request SHALL be aborted via `AbortSignal.timeout(10000)`
- **AND** the server SHALL fall back to the npm registry path

#### Scenario: User-Agent reflects current pi version
- **WHEN** the pi.dev request is issued
- **THEN** the User-Agent header SHALL be `pi/<currentVersion> (<process.platform>; <runtime>; <process.arch>)` where `<runtime>` is `node/<process.version>` (or `bun/<bunVersion>` if running under Bun)
- **AND** the User-Agent SHALL NOT identify the dashboard separately

#### Scenario: No request when pi not yet installed
- **WHEN** no managed or global install of `@mariozechner/pi-coding-agent` is discovered
- **THEN** the server SHALL skip the pi.dev request entirely (since there is no `currentVersion` to send in the User-Agent)

#### Scenario: Cache TTL applies
- **WHEN** `PiCoreChecker.getStatus()` is called twice within 5 minutes
- **THEN** the second call SHALL return the cached result without re-issuing either pi.dev or npm registry requests

#### Scenario: Cache invalidation re-fetches via pi.dev
- **WHEN** `PiCoreChecker.invalidate()` is called (typically after a successful core update)
- **THEN** the next `getStatus()` SHALL re-issue the pi.dev request (cache cleared)



### Requirement: /api/health surfaces pi-version compatibility

The `/api/health` REST response SHALL include a `compatibility` field of shape `BootstrapCompatibility | null`. The field is computed lazily per request from `pi-version-skew.ts` primitives (`readPiCompatibility` for the declared range + `readCurrentPiVersion` for the running pi + `computeCompatibility` to combine them), and cached for 30 seconds to avoid repeated registry probes and file reads on rapid health polls.

When pi cannot be resolved (no global install, no managed install, no override), `compatibility` SHALL be `null` — NOT an error, since a freshly-installed dashboard may legitimately predate a pi install.

#### Scenario: Health response includes compatibility on a clean install with pi resolvable

- **WHEN** `GET /api/health` is called
- **AND** `readCurrentPiVersion()` returns `"0.75.5"`
- **AND** `piCompatibility.minimum` is `"0.75.0"` and `recommended` is `"0.75.5"`
- **THEN** the response SHALL include `compatibility: { minimum: "0.75.0", recommended: "0.75.5", maximum: null, current: "0.75.5" }`
- **AND** neither `upgradeRecommended` nor `error` SHALL be set

#### Scenario: Health response surfaces upgrade hint when pi is below recommended

- **WHEN** `readCurrentPiVersion()` returns `"0.75.0"`
- **AND** `piCompatibility.recommended` is `"0.75.5"`
- **THEN** `compatibility.upgradeRecommended` SHALL be `true`
- **AND** `compatibility.error` SHALL be absent

#### Scenario: Health response surfaces blocking error when pi is below minimum

- **WHEN** `readCurrentPiVersion()` returns `"0.74.2"`
- **AND** `piCompatibility.minimum` is `"0.75.0"`
- **THEN** `compatibility.error` SHALL be a non-empty string containing both versions
- **AND** the response status SHALL remain `200` (the field signals state; the handler does not refuse the request)

#### Scenario: Health response sets compatibility to null when pi is unresolvable

- **WHEN** `readCurrentPiVersion()` returns `undefined`
- **THEN** `compatibility` SHALL be `null`
- **AND** the response SHALL otherwise be unchanged

#### Scenario: Compatibility result is cached for 30 seconds

- **WHEN** two `/api/health` requests are made within 30 seconds of each other
- **THEN** `readCurrentPiVersion()` SHALL be called at most once during that window
- **AND** the second response SHALL include the cached `compatibility` value

### Requirement: PiVersionAdvisory renders in Settings → General

A small client-side component SHALL surface `compatibility` to users via the Settings panel (NOT a full-app banner). The component reads `/api/health` via a polling hook and renders one of three states:

- **Hidden**: `compatibility` is `null`, OR `error` is absent AND `upgradeRecommended` is falsy.
- **Soft warning**: `upgradeRecommended` is `true`. Yellow pill with one line: current version + recommended version + a link/disclosure for the upgrade command.
- **Hard advisory**: `error` is set. Red panel with the error message + a "How to upgrade" disclosure containing a copy-paste-able npm command.

#### Scenario: Advisory hidden when pi matches recommended

- **WHEN** `compatibility.current` equals `compatibility.recommended`
- **THEN** `PiVersionAdvisory` SHALL render nothing (no DOM)

#### Scenario: Advisory shows soft warning when below recommended

- **WHEN** `compatibility.upgradeRecommended` is `true`
- **AND** `compatibility.error` is absent
- **THEN** `PiVersionAdvisory` SHALL render a yellow pill including both `current` and `recommended` versions

#### Scenario: Advisory shows hard advisory when below minimum

- **WHEN** `compatibility.error` is a non-empty string
- **THEN** `PiVersionAdvisory` SHALL render a red panel with the error text AND an expandable "How to upgrade" disclosure containing an `npm install -g @earendil-works/pi-coding-agent@<recommended>` command

#### Scenario: Hook polls health every 60 seconds

- **WHEN** `usePiCompatibility` is mounted
- **THEN** it SHALL fetch `/api/health` immediately
- **AND** schedule a refetch every 60 seconds
- **AND** clean up the interval on unmount
