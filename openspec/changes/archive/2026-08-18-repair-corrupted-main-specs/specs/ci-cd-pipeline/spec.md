# ci-cd-pipeline — delta

## ADDED Requirements

### Requirement: CI gates OpenSpec main-spec integrity

The `ci` job in `.github/workflows/ci.yml` SHALL run
`openspec validate --specs --no-interactive` and SHALL fail the workflow when any
main spec under `openspec/specs/**` is invalid.

The repo already gates the openspec **version** (`scripts/verify-release-deps.mjs`)
but has never gated spec **content**. In that blind spot 80 of 546 main specs
drifted into unparseable states, hiding 384 requirement blocks. This gate closes
the loop: a change that archives into a corrupt main spec fails on `develop`
instead of accumulating undetected.

The gate SHALL be reproducible locally via an `npm run spec:validate` script
invoking the same command, so a contributor can reproduce a CI failure without
reading the workflow.

#### Scenario: Corrupt main spec fails CI

- **WHEN** a push or pull request targeting `develop` contains a main spec with a
  delta header, a missing `## Purpose`, or a missing `## Requirements`
- **THEN** the `ci` job SHALL fail
- **AND** the failure SHALL name the offending capability

#### Scenario: Clean spec tree passes

- **WHEN** every spec under `openspec/specs/**` satisfies the structural contract
- **THEN** the spec-integrity step SHALL exit zero and SHALL NOT block the PR

#### Scenario: Gate is reproducible locally

- **WHEN** a contributor runs `npm run spec:validate`
- **THEN** it SHALL invoke `openspec validate --specs --no-interactive`
- **AND** SHALL produce the same pass/fail verdict as CI

#### Scenario: Gate runs on the existing ci job

- **WHEN** `ci.yml` is inspected
- **THEN** the spec-integrity step SHALL live in the existing `ci` job rather
  than a new job, reusing its checkout and `pnpm install --frozen-lockfile`
- **AND** SHALL NOT add a separate required status check
