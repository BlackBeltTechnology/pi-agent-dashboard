## MODIFIED Requirements

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent` and a `minimum` version that matches the version actually exercised in the dashboard's tests and the bundled-extensions peer-dep constraints in `packages/electron/resources/bundled-extensions/*/package.json`.

The legacy offline-cache (`packages/electron/offline-packages.json`) was removed under change `eliminate-electron-runtime-install`; bundled-extension peer-deps are now the sole pin surface that must move in lockstep with `piCompatibility.minimum`.

#### Scenario: Recommended tracks earendil 0.76 line

- **WHEN** the latest published `@earendil-works/pi-coding-agent` is `0.76.0`
- **AND** every bundled-extension `package.json` declares peer-dep `@earendil-works/pi-coding-agent` at `>=0.76.0` (or `^0.76.0`)
- **THEN** `piCompatibility.minimum` SHALL be `"0.76.0"`
- **AND** `piCompatibility.recommended` SHALL be `"0.76.0"`

#### Scenario: Recommended moves ahead of floor when a 0.76 patch ships

- **WHEN** `@earendil-works/pi-coding-agent@0.76.1` is published
- **AND** the dashboard wants to surface the soft upgrade hint without raising the hard floor
- **THEN** `piCompatibility.recommended` MAY be lifted to `"0.76.1"` while `piCompatibility.minimum` stays at `"0.76.0"`
- **AND** users on `0.76.0` SHALL see `upgradeRecommended: true` but no `compatibility.error`

#### Scenario: Recommended tracks earendil when both forks publish in lockstep

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` publish `0.76.0`
- **THEN** `piCompatibility.recommended` MAY be set to `"0.76.0"` and the dashboard SHALL accept either fork at that version

#### Scenario: Recommended version drives the upgrade hint

- **WHEN** the running pi-coding-agent version is below `piCompatibility.recommended`
- **THEN** `bootstrapState.compatibility.upgradeRecommended` is `true`
- **AND** the bootstrap status response is still `status: "ready"` (non-blocking)

#### Scenario: Minimum version drives the blocking error

- **WHEN** the running pi-coding-agent version is below `piCompatibility.minimum`
- **THEN** `bootstrapState.compatibility` includes a 503-blocking `error` message
- **AND** the bootstrap banner renders in the red "below minimum" state

#### Scenario: Pi 0.75 user sees blocking error after bump

- **WHEN** `piCompatibility.minimum` is `"0.76.0"`
- **AND** the running pi-coding-agent reports version `"0.75.5"`
- **THEN** the bootstrap status SHALL render the red "below minimum" banner with a clear upgrade hint pointing at `0.76.0`

#### Scenario: Maximum is unbounded

- **WHEN** `piCompatibility.maximum` is `null`
- **THEN** no upper-bound block is produced regardless of the running pi version
