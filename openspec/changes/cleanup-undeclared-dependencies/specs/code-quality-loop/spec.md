# code-quality-loop

## MODIFIED Requirements

### Requirement: Biome-backed static analysis configuration

The project SHALL provide a single `biome.json` that configures Biome for the
monorepo. The formatter SHALL be disabled by default; when enabled it SHALL use
space indentation. VCS integration SHALL be enabled with `clientKind: git`,
`useIgnoreFile: true`, and `defaultBranch: develop` (the repo's integration
branch; there is no `main`). The config SHALL ignore build
output (`dist/`, `**/dist/`, `*.tsbuildinfo`), generated plugin-registry output,
and `openspec/changes/archive/**`. Rules SHALL be organized into tiers (high-signal
Tier A, noisy-but-valuable Tier B, style/complexity Tier C), with accessibility
rules scoped to `packages/client/**`.

Overrides SHALL exist for `__tests__/**` (matching `**/__tests__/**`,
`**/*.test.ts`, `**/*.test.tsx`) and for build/config entry points. The previously
specified overrides for `packages/server/**` and `scripts/**` SHALL NOT be
asserted, because they do not exist in `biome.json`; this corrects a
long-standing divergence between this specification and the configuration.

The build/config override SHALL be derived from probe output rather than from an
assumed filename pattern. A glob set limited to `**/vitest.config.ts`,
`**/vite.config.ts`, and `**/forge.config.ts` is insufficient: it does not match
`packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`,
`packages/client/scripts/vite-build.mjs`, or
`packages/electron/scripts/download-git-windows.mjs`, all of which are build-time
files that are never published.

The build/config override SHALL NOT match any file under a `src/` directory.
Verifying that the override reduces a rule's finding count to zero proves
coverage but cannot detect an over-broad glob, because a wrongly-matched source
file also reports zero.

#### Scenario: Lint respects ignores

- **WHEN** `biome lint .` runs
- **THEN** it SHALL NOT report diagnostics for files under `dist/`, `**/dist/`, or `openspec/changes/archive/**`.

#### Scenario: Formatter does not reformat the tree

- **WHEN** `biome check --changed --write` runs in Phase 0
- **THEN** it SHALL NOT reformat files, because the formatter is disabled.

#### Scenario: The build/config override matches no source file

- **WHEN** enumerating every file matched by the build/config override block
- **THEN** none of them SHALL lie under any `src/` directory

#### Scenario: The build/config override covers non-obvious build entry points

- **WHEN** the override is applied
- **THEN** it SHALL match `packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`, `packages/client/scripts/vite-build.mjs`, and `packages/electron/scripts/download-git-windows.mjs`

#### Scenario: Specification matches configuration for overrides

- **WHEN** comparing this specification's asserted override set against `biome.json`
- **THEN** every override this specification asserts SHALL exist in `biome.json`

## ADDED Requirements

### Requirement: Undeclared-dependency findings reach zero at repo-root scope

`noUndeclaredDependencies` SHALL report zero findings when run at repo-root
scope, which is the scope CI uses and the scope the ratchet's graduation
criterion evaluates.

Repo-root scope is load-bearing and distinct from `packages/` scope: `biome lint .`
additionally reaches root `scripts/`, `examples/`, `tests/e2e/`, `qa/scripts/`,
`.pi/skills/**/scripts/`, `.pi/flows/**`, and `openspec/changes/**/spike/`.
Measuring `packages/` alone understates the finding count.

Findings SHALL be resolved by declaration wherever the importing file is
published, and by override or ignore only where the importing file is never
published. No finding in shipped code SHALL be resolved by suppression.

#### Scenario: Repo-root probe reports zero

- **WHEN** running `npx biome lint --only=correctness/noUndeclaredDependencies . --max-diagnostics=20000`
- **THEN** the command SHALL report zero findings

#### Scenario: Root tooling dependencies are declared as devDependencies

- **WHEN** a script under root `scripts/` imports a package, and that script is not listed in the root `package.json` `files` array
- **THEN** the package SHALL be declared in the root `devDependencies`
- **AND** it SHALL NOT be declared in the root `dependencies`, because the root is itself a published metapackage and would otherwise ship the dependency to consumers that never receive the script

#### Scenario: Non-published trees are ignored, not declared

- **WHEN** a finding originates in `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**`, `tests/e2e/`, `qa/scripts/`, or `.pi/skills/**/scripts/`
- **THEN** it SHALL be resolved by a Biome ignore or override rather than by adding a dependency declaration

### Requirement: Declared ranges are satisfied by the resolving version

When a dependency declaration is added, its range SHALL be satisfied by the
version that currently resolves in the workspace.

Where the same dependency is already declared elsewhere in the repository, that
range SHALL be reused **only if** the resolving version satisfies it. Where an
existing range is not satisfied by the resolving version, the existing range
SHALL NOT be propagated; a range based on the resolving version SHALL be used
instead.

Where sibling workspaces declare different ranges that the resolving version all
satisfy, the range with the **highest lower bound** SHALL be used. Semver range
comparison is not a total order, so "narrowest" is defined concretely as
greatest-minimum: given `>=3.0.0`, `^3.0.0`, and `^3.9.0` with `3.10.0`
resolving, `^3.9.0` wins.

#### Scenario: Reused range must be satisfied

- **WHEN** adding a declaration for a dependency already declared elsewhere in the repository
- **THEN** the reused range SHALL be satisfied by the version resolving in `node_modules`

#### Scenario: Unsatisfiable existing ranges are not propagated

- **WHEN** an existing declaration's range is not satisfied by the resolving version
- **THEN** that range SHALL NOT be copied into the new declaration

#### Scenario: Highest lower bound wins among disagreeing siblings

- **WHEN** sibling workspaces declare several ranges for one dependency and the resolving version satisfies more than one
- **THEN** the range with the greatest lower bound SHALL be chosen

#### Scenario: wouter resolves to the highest-minimum sibling range

- **WHEN** declaring `wouter` for `packages/automation-plugin`, given siblings declaring `>=3.0.0`, `^3.0.0`, and `^3.9.0`, with `3.10.0` resolving
- **THEN** the declared range SHALL be `^3.9.0`
