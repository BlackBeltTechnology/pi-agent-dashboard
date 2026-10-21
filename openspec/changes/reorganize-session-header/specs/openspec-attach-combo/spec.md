## REMOVED Requirements

### Requirement: Mobile session header shows attached-proposal chip
**Reason**: Attach leaves the session header (see the `session-header` capability). The mobile header is one row with no second row for an attached-change chip.
**Migration**: The mobile session card keeps its attached-proposal chip (`mobile-card-attached-chip`), and the composer session actions keep the attach and detach surface. The testid `mobile-header-attached-chip` is retired.

## MODIFIED Requirements

### Requirement: PDST rendered as single button navigating to proposal
Wherever the session OpenSpec block shows the attached change's artifact letters, it SHALL render them as a single combined button (`ArtifactLettersButton`). The session header SHALL NOT render this button. Each letter keeps its status color. Clicking the button navigates to the proposal artifact. The session card SHALL NOT render this button; there the lifecycle bar carries per-artifact state and navigation.

#### Scenario: Single PDST button in attached session
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: blocked]`
- **THEN** the session OpenSpec block SHALL show a single clickable button containing `P D S T` with green, yellow, muted, muted colors respectively
- **AND** the session card SHALL NOT show that button
- **AND** the session header SHALL NOT show that button

#### Scenario: Clicking PDST button opens proposal
- **WHEN** the user clicks the PDST button for change `"add-auth"`
- **THEN** `onReadArtifact("add-auth", "proposal")` SHALL be called

### Requirement: Archived or missing attachment renders a traceable header
When the attachment resolves `kind: "archived"`, the desktop session card and the composer session actions SHALL render the following, for running and ended sessions alike:
- the paperclip and the attached name;
- an `Archived <YYYY-MM-DD>` badge, using the entry date;
- archive artifact letters for each artifact in `entry.artifacts`, in that order (as the archive browser renders them). Activating a letter SHALL navigate (push) to `/folder/<encoded resolved cwd>/openspec/archive/<entry.name>/<artifactId>`;
- a `⋯` menu containing only **Detach**. On the desktop session card, this `⋯` SHALL NOT render. Detach, and an item per archive letter with the same navigation, are offered in the session actions menu's OPENSPEC group instead. The badge and the letters stay on the card.

On mobile, the read-only attached-proposal chip on the session card SHALL show the name, the `Archived <YYYY-MM-DD>` badge, and the same archive letters. The mobile session header SHALL NOT render an attached-proposal chip. Detach SHALL remain available in the `MobileActionMenu`, which SHALL NOT offer workflow actions for an archived attachment.

No lifecycle bar, no primary action, and no workflow action (Continue, Fast-forward, Apply, Verify, Archive, Explore) SHALL render for an archived attachment.

When the attachment resolves `kind: "missing"`, those surfaces SHALL render the name, then a muted `Not found` badge titled "Not in active changes or archive (pull may be needed)". Desktop shows `⋯` with only **Detach** (on the desktop session card: Detach in the session actions menu); mobile keeps Detach in the `MobileActionMenu`.

When the attachment resolves `kind: "active"` but the resolved cwd differs from `session.cwd` (a removed worktree whose change is still active in `gitWorktree.mainPath`), the surfaces SHALL render read-only: the name, an `In main checkout` badge, the change's artifact letters linking to the preview route for the resolved cwd, and Detach (desktop `⋯`, or the session actions menu on the desktop session card; the mobile `MobileActionMenu`). No lifecycle bar, no primary action, and no workflow action SHALL render.

When the attachment resolves `kind: "unresolved"`, the surfaces SHALL render the bare attached name with no badge. Desktop shows `⋯` with only **Detach** (on the desktop session card: Detach in the session actions menu).

#### Scenario: Ended session attached to an archived change
- **WHEN** ended session `"s1"` has `attachedProposal = "add-auth"` and resolution yields entry `2026-09-30-add-auth` with proposal, design and tasks
- **THEN** the desktop session card SHALL show `add-auth`, `Archived 2026-09-30`, and letters P, D and T, with no OpenSpec `⋯`
- **AND** the session actions menu's OPENSPEC group SHALL contain items P, D and T and **Detach**, and no workflow item

#### Scenario: Running session after archiving
- **WHEN** running session `"s1"` is attached to `add-auth` and the change has just been archived
- **THEN** the card SHALL switch from the lifecycle UI to the archived header
- **AND** no Apply, Archive or Explore action SHALL render

#### Scenario: Letter opens the archived artifact
- **WHEN** the user activates the D letter on that archived header
- **THEN** the client SHALL navigate (push) to `/folder/<encoded cwd>/openspec/archive/2026-09-30-add-auth/design`
- **AND** the session card SHALL NOT become selected

#### Scenario: Removed worktree session links to the main checkout archive
- **WHEN** the session's cwd is a removed worktree and the archive was found under `gitWorktree.mainPath`
- **THEN** letter links SHALL use the encoded `mainPath`, not `session.cwd`

#### Scenario: Active in main checkout is read-only
- **WHEN** ended session `"s1"` has `cwd = "/repo/.worktrees/os-x"` and resolves `kind: "active"` with `cwd = "/repo"`
- **THEN** the card SHALL show `x`, the `In main checkout` badge and the change's artifact letters
- **AND** the session actions menu's OPENSPEC group SHALL offer only those letters and **Detach**
- **AND** no Apply, Continue or Archive action SHALL render

#### Scenario: Mobile chip stays read-only
- **WHEN** the viewport is mobile and the attachment resolves `archived`
- **THEN** the mobile session header SHALL render no attached-proposal chip
- **AND** `mobile-card-attached-chip` on the session card SHALL show the name, the `Archived` badge and the archive letters
- **AND** the card chip SHALL contain no Detach control
- **AND** the `MobileActionMenu` SHALL still offer Detach

#### Scenario: Detach still works on an archived attachment
- **WHEN** the user selects **Detach** on an archived attachment
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
