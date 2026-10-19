# openspec-detection Specification

## Purpose
Maps raw `openspec status --json` output plus local file-system evidence into the dashboard's per-change artifact statuses and `isComplete` flag. This capability owns the R1/R2/R3 promotion rules and the shared skill helper that keep dashboard session-card buttons and OpenSpec workflow skills in agreement about a change's next-ready artifact.

## Requirements

### Requirement: Local design evidence promotes the design artifact status

The dashboard SHALL post-process the per-change `artifacts` array returned
by the OpenSpec status call (`openspec status --all --json`, or `openspec status --change <name> --json` on the fallback path) so that the `design` artifact's
`status` is promoted from `"ready"` to `"done"` when local file-system
evidence indicates design work is satisfied. The override MUST NOT alter
any other artifact id, MUST NOT demote `"done"` to any other value, and
MUST NOT promote `"blocked"` directly to `"done"`. This override SHALL NOT apply to changes whose `schemaName` is `pi-spec-driven` (that schema declares a skipped design explicitly); every other schema keeps it. Where the status source carries no `schemaName` (the fallback `openspec list` path), `schemaName` SHALL be resolved locally: the change's `.openspec.yaml` `schema:` value, else the project config default (`config.yaml`, else `config.yml`), else `spec-driven` — the same resolution the CLI applies, so the dashboard and `effective-status.sh` agree on every path.

#### Scenario: design.md present satisfies design

- **WHEN** the change directory contains a file named `design.md`
- **THEN** `artifacts[design].status` SHALL be `"done"` whenever the CLI
  reports that artifact `ready` or `done` (a `blocked` verdict is never promoted).

#### Scenario: split design files satisfy design

- **WHEN** the change directory contains one or more files matching the
  regex `^design.*\.md$` (e.g. `design-rendering.md`, `design-state.md`,
  `design.draft.md`) AND no literal `design.md`
- **THEN** `artifacts[design].status` SHALL be promoted from `"ready"` to
  `"done"`.

#### Scenario: design directory satisfies design

- **WHEN** the change directory contains a `design/` subdirectory holding
  at least one `*.md` file AND no literal `design.md`
- **THEN** `artifacts[design].status` SHALL be promoted from `"ready"` to
  `"done"`.

#### Scenario: tasks with checkboxes satisfies design

- **WHEN** the change directory contains a `tasks.md` file whose contents
  include at least one Markdown checkbox line (matching
  `^\s*-\s+\[[ xX]\]\s`) AND none of the design-file rules apply
- **THEN** `artifacts[design].status` SHALL be promoted from `"ready"` to
  `"done"`.

#### Scenario: empty tasks.md does not satisfy design

- **WHEN** the change directory contains a `tasks.md` file with no
  checkbox lines AND no design files or directory
- **THEN** `artifacts[design].status` SHALL remain unchanged from the CLI
  verdict.

#### Scenario: blocked design artifact is never promoted

- **WHEN** the CLI reports `artifacts[design].status === "blocked"`
- **THEN** the override SHALL NOT promote it to `"done"` regardless of
  local evidence.

#### Scenario: only design artifact may be mutated

- **WHEN** the override evaluates a change
- **THEN** the `status` of every artifact other than `design` SHALL be
  passed through unchanged from the CLI verdict.

#### Scenario: workflow-schema change bypasses design evidence

- **GIVEN** a change with `schemaName: "pi-spec-driven"`, CLI `design: ready`, and a `tasks.md` with checkboxes
- **WHEN** the dashboard builds its data
- **THEN** `design` SHALL remain `ready`

### Requirement: Change-level isComplete agrees with overridden artifacts

After the design-artifact override is applied, the dashboard SHALL
re-derive the change-level `isComplete` flag so that it reflects the
post-override artifact statuses. The override MUST NOT demote a CLI
`isComplete: true` to false.

#### Scenario: all artifacts done after override

- **WHEN** every artifact in the post-override `artifacts` array has
  `status === "done"`
- **THEN** `isComplete` SHALL be `true`.

