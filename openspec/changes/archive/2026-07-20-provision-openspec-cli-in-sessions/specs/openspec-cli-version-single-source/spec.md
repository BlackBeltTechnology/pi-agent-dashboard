## ADDED Requirements

### Requirement: The monorepo SHALL resolve one installed openspec version

Every in-repo `@fission-ai/openspec` declaration SHALL use a compatible caret
range (`^1.6.0`) so npm hoists a single installed copy across all workspaces
(server poller, extension shim). The repo SHALL NOT use a root `overrides` entry
for this dep (it publishes with the root tarball and is redundant with hoisting).

#### Scenario: One installed version across workspaces

- **WHEN** `npm install` runs at the repo root with server and extension both
  declaring `^1.6.0`
- **THEN** `npm ls @fission-ai/openspec` SHALL show a single resolved `1.6.x`
  installed copy (no duplicate trees)

### Requirement: Skill regeneration SHALL use the installed version

The worktree-init skill regeneration SHALL invoke the **installed** `openspec` bin
with `--no-install` (`npx --no-install openspec init --tools pi --force`), so a
missing bin is a hard error rather than a silent network fetch, and the required
`--tools pi --force` flags are preserved.

#### Scenario: Regen is offline-hard and preserves flags

- **WHEN** worktree-init runs with the installed openspec at `1.6.0` and no network
- **THEN** it SHALL regenerate the `openspec-*` skills via the local bin (exit 0)
- **AND** a regenerated `SKILL.md` `generatedBy` SHALL read `1.6.0`
- **AND** with the bin absent it SHALL error (not silently fetch)

### Requirement: CI SHALL fail on openspec version drift

The `verify-release-deps.mjs` guard SHALL assert that the declared
`@fission-ai/openspec` sites (server dependency, extension dependency) share a
consistent version floor, and fail when any site drifts. The guard SHALL run in
CI on `develop` (not only at release).

#### Scenario: Drift is caught in CI

- **WHEN** the extension's `@fission-ai/openspec` floor diverges from the server's
- **THEN** `verify-release-deps.mjs` SHALL exit non-zero naming the drifted site
- **AND** this check SHALL run in the `ci.yml` develop pipeline
