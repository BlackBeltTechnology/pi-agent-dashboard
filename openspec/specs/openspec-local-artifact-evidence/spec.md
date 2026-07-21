# openspec-local-artifact-evidence Specification

## Purpose

Reconcile the OpenSpec CLI/mtime-gated artifact status with filesystem reality for the `design` and `specs` artifacts of a change. The upstream `spec-driven` schema and the dashboard's mtime cache miss real workflows — design content split across multiple `design-*.md` files, trivial changes that need no design doc, and multi-spec changes whose `specs/**` deltas the cache momentarily stales on. This capability computes a boolean "satisfied locally?" from filesystem evidence and promotes the artifact to `done`. Promotion is one-directional: evidence can only fill a gap the CLI/cache left as `ready`; it never demotes or contradicts an artifact the CLI already reports.

## Requirements

### Requirement: Promote-only reconciliation

The system SHALL only promote an artifact's status upward from `ready` to `done` based on local evidence, and SHALL NOT demote, downgrade, or otherwise change any artifact the CLI already reports.

#### Scenario: CLI already satisfied

- **WHEN** the CLI reports the `design` or `specs` artifact as `done`
- **THEN** the local-evidence override is not evaluated for that artifact
- **AND** the artifact remains `done`

#### Scenario: Evidence fills a gap

- **WHEN** the CLI reports the `design` or `specs` artifact as `ready`
- **AND** the corresponding local evidence evaluates satisfied
- **THEN** that artifact's status is promoted to `done`

#### Scenario: Neither CLI nor evidence satisfies

- **WHEN** the CLI reports the artifact as `ready`
- **AND** the local evidence evaluates not satisfied
- **THEN** the artifact's status remains `ready`

#### Scenario: Override is scoped to its own artifact

- **WHEN** the design override or specs override fires for a change
- **THEN** only that one artifact (`design` or `specs` respectively) is promoted
- **AND** no other artifact in the change is modified

### Requirement: Design-artifact local evidence

The system SHALL treat the `design` artifact as satisfied locally when any one of three ordered, short-circuiting rules matches inside the change folder: (R1) a file matching `^design.*\.md$` exists, (R2) a `design/` subdirectory exists containing at least one `*.md` file, or (R3) `tasks.md` exists and contains at least one Markdown checkbox matching `^\s*-\s+\[[ xX]\]\s`.

#### Scenario: Split design files (R1)

- **WHEN** the change folder contains `design-rendering.md` and `design-state.md` but no single `design.md`
- **THEN** rule R1 matches because both names match `^design.*\.md$`
- **AND** the design evidence evaluates satisfied

#### Scenario: Design subdirectory (R2)

- **WHEN** the change folder has no `design*.md` file at its top level
- **AND** a `design/` subdirectory exists holding at least one `*.md` file
- **THEN** rule R2 matches
- **AND** the design evidence evaluates satisfied

#### Scenario: No-design change inferred from tasks (R3)

- **WHEN** the change has no `design*.md` file and no `design/` subdirectory with markdown
- **AND** `tasks.md` exists and contains at least one line like `- [ ]` or `- [x]`
- **THEN** rule R3 matches
- **AND** the design evidence evaluates satisfied

#### Scenario: Short-circuit ordering

- **WHEN** the design evidence is evaluated
- **THEN** rules are checked in order R1, then R2, then R3
- **AND** the first matching rule returns satisfied without evaluating later rules

#### Scenario: No design evidence present

- **WHEN** the change folder has no matching design file, no design subdirectory with markdown, and no `tasks.md` with a checkbox
- **THEN** the design evidence evaluates not satisfied

### Requirement: Specs-artifact local evidence

The system SHALL treat the `specs` artifact as satisfied locally when at least one `*.md` file exists anywhere under the change folder's `specs/` subtree, walking the subtree and short-circuiting on the first `*.md` file found.

#### Scenario: Multiple spec deltas present

- **WHEN** the change folder's `specs/` subtree contains one or more `*.md` delta files across nested capability directories
- **THEN** the specs evidence evaluates satisfied on the first `*.md` encountered

#### Scenario: Specs subtree empty or missing

- **WHEN** no `specs/` directory exists, or it contains no `*.md` file at any depth
- **THEN** the specs evidence evaluates not satisfied

### Requirement: Defensive filesystem probing

The system SHALL back local-evidence checks with synchronous filesystem probes that wrap every filesystem call in error handling and treat any error (missing directory, permission denial, symlink loop, or unexpected failure) as "no match". The specs probe SHALL walk its directory tree iteratively rather than recursively; the design probe methods read a single directory each (the change folder for R1/R3 and its `design/` subdirectory for R2) without tree walking.

#### Scenario: Unreadable path treated as no match

- **WHEN** a probe encounters a missing directory, a permission error, or any other filesystem error while checking evidence
- **THEN** the probe treats that path as producing no match rather than raising an error

#### Scenario: Iterative subtree walk

- **WHEN** the specs probe walks the `specs/` subtree
- **THEN** it traverses depth-first using an explicit stack rather than recursion, avoiding stack overflow on deeply nested or pathological trees

### Requirement: Injectable probe surfaces

The system SHALL expose the evidence rule evaluation independently of the filesystem via small probe interfaces, so callers can supply either a real-filesystem probe or an in-memory stub. The real-filesystem probe factories are parameterless: they take no working directory or change path. Each probe method instead receives the change directory as a per-call argument, and the caller (`buildOpenSpecData`/`openspec-poller`) is responsible for constructing the `<cwd>/openspec/changes/<name>` path it passes in.

#### Scenario: Parameterless production probe factory

- **WHEN** a real-filesystem probe factory is built
- **THEN** it is constructed with no arguments (no `cwd`, no change path)
- **AND** each of its methods resolves evidence against the change directory supplied to that method call

#### Scenario: Caller constructs the change directory path

- **WHEN** the poller evaluates a change's local evidence
- **THEN** the caller constructs `<cwd>/openspec/changes/<changeName>` and passes it as the per-call `changeDir` argument
- **AND** the probe factories themselves perform no path construction from a working directory

#### Scenario: Stub probe for testing

- **WHEN** an in-memory probe is supplied to the rule evaluator
- **THEN** the evaluator computes satisfaction purely from the probe's boolean answers without touching the filesystem