#### Scenario: at least one artifact not done after override

- **WHEN** any artifact in the post-override `artifacts` array has
  `status !== "done"`
- **THEN** `isComplete` SHALL be the value reported by the CLI (no
  promotion to true).

#### Scenario: CLI reports isComplete true

- **WHEN** the CLI returns `isComplete: true` for the change
- **THEN** the override SHALL NOT change that value to false under any
  circumstances.

### Requirement: Detection logic is shared between dashboard and skills

The system SHALL evaluate OpenSpec artifact status through a single shared module so that the dashboard's `buildOpenSpecData` post-processor and the OpenSpec workflow skills (`openspec-continue-change`, `openspec-ff-change`, `openspec-apply-change`, `openspec-verify-change`) cannot disagree about a change's next-ready artifact.

Both consumers SHALL skip the design evidence rules (R1/R2/R3) for changes whose `schemaName` is `pi-spec-driven`: the dashboard reads `schemaName` from the status-call entry, and `effective-status.sh` reads it from the `openspec status --change <name> --json` output before promoting. For every other schema, or an absent `schemaName`, both apply the rules as before.

#### Scenario: shared module is the single source of truth

- **WHEN** the dashboard obtains a change's status through the OpenSpec status call (`openspec status --all --json`)
- **AND** an OpenSpec skill probes the same change in the same instant
- **THEN** both consumers SHALL produce the same per-artifact `status`
  values for that change, having both invoked the shared
  `evaluateLocalDesignSatisfaction` helper.

#### Scenario: skills invoke the shared helper script

- **WHEN** any OpenSpec workflow skill needs to determine the next-ready
  artifact for a change
- **THEN** the skill SHALL invoke
  `.pi/skills/openspec-shared/scripts/effective-status.sh <change>`
  rather than calling `openspec status --change <change> --json`
  directly.

#### Scenario: repo-lint blocks raw status calls in OpenSpec skills

- **WHEN** an OpenSpec skill SKILL.md file under `.pi/skills/openspec-*`
  contains a literal invocation of `openspec status --json` outside a
  documentation example
- **THEN** the repository test suite SHALL fail with a citation of the
  offending file and line.

#### Scenario: workflow-schema change is never promoted by either consumer

- **GIVEN** a change with `schemaName: "pi-spec-driven"`, no `design.md`, and a `tasks.md` containing checkboxes
- **WHEN** the dashboard builds its data and `effective-status.sh <change>` runs
- **THEN** both SHALL report `design` with the CLI-reported status (not promoted to `done`)

#### Scenario: other custom schemas keep the evidence rules

- **GIVEN** a change with `schemaName: "team-flow"` whose schema has a `design` artifact, CLI `design: ready`, and a `tasks.md` with checkboxes
- **WHEN** either consumer evaluates it
- **THEN** `design` SHALL be promoted to `done` as before

### Requirement: Override is pure and probe-injectable

The override logic SHALL be a pure function of its inputs (the CLI's
parsed status output and a file-system probe interface). The probe
SHALL be injectable so that unit tests can exercise the full rule
matrix without filesystem mocking or temporary directories.

#### Scenario: production callers inject a real fs probe

- **WHEN** the production poll path builds data — the `openspec status --all` builder, or on the fallback path `deriveArtifactStatus` / `buildOpenSpecData`
- **THEN** they SHALL pass a probe whose methods read from the real
  filesystem rooted at `<cwd>/openspec/changes/<name>/`.

#### Scenario: tests inject an in-memory probe

- **WHEN** unit tests exercise `buildOpenSpecData` or
  `evaluateLocalDesignSatisfaction`
- **THEN** they SHALL pass an in-memory probe stub returning fixture
  values, without touching the filesystem.

#### Scenario: missing probe falls back to CLI verbatim

- **WHEN** `buildOpenSpecData` is called without an `fsProbe` argument
- **THEN** every artifact status and the change-level `isComplete` flag
  SHALL equal the CLI verdict, preserving today's behavior for any
  caller that has not yet been wired to inject a probe.
