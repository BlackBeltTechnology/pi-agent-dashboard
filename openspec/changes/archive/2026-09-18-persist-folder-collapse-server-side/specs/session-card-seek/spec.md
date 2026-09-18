## MODIFIED Requirements

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
- **AND** the user activates the Seek control
- **THEN** no ancestor SHALL become collapsed as a result

#### Scenario: Repeat seek before the expand is acknowledged

- **WHEN** the user activates the Seek control twice in quick succession on a
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

### Requirement: Scroll waits for the card to enter the DOM

The reveal fires while ancestors are still opening: workspaces expand
asynchronously (server echo) and collapsed folders animate open. The reveal
SHALL wait for the target card to be **laid out** before scrolling, where
laid-out means the element, queried scoped to the `SessionList` container (NOT
`document`, since `[data-session-id]` is emitted elsewhere), exists AND has a
non-zero `getBoundingClientRect().height`. It SHALL NOT use `offsetParent !==
null` as the presence test, because a collapsed folder renders its rows with
`grid-template-rows: 0fr` (not `display:none`), leaving `offsetParent` non-null
on a zero-height card.

The wait SHALL be driven by the ancestor-state updates landing — **both** the
workspace echo and the folder-collapse echo, since folder expansion is now also
an asynchronous server round-trip rather than local state — not by a fixed
animation-frame count, so it completes as soon as those round-trips resolve
regardless of connection latency. A fixed give-up backstop timeout SHALL bound
the failure case only (an echo never arriving); it SHALL NOT gate the normal
path. Any pending frame/timer callback SHALL be cancelled on unmount or when a
new reveal request supersedes it. If the card never becomes laid out before the
backstop elapses, the reveal SHALL surface a toast carrying a Retry action that
re-fires the seek.

#### Scenario: Scroll fires after the async workspace expansion lands

- **WHEN** the reveal expands a collapsed workspace whose state round-trips to
  the server
- **THEN** the scroll SHALL fire once the resulting update lands, without
  waiting for the backstop timeout

#### Scenario: Scroll fires after the async folder expansion lands

- **WHEN** the reveal expands a collapsed folder whose state round-trips to the
  server
- **THEN** the scroll SHALL fire once the resulting update lands, without
  waiting for the backstop timeout

#### Scenario: Reveal that never lands surfaces a Retry toast, not silence

- **WHEN** the reveal's backstop timeout elapses before the card is laid out
- **THEN** the reveal SHALL surface a toast carrying a Retry action
- **AND** that toast SHALL NOT auto-dismiss before the user can act on it
- **AND** SHALL leave no pending frame or timer callback

#### Scenario: Retry on the timeout toast re-fires the reveal

- **WHEN** the reveal-timeout toast is shown
- **AND** the user activates its Retry action
- **THEN** a new reveal SHALL be dispatched for the same session
