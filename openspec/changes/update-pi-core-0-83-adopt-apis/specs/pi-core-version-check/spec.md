## MODIFIED Requirements

### Requirement: pi compatibility window

The server SHALL declare a `piCompatibility` window in `packages/server/package.json` — `{ minimum, recommended, maximum }` — read by `pi-version-skew.ts` to compute skew banners. The `recommended` version SHALL be `0.83.0`. The `minimum` version SHALL remain `0.78.0` and `maximum` SHALL remain `null`, so the dashboard continues to run against any installed pi at or above the minimum and never hard-blocks a session solely for running below `recommended`.

The primary-fork dependency `@earendil-works/pi-coding-agent` in `packages/server/package.json` SHALL be pinned to `^0.83.0`. The same recommended version SHALL be reflected in the release-gate pin (`scripts/verify-release-deps.mjs`) and the docker global-install pin (`docker/Dockerfile`). No other workspace package SHALL introduce a concrete pi version pin; all keep their `"*"` peer dependency. Separately, the extension's devDependency `typebox` in `packages/extension/package.json` SHALL be bumped to `^1.3.7` to match pi's bundled runtime TypeBox, so the extension test suite validates against the runtime version (this is a test-fidelity pin, not a pi version pin).

#### Scenario: Recommended bump surfaces an upgrade hint, not a block

- **WHEN** a session runs on pi `0.81.1` (at or above `minimum: 0.78.0` but below `recommended: 0.83.0`)
- **THEN** `pi-version-skew.ts` SHALL surface an upgrade hint toward `0.83.0`
- **AND** the session SHALL continue to operate normally (no hard block)

#### Scenario: Below minimum still gated

- **WHEN** a session runs on pi below `minimum: 0.78.0`
- **THEN** the existing minimum-version gate SHALL apply unchanged

### Requirement: The release-deps checker SHALL enforce pi pin coherence

`scripts/verify-release-deps.mjs` SHALL enforce that the pi recommended version is coherent across the three pi-version pins it governs, not merely that the server dependency meets a floor. The checker SHALL assert that `packages/server/package.json` `dependencies.@earendil-works/pi-coding-agent` (a range, e.g. `^0.83.0`), `packages/server/package.json` `piCompatibility.recommended` (an exact string, e.g. `0.83.0`), and the `docker/Dockerfile` global-install pin (e.g. `@0.83.0`) all resolve to the same normalized version, and SHALL fail the release gate when any of them drifts. Comparison SHALL normalize each pin's syntax (reusing the existing `floorOf()`-style normalizer that strips `^`/`~`/`@` and pre-release suffixes) rather than comparing literal strings. The extension devDep `typebox` is a separate test-fidelity pin and is out of scope for this pi-version coherence rule.

#### Scenario: Coherent pins pass

- **GIVEN** the server dep range, `piCompatibility.recommended`, and the Dockerfile pin all reference `0.83.0`
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the pi coherence check SHALL pass

#### Scenario: Drifted pin fails the gate

- **GIVEN** one of the governed pi pins references a different version than the others
- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** the checker SHALL fail and name the drifted location
