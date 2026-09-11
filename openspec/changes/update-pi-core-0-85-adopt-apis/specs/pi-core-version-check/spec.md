## MODIFIED Requirements

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@earendil-works/pi-coding-agent`.

**`minimum` SHALL track `recommended` in lockstep.** This supersedes the prior policy under which `minimum` was an INDEPENDENT broad-support floor that "SHALL NOT be raised merely because tests or the pinned runtime moved". That policy is withdrawn: the broad floor accumulated conditional bridge code — version gates with no test coverage on the floor runtime and hand-rolled version comparators — whose fallback branches could not be exercised in CI and were therefore unverified. A single supported pi removes the class of defect entirely. The cost is an explicit one-release hard break for users on a below-floor pi, which SHALL be accepted deliberately, announced in `CHANGELOG.md`, and paired with an in-product upgrade hint naming the required version.

The `recommended` version SHALL be `0.85.1`; the server dependency `@earendil-works/pi-coding-agent` SHALL be pinned to `^0.85.1`; `minimum` SHALL be `0.85.1` and `maximum` SHALL stay `null`.

A future pin bump SHALL raise `minimum` to the new pinned version together with `recommended`, in the same change. A change that lifts `recommended` while leaving `minimum` behind SHALL be treated as a spec violation, not as a soft-landing option.

Change `eliminate-electron-runtime-install` removed the legacy offline-cache (`packages/electron/offline-packages.json`) and the forge wiring that shipped `packages/electron/resources/bundled-extensions/` into the app bundle. The source directory itself still exists on disk (`pi-flows/package.json`, `pi-anthropic-messages/package.json`, each peer-declaring `@earendil-works/pi-coding-agent ^0.75.0` / `>=0.75.0`), but it is no longer packaged, so those manifests are NOT a shipped pin surface and SHALL NOT be treated as floor anchors that must move with `piCompatibility.minimum`.

**Publishable-package peer ranges are OUT of the governed pin set.** `packages/extension` and the other publishable extension packages declare a broad `@earendil-works/pi-coding-agent >=0.80.10` peer range. That range describes what the published npm package supports for ITS OWN consumers — arbitrary pi users who install the extension without the dashboard — and is independent of the dashboard's `piCompatibility.minimum`. It SHALL NOT be raised in lockstep with the floor. Retiring the `agent_settled` synthesis path does not invalidate it: pi emits `agent_settled` natively from `0.80.4`, below the declared `>=0.80.10` peer floor.

Separately, the extension's devDependency `typebox` in `packages/extension/package.json` is a test-fidelity pin matching pi's bundled runtime TypeBox, not a pi version pin. pi 0.85.1 declares TypeBox `1.3.7`, unchanged from 0.84.4, so the pin SHALL stay `^1.3.7`. This SHALL be verified against the *installed* `package.json` after the bump lands — not against the changelog, and not against the pre-bump tree (0.84.4's own manifest does not list typebox at all).

#### Scenario: Floor and recommended move together on a pin bump

- **WHEN** the pinned `@earendil-works/pi-coding-agent` runtime is `0.85.1`
- **THEN** `piCompatibility.recommended` SHALL be `"0.85.1"`
- **AND** `piCompatibility.minimum` SHALL be `"0.85.1"`
- **AND** `piCompatibility.maximum` SHALL be `null`

#### Scenario: Below-floor pi is hard-blocked, not soft-hinted

- **WHEN** the running pi-coding-agent reports a version in the `0.78.x` through `0.84.x` range
- **THEN** `computeCompatibility` SHALL populate `bootstrapState.compatibility.error` with a message naming both the running version and the required `0.85.1`
- **AND** the bootstrap banner SHALL render in the red "below minimum" state
- **AND** the user SHALL NOT be left on a silent `upgradeRecommended` hint
- **AND** the block SHALL be an advisory surfaced through `/api/health` + `PiVersionAdvisory`; no HTTP status change (there is no 503 compatibility gate in the tree and this change adds none)

#### Scenario: Lifting recommended without the floor is rejected

- **WHEN** a change sets `piCompatibility.recommended` to a version newer than `piCompatibility.minimum`
- **THEN** that divergence SHALL be treated as a spec violation requiring the floor to be raised in the same change

#### Scenario: Upgrade-hint band is empty under lockstep

- **WHEN** `piCompatibility.minimum` equals `piCompatibility.recommended`
- **THEN** no running version can be below `recommended` and at or above `minimum`, so the soft-hint band is empty in the shipped configuration
- **AND** `computeCompatibility` SHALL nevertheless retain the hint branch (`current >= minimum && current < recommended` → `upgradeRecommended: true`, no `error`, `status: "ready"`), because the function is range-parameterized and is exercised with synthetic ranges by `pi-version-skew-recommended-0-84.test.ts`
- **AND** removing that branch SHALL NOT be treated as dead-code cleanup licensed by this change

#### Scenario: Minimum version drives the blocking error

- **WHEN** the running pi-coding-agent version is below `piCompatibility.minimum`
- **THEN** `bootstrapState.compatibility` includes a populated `error` message
- **AND** the bootstrap banner renders in the red "below minimum" state

#### Scenario: Upgrade hint names the required version

- **WHEN** the bootstrap status renders the red "below minimum" banner
- **THEN** the banner SHALL name the exact required version (`0.85.1`)
- **AND** SHALL state that the pi install must be upgraded before the dashboard will operate

#### Scenario: Recommended tracks earendil when both forks publish in lockstep

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` publish the recommended version
- **THEN** `piCompatibility.recommended` MAY be set to that version and the dashboard SHALL accept either fork at that version

