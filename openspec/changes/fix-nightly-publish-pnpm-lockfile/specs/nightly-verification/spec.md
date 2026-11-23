## ADDED Requirements

### Requirement: The nightly publish script SHALL regenerate pnpm-lock.yaml before its lockfile gate

`scripts/nightly-verdaccio-publish.mjs` SHALL regenerate `pnpm-lock.yaml` with `pnpm install --lockfile-only` after rewriting the cross-ref specifiers and before running `scripts/verify-lockfile-versions.mjs`. Step (c) SHALL NOT regenerate the repository lockfile with npm. With pnpm installed and a lockfile that a `--frozen-lockfile` install accepts, the script SHALL pass its lockfile gate with no regeneration by its caller.

#### Scenario: Standalone run passes the lockfile gate

- **GIVEN** a job where pnpm is installed, on a checkout whose `pnpm-lock.yaml` records the cross-ref specifiers of the current release version
- **WHEN** `nightly-verdaccio-publish.mjs` runs with a nightly version and no earlier lockfile regeneration in the job
- **THEN** step (c) SHALL rewrite every workspace cross-ref specifier in `pnpm-lock.yaml` to `^<nightly version>`
- **AND** `verify-lockfile-versions.mjs` SHALL exit 0

#### Scenario: Caller already regenerated the lockfile

- **GIVEN** an `_electron-build.yml` nightly leg that ran `pnpm install --lockfile-only` and `verify-lockfile-versions.mjs` before the script
- **WHEN** the script runs with the same nightly version
- **THEN** every workspace cross-ref specifier in `pnpm-lock.yaml` SHALL still be `^<nightly version>`
- **AND** step (d) SHALL pass

#### Scenario: Missing pnpm fails before any publish

- **GIVEN** a job where `pnpm` is not on PATH
- **WHEN** the script runs
- **THEN** step (c) SHALL fail and the script SHALL exit non-zero
- **AND** no package SHALL have been published to the registry

#### Scenario: Step (c) runs on Windows

- **GIVEN** the script running on `win32` in a job where pnpm is installed
- **WHEN** it runs step (c)
- **THEN** step (c) SHALL exit 0
- **AND** step (d) SHALL pass
