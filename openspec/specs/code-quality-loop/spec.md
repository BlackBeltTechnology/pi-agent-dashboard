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
rules scoped to `packages/client/**` and relaxed overrides for `__tests__/**`,
`packages/server/**`, and `scripts/**`.

#### Scenario: Lint respects ignores

- **WHEN** `biome lint .` runs
- **THEN** it SHALL NOT report diagnostics for files under `dist/`, `**/dist/`, or `openspec/changes/archive/**`.

#### Scenario: Formatter does not reformat the tree

- **WHEN** `biome check --changed --write` runs in Phase 0
- **THEN** it SHALL NOT reformat files, because the formatter is disabled.

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

