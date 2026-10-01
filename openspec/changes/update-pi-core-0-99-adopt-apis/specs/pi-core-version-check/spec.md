## ADDED Requirements

### Requirement: piCompatibility block and earendil pi ranges track pi-coding-agent in lockstep

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent`.

**`minimum` SHALL track `recommended` in lockstep.** A single supported pi removes the class of defect in which version-gated fallback branches cannot be exercised in CI. The cost is an explicit one-release hard break for users on a below-floor pi, which SHALL be accepted deliberately, announced in `CHANGELOG.md`, and paired with an in-product upgrade hint naming the required version.

The `recommended` version SHALL be `0.99.1`; the server dependency `@earendil-works/pi-coding-agent` SHALL be pinned to `^0.99.1`; `minimum` SHALL be `0.99.1` and `maximum` SHALL stay `null`.

A future pin bump SHALL raise `minimum` to the new pinned version together with `recommended`, in the same change. A change that lifts `recommended` while leaving `minimum` behind SHALL be treated as a spec violation, not as a soft-landing option.

**Every `@earendil-works` pi range in the repo is IN the governed pin set.** This supersedes the prior policy that kept publishable peer ranges broad (`>=0.80.10`) and independent of the floor. Every publishable manifest (each `packages/*/package.json` and the root `package.json`) that declares an `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` or `@earendil-works/pi-tui` peer SHALL declare `>=<minimum>` for it, SHALL keep it optional (`peerDependenciesMeta.optional: true`), and SHALL move in the same change as `minimum`. An upper bound on a pi peer range SHALL NOT be declared. Every `@earendil-works` pi `devDependencies` range SHALL be `^<minimum>`. The `@mariozechner` fork's ranges are governed by their own requirements and are not changed here. The broad range was the only reason the dashboard kept version gates, dual-generation adapters and hand-copied pi rules; one supported pi for every consumer retires them.

The source directory `packages/electron/resources/bundled-extensions/` is not packaged, so its manifests are NOT a shipped pin surface and SHALL NOT be treated as floor anchors.

Separately, the extension's devDependency `typebox` in `packages/extension/package.json` is a test-fidelity pin matching pi's bundled runtime TypeBox, not a pi version pin. It SHALL match the TypeBox version declared by the *installed* pi 0.99.1 `package.json`, verified after the bump lands.

#### Scenario: Floor and recommended move together on a pin bump

- **WHEN** the pinned `@earendil-works/pi-coding-agent` runtime is `0.99.1`
- **THEN** `piCompatibility.recommended` SHALL be `"0.99.1"`
- **AND** `piCompatibility.minimum` SHALL be `"0.99.1"`
- **AND** `piCompatibility.maximum` SHALL be `null`

#### Scenario: Publishable peer ranges follow the floor

- **WHEN** the root `package.json` or any `packages/*/package.json` declares a pi peer
- **THEN** that range SHALL be `>=0.99.1` and optional
- **AND** no pi peer SHALL carry an upper bound

#### Scenario: Broad pi devDependency is rejected

- **WHEN** a manifest declares a pi `devDependencies` range such as `>=0.80.10`
- **THEN** the dependency-declaration check SHALL fail naming that manifest

#### Scenario: Below-floor pi raises the blocking advisory, not a soft hint

- **WHEN** the running pi-coding-agent reports a version below `0.99.1`
- **THEN** `computeCompatibility` SHALL populate `bootstrapState.compatibility.error` with a message naming both the running version and the required `0.99.1`
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
- **THEN** the banner SHALL name the exact required version (`0.99.1`)
- **AND** SHALL state that the pi install must be upgraded before the dashboard will operate

#### Scenario: Maximum is unbounded

- **WHEN** `piCompatibility.maximum` is `null`
- **THEN** no upper-bound block is produced regardless of the running pi version

#### Scenario: Recommended tracks earendil when both forks publish in lockstep
- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` publish the recommended version
- **THEN** `piCompatibility.recommended` MAY be set to that version and the dashboard SHALL accept either fork at that version

