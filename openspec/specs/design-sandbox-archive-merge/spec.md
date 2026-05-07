## ADDED Requirements

### Requirement: Pre-archive seed merge
The system SHALL merge `seed.patch` and `Dockerfile.patch` from a change directory BEFORE `openspec archive` moves the directory, ensuring patch files are accessible.

#### Scenario: Seed patch applied before archive move
- **WHEN** `openspec-archive-change` is invoked for a change containing `seed.patch`
- **THEN** the skill SHALL copy `seed.patch` to a temporary location
- **AND** SHALL apply it with `git apply --directory=seed/ <temp>/seed.patch`
- **AND** `git apply` SHALL be executed BEFORE `openspec archive <change>`
- **AND** on success, SHALL stage the changes with `git add seed/`
- **AND** SHALL then proceed with `openspec archive <change>`, amending the archive commit to include seed changes

#### Scenario: Conflicting seed patch aborts archive
- **WHEN** `git apply --directory=seed/ <temp>/seed.patch` fails with a conflict
- **THEN** the skill SHALL emit an error message: "seed.patch failed to apply: <git error>. Archive aborted. Resolve the conflict in seed/ and re-archive."
- **AND** SHALL NOT proceed with `openspec archive`
- **AND** SHALL leave `seed/` unchanged

#### Scenario: Dockerfile patch applied before archive move
- **WHEN** `openspec-archive-change` is invoked for a change containing `Dockerfile.patch`
- **THEN** the skill SHALL copy `Dockerfile.patch` to a temporary location
- **AND** SHALL apply it to `sandbox/Dockerfile` with `git apply <temp>/Dockerfile.patch`
- **AND** `git apply` SHALL be executed BEFORE `openspec archive <change>`

#### Scenario: Sandbox image rebuilt after patch
- **WHEN** any patch (`seed.patch` or `Dockerfile.patch`) was successfully applied AND Docker is available
- **THEN** the skill SHALL rebuild the sandbox image: `docker compose -f sandbox/docker-compose.yml build`
- **AND** a build failure SHALL emit a warning but SHALL NOT abort the archive (the seed data is committed; the image can be rebuilt later)

#### Scenario: No patches present — normal archive
- **WHEN** `openspec-archive-change` is invoked for a change that has neither `seed.patch` nor `Dockerfile.patch`
- **THEN** the skill SHALL proceed with normal archival (no seed merge step)
- **AND** SHALL NOT attempt any `git apply` or `docker compose build` commands

#### Scenario: Docker unavailable during archive-merge
- **WHEN** patches were applied but Docker is not available for image rebuild
- **THEN** the skill SHALL emit a notice: "Docker not available — sandbox image not rebuilt. Run `docker compose -f sandbox/docker-compose.yml build` manually when Docker is available."
- **AND** SHALL still commit the seed/Dockerfile changes and complete the archive
