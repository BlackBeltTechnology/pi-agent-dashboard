## ADDED Requirements

### Requirement: Core package discovery without the legacy fork
The server SHALL discover all installed pi ecosystem core packages from both global npm and the managed install directory (`~/.pi-dashboard/node_modules/`) using a strict whitelist of package names. The `pi-*` name-prefix heuristic SHALL NOT be used.

The whitelist consists of:

- `@earendil-works/pi-coding-agent`
- `@blackbelt-technology/pi-agent-dashboard`

The whitelist is static: no runtime-discovered alias SHALL extend it. The whitelist SHALL NOT include `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`, and SHALL NOT include `@blackbelt-technology/pi-model-proxy` (superseded by the dashboard's built-in model proxy).

#### Scenario: Global npm packages discovered
- **WHEN** the server runs `npm list -g --depth=0 --json`
- **THEN** it SHALL parse the output and identify pi ecosystem packages by matching ONLY the whitelist above
- **AND** each discovered package SHALL include its installed version from the JSON output

#### Scenario: Non-whitelisted pi-prefixed package ignored
- **WHEN** `npm list -g` includes a package whose name starts with `pi-` (e.g., `pi-agent-browser`, `pi-web-access`) but is NOT in the whitelist
- **THEN** the package SHALL NOT appear in the core discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/versions`

#### Scenario: Installed upstream pi-model-proxy ignored
- **WHEN** `@blackbelt-technology/pi-model-proxy` is present in either global or managed install
- **THEN** it SHALL NOT appear in the discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/versions` or the Update All set

#### Scenario: Legacy oh-my-pi install ignored
- **WHEN** `@oh-my-pi/pi-coding-agent` is present in either global or managed install
- **THEN** it SHALL NOT appear in the discovery result
- **AND** the user SHALL receive no upgrade hint for it (the dashboard does not support that fork)

#### Scenario: Legacy mariozechner fork ignored
- **WHEN** `@mariozechner/pi-coding-agent` is present in global npm or the managed install, with or without `@earendil-works/pi-coding-agent`
- **THEN** it SHALL NOT appear in the discovery result
- **AND** SHALL NOT appear in `GET /api/pi-core/versions` or the Update All set
- **AND** `@earendil-works/pi-coding-agent`, when present, SHALL be discovered normally

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

### Requirement: Core package update execution for discovered packages only
The server SHALL expose `POST /api/pi-core/update` to update one or more core packages. The endpoint SHALL accept only names present in the core discovery result; any other name, including `@mariozechner/pi-coding-agent`, SHALL be rejected.

#### Scenario: Update earendil global package
- **WHEN** a client calls `POST /api/pi-core/update` with `{ packages: ["@earendil-works/pi-coding-agent"] }` and the package has `installSource: "global"`
- **THEN** the server SHALL run `npm update -g @earendil-works/pi-coding-agent`
- **AND** broadcast progress events via WebSocket

#### Scenario: Legacy mariozechner fork rejected
- **WHEN** a client calls `POST /api/pi-core/update` with `{ packages: ["@mariozechner/pi-coding-agent"] }`
- **THEN** the server SHALL respond `400` with `error` naming `@mariozechner/pi-coding-agent` as an unknown package
- **AND** SHALL NOT run any npm command

#### Scenario: Update managed package
- **WHEN** a package has `installSource: "managed"`
- **THEN** the server SHALL run `npm update <pkg>` in the `~/.pi-dashboard/` directory using the discovered package name

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

### Requirement: Core package display names
Known core packages SHALL have human-readable display names.

#### Scenario: Earendil pi-coding-agent gets primary display name
- **WHEN** `@earendil-works/pi-coding-agent` is discovered
- **THEN** its `displayName` SHALL be `"pi (core agent)"`

#### Scenario: No legacy fork display name
- **WHEN** the display-name mapping is consulted
- **THEN** it SHALL NOT contain an entry for `@mariozechner/pi-coding-agent`

#### Scenario: Unknown package uses npm name
- **WHEN** a discovered package has no display name mapping
- **THEN** its npm package name SHALL be used as `displayName`

### Requirement: piCompatibility block and earendil pi ranges track pi-coding-agent in lockstep without the legacy fork

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent`.

**`minimum` SHALL track `recommended` in lockstep.** A single supported pi removes the class of defect in which version-gated fallback branches cannot be exercised in CI. The cost is an explicit one-release hard break for users on a below-floor pi, which SHALL be accepted deliberately, announced in `CHANGELOG.md`, and paired with an in-product upgrade hint naming the required version.

The `recommended` version SHALL be `1.0.0`; the server dependency `@earendil-works/pi-coding-agent` SHALL be pinned to `^1.0.0`; `minimum` SHALL be `1.0.0` and `maximum` SHALL stay `null`.

A future pin bump SHALL raise `minimum` to the new pinned version together with `recommended`, in the same change. A change that lifts `recommended` while leaving `minimum` behind SHALL be treated as a spec violation, not as a soft-landing option.

**Every `@earendil-works` pi range in the repo is IN the governed pin set.** This supersedes the prior policy that kept publishable peer ranges broad (`>=0.80.10`) and independent of the floor. Every publishable manifest (each `packages/*/package.json` and the root `package.json`) that declares an `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` or `@earendil-works/pi-tui` peer SHALL declare `>=<minimum>` for it, SHALL keep it optional (`peerDependenciesMeta.optional: true`), and SHALL move in the same change as `minimum`. An upper bound on a pi peer range SHALL NOT be declared. Every `@earendil-works` pi `devDependencies` range SHALL be `^<minimum>`. No manifest SHALL declare an `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai` or `@mariozechner/pi-tui` peer, peer-meta entry or devDependency; the fork is not a supported pi, and the release-deps checker (`scripts/verify-release-deps.mjs`) SHALL fail on any such declaration. The broad range was the only reason the dashboard kept version gates, dual-generation adapters and hand-copied pi rules; one supported pi for every consumer retires them.

The source directory `packages/electron/resources/bundled-extensions/` is not packaged, so its manifests are NOT a shipped pin surface and SHALL NOT be treated as floor anchors.

Separately, the extension's devDependency `typebox` in `packages/extension/package.json` is a test-fidelity pin matching pi's bundled runtime TypeBox, not a pi version pin. It SHALL match the TypeBox version declared by the *installed* pi 1.0.0 `package.json`, verified after the bump lands.

#### Scenario: Floor and recommended move together on a pin bump

- **WHEN** the pinned `@earendil-works/pi-coding-agent` runtime is `1.0.0`
- **THEN** `piCompatibility.recommended` SHALL be `"1.0.0"`
- **AND** `piCompatibility.minimum` SHALL be `"1.0.0"`
- **AND** `piCompatibility.maximum` SHALL be `null`

#### Scenario: Publishable peer ranges follow the floor

- **WHEN** the root `package.json` or any `packages/*/package.json` declares a pi peer
- **THEN** that range SHALL be `>=1.0.0` and optional
- **AND** no pi peer SHALL carry an upper bound

#### Scenario: Broad pi devDependency is rejected

- **WHEN** a manifest declares a pi `devDependencies` range such as `>=0.80.10`
- **THEN** the dependency-declaration check SHALL fail naming that manifest

#### Scenario: Below-floor pi raises the blocking advisory, not a soft hint

- **WHEN** the running pi-coding-agent reports a version below `1.0.0`
- **THEN** `computeCompatibility` SHALL populate `bootstrapState.compatibility.error` with a message naming both the running version and the required `1.0.0`
- **AND** the bootstrap banner SHALL render in the red "below minimum" state
- **AND** the block SHALL be an advisory surfaced through `/api/health` + `PiVersionAdvisory`; no HTTP status change

#### Scenario: Lifting recommended without the floor is rejected

- **WHEN** a change sets `piCompatibility.recommended` to a version newer than `piCompatibility.minimum`
- **THEN** that divergence SHALL be treated as a spec violation requiring the floor to be raised in the same change

#### Scenario: Upgrade-hint band is empty under lockstep

- **WHEN** `piCompatibility.minimum` equals `piCompatibility.recommended`
- **THEN** no running version can be below `recommended` and at or above `minimum`, so the soft-hint band is empty in the shipped configuration
- **AND** `computeCompatibility` SHALL nevertheless retain the hint branch, because the function is range-parameterized and is exercised with synthetic ranges

#### Scenario: Minimum version drives the blocking error

- **WHEN** the running pi-coding-agent version is below `piCompatibility.minimum`
- **THEN** `bootstrapState.compatibility` includes a populated `error` message
- **AND** the bootstrap banner renders in the red "below minimum" state

#### Scenario: Upgrade hint names the required version

- **WHEN** the bootstrap status renders the red "below minimum" banner
- **THEN** the banner SHALL name the exact required version (`1.0.0`)
- **AND** SHALL state that the pi install must be upgraded before the dashboard will operate

#### Scenario: Maximum is unbounded

- **WHEN** `piCompatibility.maximum` is `null`
- **THEN** no upper-bound block is produced regardless of the running pi version

#### Scenario: Recommended tracks earendil only
- **WHEN** `piCompatibility.recommended` is chosen
- **THEN** it SHALL be a published `@earendil-works/pi-coding-agent` version
- **AND** the release-deps checker SHALL fail if any manifest declares an `@mariozechner/pi-*` pi range

## MODIFIED Requirements

### Requirement: A session running below the floor is flagged
The bridge SHALL report the version of the pi process it runs inside, read by walking up from that process's entry point to the nearest manifest whose name is `pi-coding-agent` under any npm scope, never by resolving the package by name (a hoisted newer copy would mask an older running pi). The server SHALL compare each session's reported version with `piCompatibility.minimum`. A session whose version parses as below the minimum SHALL carry a below-floor flag in its session record, and the session card and chat view SHALL show a warning naming the running version and the required version. This single check replaces per-feature pi version gates in the bridge. An unreported or unparseable version SHALL NOT raise the flag.

#### Scenario: User-launched session on old pi
- **WHEN** a user-launched session reports `piVersion: "0.87.1"` and the minimum is `1.0.0`
- **THEN** its session card SHALL show a warning naming `0.87.1` and `1.0.0`

#### Scenario: Session at the floor
- **WHEN** a session reports `piVersion: "1.0.0"`
- **THEN** no below-floor warning SHALL be shown

#### Scenario: Unknown version
- **WHEN** a session has not reported a pi version
- **THEN** no below-floor warning SHALL be shown

#### Scenario: Hoisted newer copy does not mask an old running pi
- **WHEN** the session's running pi is `0.87.1` and a `1.0.0` copy is resolvable by name from the bridge's location
- **THEN** the session SHALL report `0.87.1` and show the below-floor warning

#### Scenario: Running legacy fork is flagged
- **WHEN** a session runs a `pi` binary from `@mariozechner/pi-coding-agent` (e.g. found on PATH) whose manifest version is `0.73.1` and the minimum is `1.0.0`
- **THEN** the session SHALL report `piVersion: "0.73.1"` and show the below-floor warning
- **AND** the version read SHALL NOT depend on a list of accepted package scopes

## REMOVED Requirements

### Requirement: Core package discovery
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Core package discovery without the legacy fork". Fork-only machines install `@earendil-works/pi-coding-agent`.

### Requirement: Core package update execution
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Core package update execution for discovered packages only". Fork-only machines install `@earendil-works/pi-coding-agent`.

### Requirement: Display name mapping
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Core package display names". Fork-only machines install `@earendil-works/pi-coding-agent`.

### Requirement: pi.dev version check
**Reason**: The pi.dev path keyed on `@mariozechner/pi-coding-agent`; `@earendil-works/pi-coding-agent` reached it only through a runtime alias learned from a fork lookup in the same process. With the fork gone it is dead code, and pi.dev's `latest` may be ahead of what `npm install <pkg>@latest` can install. Dynamic alias intake from pi.dev's `packageName` is removed with it.
**Migration**: None for users. Every core package's `latestVersion` comes from the npm registry (`fetchPackageMeta`), as it already did for `@earendil-works/pi-coding-agent`. `PI_OFFLINE` / `PI_SKIP_VERSION_CHECK` no longer affect the core version check through a pi.dev request.

### Requirement: piCompatibility block and earendil pi ranges track pi-coding-agent in lockstep
**Reason**: Its scenario "Recommended tracks earendil when both forks publish in lockstep" accepts the `@mariozechner` fork; a MODIFIED block cannot drop it.
**Migration**: Replaced by "piCompatibility block and earendil pi ranges track pi-coding-agent in lockstep without the legacy fork" (same lockstep policy, fork scenario replaced by an earendil-only one).
