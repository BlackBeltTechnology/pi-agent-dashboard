# code-quality-loop Specification

## Purpose
TBD - created by archiving change add-code-quality-skill. Update Purpose after archive.
## Requirements
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

The `correctness` tier SHALL enable `noUndeclaredDependencies` at `error`
severity in the base rule set, not leave it to an ad-hoc `--only` probe. This is
load-bearing: Biome's `--only=<rule>` flag force-enables the named rule and
**bypasses `overrides` severity entirely**, so a rule resolved by override can
never reach zero under `--only`. Only `files.includes` exclusions survive that
flag. Because this change resolves test files and build/config entry points by
override, the rule MUST be enabled in the base config and verified with a plain
`biome lint .` invocation.

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

### Requirement: Severity-driven scope behavior

The configuration SHALL rely on Biome severity to separate soft from hard gating.
`warn`-severity rules SHALL NOT cause a non-zero exit unless `--error-on-warnings`
is passed; `error`-severity rules SHALL always cause a non-zero exit. A single
`biome.json` SHALL serve the changed-files, whole-repo-CI, and explicit-cleanup
scopes by varying only the invocation flags.

#### Scenario: CI soft warn

- **WHEN** CI runs `biome lint .` and the only violations are warn-tier
- **THEN** the command SHALL exit 0 and the violations SHALL appear as annotations, not failures.

#### Scenario: Goal-loop hard gate on changed files

- **WHEN** the goal loop runs `biome check --changed --error-on-warnings` and a changed file has a warn-tier violation
- **THEN** the command SHALL exit non-zero, signalling the judge to continue.

### Requirement: Deterministic quality oracle script

The project SHALL provide a `quality:changed` npm script that runs
`biome check --changed --error-on-warnings --write`, then `tsc --noEmit`, then
`npm test`, and exits with the first non-zero status. The existing `lint`
(`tsc --noEmit`) script SHALL remain unchanged. The project SHALL also provide
`lint:biome`, `fix:changed`, and `quality:report` scripts.

#### Scenario: Oracle passes on clean diff

- **WHEN** `quality:changed` runs and changed files are Biome-clean, types compile, and tests pass
- **THEN** it SHALL exit 0.

#### Scenario: Oracle fails on dirty diff

- **WHEN** `quality:changed` runs and a changed file has an unfixable warn-tier or error-tier violation, or a type error, or a failing test
- **THEN** it SHALL exit non-zero.

### Requirement: Code-quality skill with analyze-fix-test procedure

The project SHALL provide a `.pi/skills/code-quality/SKILL.md` skill describing
an analyze → fix → test procedure with two modes: a changed-files mode for the
goal loop and a whole-repo mode for explicit cleanup. The skill SHALL encode the
guardrails: changed-files scope by default, a test gate (`tsc --noEmit` + `npm test`)
after every fix batch with revert-on-red, safe fixes auto-applied while unsafe and
manual fixes are surfaced as a report, and no edits to files outside the diff. The
skill SHALL provide the goal-text templates a judge model consumes.

#### Scenario: Skill drives the goal loop

- **WHEN** a user sets a goal using the skill's daily-driver template
- **THEN** the agent SHALL run `quality:changed`, fix reported issues on changed files only, and the judge SHALL mark the goal achieved once the script exits 0.

#### Scenario: Skill forbids scope creep

- **WHEN** the agent fixes issues under the skill
- **THEN** it SHALL NOT modify files outside the current diff and SHALL revert a fix batch if the test gate goes red.

### Requirement: Ratchet graduation and CI integration

Rules SHALL progress one-way through severities (`off → warn → error`). A rule
SHALL graduate from `warn` to `error` only after `biome lint . --only=<rule>`
reports zero violations outside grandfathered overrides. CI SHALL run
`biome lint .` after the existing `tsc` lint step so that error-tier rules gate
regressions while warn-tier rules annotate without failing the build.

#### Scenario: Tier A regression blocked after graduation

- **WHEN** a Tier A rule has graduated to `error` and a PR reintroduces a violation of it
- **THEN** the CI Biome step SHALL exit non-zero and block the PR.

### Requirement: Undeclared-dependency findings reach zero at repo-root scope

`noUndeclaredDependencies` SHALL report zero findings when run at repo-root
scope, which is the scope CI uses and the scope the ratchet's graduation
criterion evaluates.

The oracle SHALL be a plain `npx biome lint . --max-diagnostics=20000`, filtered
to the `lint/correctness/noUndeclaredDependencies` category, with the rule
enabled at `error` in the base config. The oracle SHALL NOT be an
`--only=correctness/noUndeclaredDependencies` probe, because that flag bypasses
`overrides` and would report findings for every file this change deliberately
resolves by override.

Repo-root scope is load-bearing and distinct from `packages/` scope: `biome lint .`
additionally reaches root `scripts/`, `examples/`, `tests/e2e/`, `qa/scripts/`,
`.pi/skills/**/scripts/`, `.pi/flows/**`, and `openspec/changes/**/spike/`.
Measuring `packages/` alone understates the finding count.

Findings SHALL be resolved by declaration wherever the importing file is
published, and by override or ignore only where the importing file is never
published. No finding in shipped code SHALL be resolved by suppression.

#### Scenario: Repo-root probe reports zero

- **WHEN** running `npx biome lint . --max-diagnostics=20000` at repo root
- **THEN** it SHALL report zero diagnostics in the `lint/correctness/noUndeclaredDependencies` category

#### Scenario: The rule is enabled in the base configuration

- **WHEN** reading `biome.json`
- **THEN** `linter.rules.correctness.noUndeclaredDependencies` SHALL be `"error"`

#### Scenario: An `--only` probe is not a valid oracle for an override-resolved rule

- **WHEN** running `npx biome lint --only=correctness/noUndeclaredDependencies` against a file covered by a build/config override that disables the rule
- **THEN** the finding SHALL still be reported, demonstrating that `--only` bypasses override severity
- **AND** the same file under a plain `biome lint` invocation SHALL report no finding

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

