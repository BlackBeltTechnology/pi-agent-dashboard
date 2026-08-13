# CI/CD Pipeline

## ADDED Requirements

### Requirement: Nightly Knip pass reports, it does not gate

The whole-graph Knip scan SHALL run in the nightly workflow rather than the
per-PR `ci.yml`, so its runtime never sits on the PR path. Nightly runs after
merge and therefore SHALL be described as detection, not prevention; the
preventive gate lives in the `ship-it` enforcer step under `code-quality-loop`.

#### Scenario: Nightly runs Knip

- **WHEN** the nightly workflow executes
- **THEN** a Knip job runs the whole-graph scan
- **AND** its per-class counts are recorded in the job output

#### Scenario: PR CI does not run Knip

- **WHEN** `ci.yml` executes for a pull request
- **THEN** no Knip job runs

#### Scenario: Nightly regression is visible

- **WHEN** the nightly Knip job finds a class above its baseline
- **THEN** the job fails so the regression is visible in the nightly report
- **AND** the failure names the class and the delta

### Requirement: The Docker harness analyses the same tree

The Docker harness SHALL run the Knip pass over the same module graph the host
analyses. The image is otherwise a runtime-only subset, and a scan over a subset
silently reports fewer findings — measured, the unmodified image reported 13
unused files and 233 unused exports against the host's 10 and 227.

#### Scenario: The image carries every analysed tree

- **WHEN** the harness image is built
- **THEN** it contains `knip.json`, `knip-baseline.json`, `playwright.config.ts`,
  `.github/workflows`, `tests/`, `qa/`, `public/`, and `.pi/skills`
- **AND** it does NOT contain `.pi/settings.json`, which pins a host absolute
  path for its extension packages

#### Scenario: Harness and host agree on unused files

- **WHEN** the Knip pass is invoked inside the Docker harness
- **THEN** the set of unused files it reports equals the host's set exactly
- **AND** the ratchet passes inside the container

#### Scenario: Cross-environment scalar equality is not required

- **WHEN** comparing per-class counts between host and container
- **THEN** the `types` class MAY differ by a small margin attributable to the
  environment rather than the tree (measured: exactly one, with identical file
  hashes, identical TypeScript and `@types/react`, and each environment
  internally deterministic)
- **AND** the gate SHALL NOT assert exact scalar equality across environments,
  because that is not a property Knip has
