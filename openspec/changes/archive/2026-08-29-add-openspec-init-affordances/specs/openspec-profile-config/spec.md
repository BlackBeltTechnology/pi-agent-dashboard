## ADDED Requirements

### Requirement: Successful initialization SHALL record the update signature

The update signature is currently recorded only by the update route, so a project initialized
by any other path reports `unknown` indefinitely.

`POST /api/openspec/init` SHALL record the cwd's current global workflow-set signature on
success, exactly as the update route does. It SHALL NOT record a signature when the CLI fails.

#### Scenario: Init records a signature

- **WHEN** `POST /api/openspec/init` succeeds for a cwd
- **THEN** that cwd's recorded signature SHALL equal the current global signature
- **AND** its update status SHALL be `up-to-date`

#### Scenario: Failed init records nothing

- **WHEN** `POST /api/openspec/init` fails for a cwd
- **THEN** no signature SHALL be recorded for that cwd

## MODIFIED Requirements

### Requirement: Report per-cwd update staleness

The server SHALL expose `GET /api/openspec/update-status` that returns, for each known cwd, one
of `up-to-date`, `needs-update`, or `unknown`.

- "Known cwds" SHALL be the union of active session cwds and pinned directories, **filtered to
  OpenSpec-initialized projects only** (a `<cwd>/openspec/` directory exists). Directories where
  `openspec init` has not run SHALL be excluded from both the status list and the update-all
  target set.
- A cwd is `needs-update` when a recorded signature exists but differs from the current one.
- A cwd is `unknown` when no signature has been recorded.

**`unknown` SHALL NOT be treated as a stale or degraded condition by any consumer.** It means
never-measured, not out-of-date. Only `needs-update` indicates that a project lags the current
global profile. In particular the readiness derivation (see `openspec-readiness`) SHALL NOT
classify an `unknown` cwd as `STALE` on that basis.

This filtered known-cwd set SHALL NOT be reused to validate initialization targets, because it
excludes by construction every directory that has not yet been initialized.

#### Scenario: Project matching current config is up-to-date

- **WHEN** a cwd's recorded signature equals the current global workflow-set signature
- **THEN** the status for that cwd is `up-to-date`

#### Scenario: Project lagging the current config needs update

- **WHEN** the global profile changed since a cwd was last updated via the dashboard
- **THEN** the status for that cwd is `needs-update`

#### Scenario: Never-updated project is unknown

- **WHEN** the dashboard has no recorded signature for a cwd
- **THEN** the status for that cwd is `unknown`

#### Scenario: Unknown does not present as stale

- **WHEN** a cwd's status is `unknown` and it is otherwise fully initialized with skills present
- **THEN** its readiness state SHALL be `READY`
- **AND** no surface SHALL present it as needing an update

#### Scenario: Non-initialized directories are excluded

- **WHEN** a known directory contains no `<cwd>/openspec/`
- **THEN** it SHALL NOT appear in the update-status list
- **AND** it SHALL NOT be a target of update-all
