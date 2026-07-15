## ADDED Requirements

### Requirement: Seek control reveals the active session's card

The `SessionHeader` SHALL present a "Seek to card" control for an open session.
The session header renders above the ChatView body (ChatView itself has no
header). Activating the control SHALL reveal that session's card in the sidebar
`SessionList` by expanding every collapsed fold-ancestor, selecting the card,
scrolling it to center, and applying a transient flash highlight.

The reveal SHALL be triggerable repeatedly for the same session (each activation
re-fires, even when the session is already selected).

The Seek control SHALL be presented on desktop only. When the viewport is in the
mobile layout (the sidebar is a separate overlay), the control SHALL NOT be
rendered.

#### Scenario: Seek control is hidden in the mobile layout

- **WHEN** an open session is rendered in the mobile layout
- **THEN** no Seek control SHALL appear in the session header

#### Scenario: Reveal a card buried under a collapsed workspace, folder, and ended group

- **WHEN** the active session is `ended`, lives in a folder whose workspace tier
  is collapsed, whose folder group is collapsed, and whose ended sub-group is
  collapsed
- **AND** the user activates the Seek control in the session header
- **THEN** the workspace tier SHALL expand
- **AND** the folder group SHALL expand
- **AND** the ended sub-group SHALL expand
- **AND** the session's card SHALL be selected, scrolled into view, and flashed

#### Scenario: Re-seeking an already-selected session re-fires the reveal

- **WHEN** the active session's card is already selected but has since been
  re-collapsed under a fold-ancestor
- **AND** the user activates the Seek control again
- **THEN** the fold-ancestors SHALL expand and the card SHALL scroll into view
  again

### Requirement: Ancestor chain resolves from session identity alone

The reveal SHALL resolve a card's fold-ancestors without a graph walk, using
only the session's `cwd` and `status`. Each expand SHALL be guarded on the
container being currently collapsed (the folder and ended mutators are
toggle/add-shaped; an unguarded call would re-collapse an already-open container
on a repeat seek):

- Workspace ancestor SHALL be `folderWorkspaceMap.get(session.cwd)`; when that
  workspace is collapsed it SHALL be expanded via
  `onSetWorkspaceCollapsed(workspaceId, false)` (idempotent when already open).
- Folder ancestor SHALL be `session.cwd`; when collapsed it SHALL be expanded via
  the collapsed-groups mutator (`dashboard:collapsedGroups`), which SHALL be
  invoked only when the folder is collapsed (it is a toggle).
- Ended ancestor SHALL apply when `session.status === "ended"`; the cwd SHALL be
  added to the ended-expanded set via an add-only operation (never a toggle), so
  a repeat seek keeps it open.

#### Scenario: Repeat seek does not re-collapse an already-open ancestor

- **WHEN** the active session's fold-ancestors are already expanded
- **AND** the user activates the Seek control
- **THEN** no ancestor SHALL become collapsed as a result

#### Scenario: Non-ended session skips the ended-group expansion

- **WHEN** the active session's `status` is not `ended`
- **AND** the user activates the Seek control
- **THEN** the workspace and folder ancestors SHALL expand
- **AND** no ended sub-group expansion SHALL be performed

### Requirement: Scroll waits for the card to enter the DOM

The reveal SHALL NOT scroll on a single animation frame, because the
workspace-tier collapse state is asynchronous server state (`workspaces_updated`
echo) and collapsed folders animate open. The reveal SHALL wait for the target
card to be **laid out** before scrolling, where laid-out means the element,
queried scoped to the `SessionList` container (NOT `document`, since
`[data-session-id]` is emitted elsewhere), exists AND has a non-zero
`getBoundingClientRect().height`. It SHALL NOT use `offsetParent !== null` as the
presence test, because a collapsed folder renders its rows with
`grid-template-rows: 0fr` (not `display:none`), leaving `offsetParent` non-null
on a zero-height card.

The wait SHALL be driven by the `workspaces` prop update (the echo landing), not
by a fixed animation-frame count, so it completes as soon as the workspace
round-trip resolves regardless of connection latency. A fixed give-up backstop
timeout SHALL bound the failure case only (the echo never arriving); it SHALL
NOT gate the normal path. Any pending frame/timer callback SHALL be cancelled on
unmount or when a new reveal request supersedes it. If the card never becomes
laid out before the backstop elapses, the reveal SHALL surface a toast carrying
a Retry action that re-fires the seek.

#### Scenario: Scroll fires after the async workspace expansion lands

- **WHEN** the reveal expands a collapsed workspace whose state round-trips to
  the server
- **AND** the card is not yet laid out when the reveal first checks
- **THEN** the reveal SHALL re-check when the workspace expansion lands
- **AND** SHALL scroll and flash the card once it is laid out

#### Scenario: Reveal that never lands surfaces a Retry toast, not silence

- **WHEN** the reveal's backstop timeout elapses before the card is laid out
- **THEN** the reveal SHALL surface a toast carrying a Retry action
- **AND** that toast SHALL NOT auto-dismiss before the user can act on it
- **AND** SHALL leave no pending frame or timer callback

#### Scenario: Retry on the timeout toast re-fires the reveal

- **WHEN** the reveal-timeout toast is shown
- **AND** the user activates its Retry action
- **THEN** a new reveal SHALL be dispatched for the same session

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
- **AND** the user activates the Seek control
- **THEN** the show-hidden toggle SHALL remain off
- **AND** an informational toast SHALL indicate the session is hidden

#### Scenario: Seeking a filtered-out session reports the active filter

- **WHEN** the active session is excluded from the list by any active filter
  (tag, phase, text search, or folder-path filter)
- **AND** the user activates the Seek control
- **THEN** the active filter SHALL remain unchanged
- **AND** an informational toast SHALL indicate a filter is hiding the card
