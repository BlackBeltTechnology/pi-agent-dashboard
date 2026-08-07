## MODIFIED Requirements

### Requirement: Pi Resources button with updated icon

The Pi Resources action SHALL survive the removal of the folder action bar. It SHALL be
contributed to the folder actions menu's open group, alongside the OpenSpec archive and specs
items, with a label naming what it opens. Activating it SHALL open the `PiResourcesView` for
that directory (existing behavior, relocated). It SHALL NOT render as a button on the card.

#### Scenario: Open Pi Resources from the menu

- **WHEN** the user activates the Pi Resources item in the folder actions menu
- **THEN** the `PiResourcesView` for that directory SHALL open

#### Scenario: No Pi Resources button remains on the card

- **WHEN** an expanded folder card renders
- **THEN** no Pi Resources button SHALL render on the card

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

The recommended artifacts SHALL be classified as **required** (a directory is not a usable pi
project without them) or **optional** (they improve the project but it works without them),
from a single shared source of truth.

Surfacing SHALL follow the classification, not the raw tally, so a banner never claims a
directory is stuck when it is merely missing something optional:

- **a required artifact missing** — a `--severity-info-*` banner naming what is missing; when
  none are present at all the headline SHALL read that the directory is not a pi project yet.
- **only optional artifacts missing** — NO banner; the menu item alone conveys it.
- **all present** — NO banner.

In every case a project-setup item SHALL be present in the folder actions menu under the
directory group, carrying a stable label and the present/total tally, so the action is never
hidden.

When the init-status probe fails the response carries no tally; the card SHALL render NO setup
banner rather than inferring an empty tally and claiming the directory is not a pi project.

For a row reporting `{ hasHook: true }`, the hook-run behavior governs the *hook* affordance
(see "Initialize button gated on worktree-init status"). The project-setup item SHALL still be
present and SHALL still spawn the project-init session — the two are independent, and a
hook-bearing repo may still be missing recommended setup artifacts.

The project-setup glyph SHALL be distinct from the add-to-workspace glyph and SHALL NOT be a
folder-plus glyph.

#### Scenario: Unconfigured row shows the setup banner

- **WHEN** a row reports none of the recommended setup artifacts present
- **THEN** an info-severity banner SHALL render headlined "Not a pi project yet"
- **AND** activating its action SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Missing a required artifact shows an incomplete banner

- **GIVEN** a row that has `openspec/` but is missing a **required** artifact such as `AGENTS.md`
- **WHEN** the card renders
- **THEN** an info-severity banner SHALL render indicating setup is incomplete
- **AND** it SHALL show the present/total tally
- **AND** it SHALL name the missing artifacts

#### Scenario: Missing only an optional artifact shows no banner

- **GIVEN** a row holding every required artifact but missing an optional one such as `openspec/`
- **WHEN** the card renders
- **THEN** NO setup banner SHALL render
- **AND** the folder actions menu's project-setup item SHALL still show the present/total tally

#### Scenario: Probe failure renders no banner

- **WHEN** the init-status probe fails and returns no tally
- **THEN** no setup banner SHALL render
- **AND** the card SHALL NOT claim the directory is not a pi project

#### Scenario: Hook-bearing row still offers project setup

- **GIVEN** a row reporting `{ hasHook: true }` that is missing a required setup artifact
- **WHEN** the folder actions menu opens
- **THEN** the project-setup item SHALL be present and SHALL spawn the project-init session

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

Relocating it SHALL NOT drop the feedback detail the current control provides: the running and
failed states SHALL still expose elapsed time, SHALL still offer opt-in disclosure of the run
log, and a failure SHALL NOT auto-dismiss.

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

#### Scenario: Run feedback detail survives relocation

- **GIVEN** an init hook run in progress
- **WHEN** its banner renders
- **THEN** it SHALL show elapsed time
- **AND** SHALL offer opt-in disclosure of the run log
- **WHEN** that run fails
- **THEN** the failed banner SHALL persist until the user acts on it

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
