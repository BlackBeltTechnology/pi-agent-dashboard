## MODIFIED Requirements

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

### Requirement: Local design evidence promotes the design artifact status

The dashboard SHALL post-process the per-change `artifacts` array returned
by the OpenSpec status call (`openspec status --all --json`, or `openspec status --change <name> --json` on the fallback path) so that the `design` artifact's
`status` is promoted from `"ready"` to `"done"` when local file-system
evidence indicates design work is satisfied. The override MUST NOT alter
any other artifact id, MUST NOT demote `"done"` to any other value, and
MUST NOT promote `"blocked"` directly to `"done"`.

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
