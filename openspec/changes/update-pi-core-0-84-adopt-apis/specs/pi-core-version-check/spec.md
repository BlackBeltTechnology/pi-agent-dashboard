## MODIFIED Requirements

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent`, and a `minimum` version that is an INDEPENDENT broad-support floor: the oldest pi the dashboard still supports, which SHALL be at or above the bundled-extensions peer-dep constraints in `packages/electron/resources/bundled-extensions/*/package.json` and SHALL NOT be raised merely because tests or the pinned runtime moved to a newer version. `minimum` therefore does NOT track the pinned/tested version — tests exercise the pinned `recommended` runtime while `minimum` stays at the broad floor. The `recommended` version SHALL be `0.84.0`; the server dependency `@earendil-works/pi-coding-agent` SHALL be pinned to `^0.84.0`; `minimum` SHALL stay `0.78.0` and `maximum` SHALL stay `null`.

The legacy offline-cache (`packages/electron/offline-packages.json`) was removed under change `eliminate-electron-runtime-install`; bundled-extension peer-deps are now the sole pin surface that must move in lockstep with `piCompatibility.minimum`. Because this change leaves `minimum` at `0.78.0`, those peer-deps SHALL remain unchanged.

`recommended` MAY move ahead of `minimum` to track the current upstream line without raising the hard floor: a runtime pin bump lifts `recommended` to the pinned version while `minimum` stays at the broadly-supported floor, so older-pi users see a soft upgrade hint but no blocking error.

Separately, the extension's devDependency `typebox` in `packages/extension/package.json` SHALL be bumped to `^1.3.7` to match pi's bundled runtime TypeBox, so the extension test suite validates against the runtime version (a test-fidelity pin, not a pi version pin). This change SHALL verify whether pi 0.84.0 ships a newer bundled TypeBox and lift the pin to match if so.

#### Scenario: Recommended tracks the current earendil line while floor stays broad

- **WHEN** the pinned/latest `@earendil-works/pi-coding-agent` runtime is `0.84.0`
- **AND** the bundled-extension peer-deps still permit the broad support floor (`>=0.75.0` / `^0.75.0`)
- **THEN** `piCompatibility.recommended` SHALL be `"0.84.0"`
- **AND** `piCompatibility.minimum` SHALL stay `"0.78.0"`
- **AND** users on `0.78.x`–`0.83.x` SHALL see `upgradeRecommended: true` but no `compatibility.error`

#### Scenario: Floor is not raised by a runtime pin bump

- **WHEN** the server dependency pin moves from `^0.83.0` to `^0.84.0`
- **AND** no 0.84.0 breaking change reaches a surface the dashboard consumes
- **THEN** `piCompatibility.minimum` SHALL remain `"0.78.0"`
- **AND** the bundled-extension peer-deps SHALL remain at `>=0.75.0` / `^0.75.0`

#### Scenario: Recommended moves ahead of floor when a patch ships

- **WHEN** a newer `@earendil-works/pi-coding-agent` patch is published
- **AND** the dashboard wants to surface the soft upgrade hint without raising the hard floor
- **THEN** `piCompatibility.recommended` MAY be lifted to that patch while `piCompatibility.minimum` stays at the broad floor
- **AND** users below `recommended` SHALL see `upgradeRecommended: true` but no `compatibility.error`

#### Scenario: Recommended tracks earendil when both forks publish in lockstep

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` publish the recommended version
- **THEN** `piCompatibility.recommended` MAY be set to that version and the dashboard SHALL accept either fork at that version

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
