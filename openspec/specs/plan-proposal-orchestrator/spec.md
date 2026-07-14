# plan-proposal-orchestrator Specification

## Purpose
Develop-side planning orchestrator for an OpenSpec change, main interactive session only. Composes existing skills — ensures planning artifacts exist, runs `doubt-driven-review` on `proposal.md`/`design.md`, then runs `scenario-design` and folds each automated scenario into `tasks.md` as a vanilla checkbox routed to its test category. The `test-plan.md` manifest is the single source of truth for automated-vs-manual. Stops at the git-worktree boundary and hands off to `ship-it`.
## Requirements
### Requirement: Planning-phase orchestration on develop, main session only

The `plan-proposal` skill SHALL orchestrate the planning phase of an OpenSpec
change on the `develop` branch by composing existing skills, and SHALL run only
in the main interactive session. It MUST NOT be spawned as a subagent, because
it invokes `doubt-driven-review` (which spawns a fresh-context reviewer, and
interactively a second cross-model reviewer) and `scenario-design` (whose
proposal/design-stage gate calls `ask_user`), both of which require a live main
session.

#### Scenario: Invoked in the main session
- **WHEN** a user invokes `plan-proposal` for a change in the main session on `develop`
- **THEN** it ensures the planning artifacts exist (via `openspec-new-change`/`-ff`/`-continue`), then runs doubt-review and scenario folding as ordered steps

#### Scenario: Refused inside a subagent
- **WHEN** `plan-proposal` detects it is running inside a subagent context where nested reviewer spawn is blocked
- **THEN** it SHALL stop and surface that planning must run in the main session, rather than degrade the doubt-review

### Requirement: Doubt-review trigger on proposal or design authoring

`plan-proposal` SHALL run `doubt-driven-review` on `proposal.md` and `design.md`
whenever either is drafted or modified during the planning phase, passing
ARTIFACT + CONTRACT only (never the CLAIM), and SHALL surface the interactive
cross-model offer.

#### Scenario: Proposal drafted or edited
- **WHEN** `proposal.md` or `design.md` is created or changed within `plan-proposal`
- **THEN** it invokes `doubt-driven-review` on the changed artifact and reconciles findings before proceeding to folding

#### Scenario: Review reveals an actionable finding
- **WHEN** the doubt-review classifies a finding as valid + actionable
- **THEN** `plan-proposal` pauses for the artifact to be corrected before committing planning artifacts

### Requirement: Category-routed scenario folding into vanilla tasks

`plan-proposal` SHALL run `scenario-design`, then fold each `automated` scenario
into `tasks.md` as an ordinary checkbox task routed to its test category (L1
unit, L2 qa smoke, L3 e2e, electron, ci). Folded test tasks SHALL reference the
nearest existing spec of that category as a harness exemplar and carry the
scenario Triple, as plain text. `tasks.md` MUST remain vanilla checkbox format
with no custom parser-visible token, so `openspec status --json` and the
generated apply skill parse it unchanged.

#### Scenario: Automatable scenario folded to a category
- **WHEN** `scenario-design` routes a scenario to L3 e2e
- **THEN** `plan-proposal` writes a `- [ ]` task authoring `tests/e2e/<name>.spec.ts` that references an existing e2e spec exemplar and the scenario Triple

#### Scenario: tasks.md stays parser-safe
- **WHEN** the fold writes any test task
- **THEN** the task line contains only vanilla checkbox text and any manifest reference as ordinary prose, and `openspec status --json` reports the same task counts as before the reference was added

### Requirement: Manifest is the source of truth for automated-vs-manual

`scenario-design`'s `test-plan.md` SHALL carry, per scenario row, a `level` and a
`disposition` of `automated` or `manual-only`. This manifest — not any `tasks.md`
tag — SHALL be the single source of truth for whether a scenario is an
automated must-pass test or a genuinely manual check. `manual-only` covers
scenarios with no automatable observable (aesthetics, hardware, subjective).

#### Scenario: Disposition recorded in the manifest
- **WHEN** `scenario-design` classifies a scenario as un-automatable
- **THEN** its `test-plan.md` row records `disposition: manual-only`, and no automated test task is folded for it

#### Scenario: Human reviews dispositions on the correct artifact
- **WHEN** the planning phase presents the fold for review
- **THEN** the `automated`/`manual-only` dispositions are visible in `test-plan.md`, the artifact the human already reviews in planning

### Requirement: Stop at the worktree boundary

After the planning artifacts are committed to `develop`, `plan-proposal` SHALL
stop at the point a worktree is spawned from that commit, handing control to a
human checkpoint. It SHALL NOT continue into the implementation phase itself.

#### Scenario: Planning complete
- **WHEN** proposal, design, specs, and tasks are committed and the worktree is created
- **THEN** `plan-proposal` reports readiness and stops, instructing the user to run `ship-it` inside the worktree