### Requirement: A session running below the floor is flagged
The bridge SHALL report the version of the pi process it runs inside, read by walking up from that process's entry point to the nearest pi-coding-agent manifest, never by resolving the package by name (a hoisted newer copy would mask an older running pi). The server SHALL compare each session's reported version with `piCompatibility.minimum`. A session whose version parses as below the minimum SHALL carry a below-floor flag in its session record, and the session card and chat view SHALL show a warning naming the running version and the required version. This single check replaces per-feature pi version gates in the bridge. An unreported or unparseable version SHALL NOT raise the flag.

#### Scenario: User-launched session on old pi
- **WHEN** a user-launched session reports `piVersion: "0.87.1"` and the minimum is `0.99.1`
- **THEN** its session card SHALL show a warning naming `0.87.1` and `0.99.1`

#### Scenario: Session at the floor
- **WHEN** a session reports `piVersion: "0.99.1"`
- **THEN** no below-floor warning SHALL be shown

#### Scenario: Unknown version
- **WHEN** a session has not reported a pi version
- **THEN** no below-floor warning SHALL be shown

#### Scenario: Hoisted newer copy does not mask an old running pi
- **WHEN** the session's running pi is `0.87.1` and a `0.99.1` copy is resolvable by name from the bridge's location
- **THEN** the session SHALL report `0.87.1` and show the below-floor warning

## MODIFIED Requirements

### Requirement: The release-deps checker SHALL enforce pi pin coherence

`scripts/verify-release-deps.mjs` SHALL enforce that the pi version is coherent across every pi-version pin it governs, not merely that the server dependency meets a floor. The checker SHALL assert that all of the following resolve to the same normalized version, and SHALL fail the release gate naming any that drifts:
- `packages/server/package.json` `dependencies.@earendil-works/pi-coding-agent`;
- `piCompatibility.recommended` and `piCompatibility.minimum`;
- the `docker/Dockerfile` global-install pin;
- the `pnpm-workspace.yaml` `overrides` for `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` and `@earendil-works/pi-tui`;
- the lower bound of every `@earendil-works` pi peer range in the root and `packages/*` manifests;
- every `@earendil-works` pi `devDependencies` range.

The checker's own `minVersion` constant SHALL equal that same version. The overrides keep a single, deterministic pi copy under `nodeLinker: hoisted`, so `/api/health`'s version probe cannot report a second hoisted copy (the ghost-version defect recorded by `update-pi-core-0-84-adopt-apis`). Comparison SHALL normalize each pin's syntax (stripping `^`/`~`/`>=`/`@` and pre-release suffixes) rather than comparing literal strings. The extension devDep `typebox` is a separate test-fidelity pin and is out of scope for this rule.

#### Scenario: Coherent pins pass

- **GIVEN** every governed pin references `0.99.1`
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the pi coherence check SHALL pass

#### Scenario: Drifted pin fails the gate

- **GIVEN** one of the governed pi pins (including a publishable peer lower bound or a pi-tui override) references a different version than the others
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the checker SHALL fail and name the drifted location

#### Scenario: A lagging minimum fails the gate

- **GIVEN** `piCompatibility.recommended` is `0.99.1` and `piCompatibility.minimum` is still `0.86.1`
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the checker SHALL fail and name `piCompatibility.minimum` as the drifted location

## REMOVED Requirements

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

**Reason**: The prior requirement kept publishable `@earendil-works` peer ranges broad and independent of the floor; that policy is withdrawn.

**Migration**: Replaced by "piCompatibility block and earendil pi ranges track pi-coding-agent in lockstep" with floor 0.99.1; `@earendil-works` peers become `>=0.99.1`. `@mariozechner` handling is unchanged here (see change `drop-mariozechner-pi-fork`).
