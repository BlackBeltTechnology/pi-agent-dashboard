## MODIFIED Requirements

### Requirement: pi compatibility window

The server SHALL declare a `piCompatibility` window in `packages/server/package.json` — `{ minimum, recommended, maximum }` — read by `pi-version-skew.ts` to compute skew banners. The `recommended` version SHALL be `0.83.0`. The `minimum` version SHALL remain `0.78.0` and `maximum` SHALL remain `null`, so the dashboard continues to run against any installed pi at or above the minimum and never hard-blocks a session solely for running below `recommended`.

The primary-fork dependency `@earendil-works/pi-coding-agent` in `packages/server/package.json` SHALL be pinned to `^0.83.0`. The same recommended version SHALL be reflected in the release-gate pin (`scripts/verify-release-deps.mjs` `minVersion`) and the docker global-install pin (`docker/Dockerfile`), keeping the four single-source locations coherent. No other workspace package SHALL introduce a concrete pi version pin; all keep their `"*"` peer dependency.

#### Scenario: Recommended bump surfaces an upgrade hint, not a block

- **WHEN** a session runs on pi `0.81.1` (at or above `minimum: 0.78.0` but below `recommended: 0.83.0`)
- **THEN** `pi-version-skew.ts` SHALL surface an upgrade hint toward `0.83.0`
- **AND** the session SHALL continue to operate normally (no hard block)

#### Scenario: Below minimum still gated

- **WHEN** a session runs on pi below `minimum: 0.78.0`
- **THEN** the existing minimum-version gate SHALL apply unchanged

#### Scenario: Release-gate and docker pins stay coherent

- **WHEN** the recommended pin is `0.83.0`
- **THEN** `scripts/verify-release-deps.mjs` `minVersion` SHALL be `0.83.0`
- **AND** `docker/Dockerfile` SHALL install `@earendil-works/pi-coding-agent@0.83.0`
