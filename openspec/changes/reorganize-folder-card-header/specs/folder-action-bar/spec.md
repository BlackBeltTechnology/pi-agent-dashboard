## MODIFIED Requirements

### Requirement: Folder action bar layout

Each folder group in the sidebar SHALL render its git info (`GroupGitInfo`) on a facts-only
row that contains NO action controls. The `FolderActionBar` container SHALL NOT render: the
Initialize control, the Set up project control, `Clean up broken (N)`, Directory Settings,
`Terminals(N)`, an `Editor` button, a native-editor (e.g. `Zed`) button, a `+Session` button,
or a `+Worktree` button.

Directory Settings SHALL move into the folder actions menu. The Initialize, Set up project
and `Clean up broken (N)` controls SHALL move into the directory call-to-action banner. The
internal folder editor pane at `/folder/:encodedCwd/editor` remains reachable from the
Directory home page and ChatView; spawn buttons live in the elevated spawn-button stack.

Because no control remains, the action-bar container itself SHALL be removed rather than
rendered empty.

#### Scenario: Git row omits every action control

- **WHEN** a folder group header is rendered expanded for a git repository
- **THEN** the git row SHALL NOT contain a `Terminals(N)` button
- **THEN** the git row SHALL NOT contain an `Editor` button
- **THEN** the git row SHALL NOT contain a `Zed` (or any native-editor) button
- **THEN** the git row SHALL NOT contain a `+Session` button
- **THEN** the git row SHALL NOT contain a `+Worktree` button
- **THEN** the git row SHALL NOT contain a Directory Settings gear
- **THEN** the git row SHALL NOT contain an Initialize, Set up project, or Clean up broken control

#### Scenario: Git facts stand alone on their row

- **WHEN** a folder group header is rendered expanded
- **THEN** the git info SHALL be the only content of that row
- **AND** a wide init state SHALL NOT wrap into or overflow that row, because init state renders as a banner

### Requirement: Initialize button routes unconfigured directories to project-init

Project setup SHALL be idempotent and permanently available: it MAY be invoked on a
directory that is already a configured pi project, so that a directory holding only part of
the recommended layout (for example `openspec/` but no `AGENTS.md`, or an `AGENTS.md`
predating the recommended layout) can be brought up to date. Invoking it SHALL spawn an
interactive project-init session in that directory (cwd = the row's path), reusing the
existing spawn-session machinery with the project-init skill pre-injected.

Worktree-init status SHALL report the presence of each recommended setup artifact rather
than a single `configured` boolean, so partial setup is representable.

Surfacing SHALL follow the artifact tally:

- **none present** — a `--severity-info-*` banner headlined "Not a pi project yet".
- **some present, some missing** — a `--severity-info-*` banner headlined "Setup incomplete"
  carrying the present/total tally and naming the missing artifacts.
- **all present** — NO banner.

In all three cases a project-setup item SHALL be present in the folder actions menu under
the directory group, carrying a stable label and the present/total tally, so the action is
never hidden.

For a row reporting `{ hasHook: true }`, the hook-run behavior applies (governed by
"Initialize button gated on worktree-init status"), NOT the project-init scaffold.

The project-setup glyph SHALL be distinct from the add-to-workspace glyph and SHALL NOT be a
folder-plus glyph.

#### Scenario: Unconfigured row shows the setup banner

- **WHEN** a row reports none of the recommended setup artifacts present
- **THEN** an info-severity banner SHALL render headlined "Not a pi project yet"
- **AND** activating its action SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Partially configured row shows an incomplete banner

- **GIVEN** a row that has `openspec/` but no `AGENTS.md`
- **WHEN** the card renders
- **THEN** an info-severity banner SHALL render headlined "Setup incomplete"
- **AND** it SHALL show the present/total tally
- **AND** it SHALL name the missing artifacts

#### Scenario: Fully configured row stays silent but actionable

- **WHEN** a row reports every recommended setup artifact present
- **THEN** no setup banner SHALL render
- **AND** the folder actions menu SHALL still offer the project-setup item
- **AND** activating it SHALL spawn an interactive project-init session

#### Scenario: Hook-present row is unaffected

- **WHEN** a row's worktree-init-status is `{ hasHook: true }`
- **THEN** the initialize control SHALL follow the hook-run behavior (not the project-init scaffold)

#### Scenario: Project-init session is first-class

- **WHEN** the project-init session is spawned from the setup affordance
- **THEN** it SHALL appear as a normal dashboard session (visible transcript, abortable)
- **AND** SHALL NOT be a detached process

### Requirement: Initialize button gated on worktree-init status

The run-init-hook affordance SHALL render as a directory call-to-action banner, gated on the
worktree-init status probe, and SHALL NOT render as a button inside the git-facts row.

When the hook's definition hash no longer matches the trusted hash for the checkout — so the
hook may not execute until the user re-confirms — a `--severity-warning-*` banner SHALL
render inviting the user to review the hook before running it.

Any indication that the recommended setup templates have advanced beyond what a fully
configured directory holds SHALL NOT render as a banner. It SHALL render as an update marker
on the project-setup item in the folder actions menu.

#### Scenario: Hook available and not yet run

- **GIVEN** a row whose status reports a declared hook that still needs running
- **WHEN** the card renders
- **THEN** a warning-severity banner SHALL offer to run it

#### Scenario: Hook definition changed since it was trusted

- **GIVEN** a row whose declared hook's definition hash differs from the trusted hash for that checkout
- **WHEN** the card renders
- **THEN** a warning-severity banner SHALL render inviting the user to review the hook
- **AND** the hook SHALL NOT run until the user re-confirms

#### Scenario: Available template update is not a banner

- **GIVEN** a fully configured row whose recommended setup templates have since advanced
- **WHEN** the card renders
- **THEN** no banner SHALL render for that update
- **AND** the project-setup item in the folder actions menu SHALL carry an update marker