#### Scenario: Maximum is unbounded

- **WHEN** `piCompatibility.maximum` is `null`
- **THEN** no upper-bound block is produced regardless of the running pi version

### Requirement: The release-deps checker SHALL enforce pi pin coherence

`scripts/verify-release-deps.mjs` SHALL enforce that the pi version is coherent across every pi-version pin it governs, not merely that the server dependency meets a floor. The checker SHALL assert that `packages/server/package.json` `dependencies.@earendil-works/pi-coding-agent` (a range, e.g. `^0.85.1`), `packages/server/package.json` `piCompatibility.recommended` (an exact string, e.g. `0.85.1`), `packages/server/package.json` `piCompatibility.minimum` (an exact string, equal to `recommended` under the lockstep policy), the `docker/Dockerfile` global-install pin (e.g. `@0.85.1`), and the `pnpm-workspace.yaml` `overrides["@earendil-works/pi-coding-agent"]` resolution pin (an exact string, e.g. `0.85.1`) all resolve to the same normalized version, and SHALL fail the release gate when any of them drifts. The checker's own `minVersion` constant SHALL equal that same normalized version. The `overrides` pin is load-bearing under `nodeLinker: hoisted`: without it the broad `>=0.80.10` peer ranges resolve a SECOND, older hoisted copy that `/api/health`'s version probe then reports (the ghost-version defect recorded by `update-pi-core-0-84-adopt-apis`). Comparison SHALL normalize each pin's syntax (reusing the existing `floorOf()`-style normalizer that strips `^`/`~`/`@` and pre-release suffixes) rather than comparing literal strings. The extension devDep `typebox` is a separate test-fidelity pin and is out of scope for this pi-version coherence rule.

#### Scenario: Coherent pins pass

- **GIVEN** the server dep range, `piCompatibility.recommended`, `piCompatibility.minimum`, the Dockerfile pin, the `pnpm-workspace.yaml` override, and the checker's `minVersion` all reference `0.85.1`
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the pi coherence check SHALL pass

#### Scenario: Drifted pin fails the gate

- **GIVEN** one of the governed pi pins references a different version than the others
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the checker SHALL fail and name the drifted location

#### Scenario: A lagging minimum fails the gate

- **GIVEN** `piCompatibility.recommended` is `0.85.1` and `piCompatibility.minimum` is still `0.78.0`
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the checker SHALL fail and name `piCompatibility.minimum` as the drifted location
