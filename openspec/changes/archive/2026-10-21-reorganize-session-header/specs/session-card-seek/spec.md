## MODIFIED Requirements

### Requirement: Seek control reveals the active session's card

The `SessionHeader` SHALL present an icon-only "Reveal in sidebar" button for an open session, next to the session title. The button SHALL use the `mdiDockLeft` icon, carry `aria-label` and `title` "Reveal in sidebar", and keep `data-testid="session-header-seek-card"`. The title menu SHALL also offer a "Reveal in sidebar" item. Both entry points SHALL trigger the same reveal.
The session header renders above the ChatView body (ChatView itself has no
header). Activating either entry point SHALL reveal that session's card in the sidebar
`SessionList` by expanding every collapsed fold-ancestor, selecting the card,
scrolling it to center, and applying a transient flash highlight.

The reveal SHALL be triggerable repeatedly for the same session (each activation
re-fires, even when the session is already selected).

The Reveal in sidebar control SHALL be presented on desktop only. When the viewport is in the
mobile layout (the sidebar is a separate overlay), the control SHALL NOT be
rendered.

#### Scenario: Seek control is hidden in the mobile layout

- **WHEN** an open session is rendered in the mobile layout
- **THEN** no Reveal in sidebar control SHALL appear in the session header

#### Scenario: Reveal a card buried under a collapsed workspace, folder, and ended group

- **WHEN** the active session is `ended`, lives in a folder whose workspace tier
  is collapsed, whose folder group is collapsed, and whose ended sub-group is
  collapsed
- **AND** the user activates the Reveal in sidebar control in the session header
- **THEN** the workspace tier SHALL expand
- **AND** the folder group SHALL expand
- **AND** the ended sub-group SHALL expand
- **AND** the session's card SHALL be selected, scrolled into view, and flashed

#### Scenario: Re-seeking an already-selected session re-fires the reveal

- **WHEN** the active session's card is already selected but has since been
  re-collapsed under a fold-ancestor
- **AND** the user activates the Reveal in sidebar control again
- **THEN** the fold-ancestors SHALL expand and the card SHALL scroll into view
  again

### Requirement: Ancestor chain resolves from session identity alone

The reveal SHALL resolve a card's fold-ancestors without a graph walk, using
only the session's `cwd`, its worktree main path when it has one, and its
`status`. Each expand SHALL leave an already-open container open, so a repeat
seek cannot re-collapse an ancestor:

- Workspace ancestor SHALL be `folderWorkspaceMap.get(session.cwd)`; when that
  workspace is collapsed it SHALL be expanded via
  `onSetWorkspaceCollapsed(workspaceId, false)` (idempotent when already open).
- Folder ancestor SHALL be the session's **resolved group path** — the path the
  folder group actually renders under, which for a worktree session is its
  worktree main path rather than its own `cwd`. When collapsed it SHALL be
  expanded via an add-only expand (never a toggle), so that a second seek
  arriving before the first has been acknowledged cannot close it.
- Ended ancestor SHALL apply when `session.status === "ended"`; the cwd SHALL be
  added to the ended-expanded set via an add-only operation (never a toggle), so
  a repeat seek keeps it open.

#### Scenario: Repeat seek does not re-collapse an already-open ancestor

- **WHEN** the active session's fold-ancestors are already expanded
- **AND** the user activates the Reveal in sidebar control
- **THEN** no ancestor SHALL become collapsed as a result

#### Scenario: Repeat seek before the expand is acknowledged

- **WHEN** the user activates the Reveal in sidebar control twice in quick succession on a
  collapsed folder ancestor, the second time before the first expand has been
  acknowledged
- **THEN** the folder SHALL end up expanded and SHALL NOT be re-collapsed by the
  second activation

#### Scenario: Worktree session reveals under its rendered group

- **WHEN** the active session lives in a git worktree and its folder group is
  rendered under the worktree main path
- **THEN** the reveal SHALL expand that rendered group

#### Scenario: Non-ended session skips the ended-group expansion

- **WHEN** the active session's status is not `ended`
- **THEN** the reveal SHALL NOT add its cwd to the ended-expanded set

### Requirement: Hidden and filtered cards degrade without global mutation

The reveal SHALL NOT silently mutate all-or-nothing view state. The target SHALL
be classified up front from the session list and filter predicates. When the
target session is hidden and the show-hidden toggle is off, OR the target session
is excluded by any active filter (tag, phase, text search, or the folder-path
filter), the reveal SHALL NOT expand ancestors, SHALL NOT flip the show-hidden
toggle, and SHALL NOT clear filters. Instead it SHALL surface an informational
toast explaining why the card is not shown. The toast SHALL be informational only
(the shared toast surface is display-only).

#### Scenario: Seeking a hidden session does not flip the show-hidden toggle

- **WHEN** the active session is hidden and the show-hidden toggle is off
- **AND** the user activates the Reveal in sidebar control
- **THEN** the show-hidden toggle SHALL remain off
- **AND** an informational toast SHALL indicate the session is hidden

#### Scenario: Seeking a filtered-out session reports the active filter

- **WHEN** the active session is excluded from the list by any active filter
  (tag, phase, text search, or folder-path filter)
- **AND** the user activates the Reveal in sidebar control
- **THEN** the active filter SHALL remain unchanged
- **AND** an informational toast SHALL indicate a filter is hiding the card
