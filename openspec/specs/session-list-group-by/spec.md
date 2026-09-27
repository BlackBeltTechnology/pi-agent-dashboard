# session-list-group-by Specification

## Purpose
Let the user arrange a folder group's session cards into lanes — by runtime status or by checkout location — chosen per folder with a global default, so the sidebar stays navigable when many sessions share one folder.

## Requirements

### Requirement: Group-by modes
The system SHALL support three grouping modes for the session cards inside a folder group: `none`, `status`, and `location`. Mode `none` SHALL render exactly today's behaviour (a single alive list followed by the collapsed ended bucket). Modes `status` and `location` SHALL split the folder's non-ended sessions into lanes. Ended sessions SHALL remain in the folder's existing ended bucket in every mode and SHALL NOT be assigned to a lane.

#### Scenario: None mode is unchanged
- **WHEN** a folder's effective mode is `none`
- **THEN** its sessions SHALL render as a single alive list followed by the ended bucket, identical to the behaviour before this change

#### Scenario: Ended sessions stay in the ended bucket
- **WHEN** a folder's effective mode is `status` or `location` and the folder has ended sessions
- **THEN** the ended sessions SHALL render only in the folder's ended bucket, below all lanes

### Requirement: Effective mode resolution
A folder's effective mode SHALL be resolved as: the folder's explicit per-folder mode if set; otherwise the global default mode; otherwise `none`. Folder identity SHALL use the same canonical folder key used for folder collapse state, so different spellings of the same path resolve to the same mode.

#### Scenario: Per-folder override wins
- **WHEN** the global default is `status` and folder `/repo` has an explicit mode `location`
- **THEN** `/repo` SHALL render in `location` mode

#### Scenario: Folder without override follows the default
- **WHEN** the global default is `status` and folder `/other` has no explicit mode
- **THEN** `/other` SHALL render in `status` mode

#### Scenario: Default changes propagate to non-overridden folders
- **WHEN** the global default changes from `status` to `none`
- **THEN** every folder without an explicit mode SHALL re-render in `none` mode
- **AND** folders with an explicit mode SHALL be unaffected

#### Scenario: No preferences at all
- **WHEN** neither a global default nor any per-folder mode is stored
- **THEN** every folder SHALL render in `none` mode

### Requirement: Group-by control in the folder actions menu
The folder actions menu SHALL offer a "Group by" choice presenting `None`, `Status`, `Location`, and `Use default`. The currently effective choice SHALL be indicated as selected; when the folder follows the default, `Use default` SHALL be the selected item and SHALL name the current default mode. Selecting `None`, `Status`, or `Location` SHALL set the folder's explicit mode; selecting `Use default` SHALL remove the folder's explicit mode. The choices SHALL be keyboard-operable and expose their selected state to assistive technology.

#### Scenario: Set a folder's mode
- **WHEN** the user opens `/repo`'s folder actions menu and selects `Status`
- **THEN** `/repo` SHALL render in `status` mode and its explicit mode SHALL be persisted

#### Scenario: Revert to default
- **WHEN** `/repo` has an explicit mode and the user selects `Use default`
- **THEN** the explicit mode SHALL be removed and `/repo` SHALL render in the global default mode

#### Scenario: Use default names the default
- **WHEN** the global default is `status` and `/repo` has no explicit mode
- **THEN** the menu SHALL show `Use default (Status)` as the selected item

### Requirement: Folder header shows the active grouping
When a folder's effective mode is not `none`, the folder header SHALL show a compact grouping indicator naming the mode, placed on the header's secondary (path) row so it does not truncate the folder name. When the mode is inherited from the global default, the indicator SHALL say so (e.g. "Status · default"). Activating the indicator SHALL open the folder actions menu. The indicator SHALL remain visible when the folder is collapsed and when only one lane is non-empty.

#### Scenario: Inherited mode indicator
- **WHEN** the global default is `status` and `/repo` has no explicit mode
- **THEN** `/repo`'s header SHALL show "Status · default"

#### Scenario: No indicator in None mode
- **WHEN** `/repo`'s effective mode is `none`
- **THEN** no grouping indicator SHALL render

#### Scenario: Indicator opens the menu
- **WHEN** the user activates the grouping indicator
- **THEN** the folder actions menu SHALL open with the Group by choices focused on the current selection

### Requirement: Global default grouping setting
The settings UI SHALL offer a "Default grouping" setting with values `None`, `Status`, `Location`, defaulting to `None`. Changing it SHALL apply immediately to every folder without an explicit mode, in every connected browser.

#### Scenario: Change the global default
- **WHEN** the user sets Default grouping to `Location`
- **THEN** every folder without an explicit mode SHALL render in `location` mode in all connected browsers

### Requirement: Status lane assignment
In `status` mode each non-ended session SHALL be assigned to exactly one lane, using the same status classification that drives the session card's status shape and the folder status capsule, evaluated in this order (first match wins):
1. `error` — the session's last run failed with an error.
2. `needs-you` — the session is blocked on a chat-routed `ask_user`.
3. `working` — the session is streaming, compacting, retrying, or resuming.
4. `review` — the session is unread, or carries a non-error notice.
5. `idle` — every other non-ended session.

Lanes SHALL render in the order `needs-you`, `error`, `working`, `review`, `idle` (matching the folder status capsule's segment order), with the labels "Needs you", "Failed", "Working", "To review", "Idle". Each lane header SHALL show a glyph using the same shape as the corresponding card status shape, so lane identity is not conveyed by color alone; lane label text SHALL NOT be rendered in the status color.

#### Scenario: Blocked streaming session goes to Needs you
- **WHEN** a session is streaming and currently waiting on a chat-routed `ask_user`
- **THEN** it SHALL render in the `needs-you` lane only

#### Scenario: Finished unread session goes to To review
- **WHEN** a session stops streaming and is unread
- **THEN** it SHALL render in the `review` lane

#### Scenario: Failed session goes to Failed
- **WHEN** a session's run ends with an error
- **THEN** it SHALL render in the `error` lane, labelled "Failed", between "Needs you" and "Working"

#### Scenario: Viewing clears review
- **WHEN** the user views a session in the `review` lane and it becomes read
- **THEN** it SHALL move to the `idle` lane

### Requirement: Location lane assignment
In `location` mode each non-ended session SHALL be assigned to lane `main` when it does not run in a git worktree, and to lane `worktrees` when it runs in a git worktree. Lane `main` SHALL render first, labelled "Main checkout" followed by the folder's current branch when known; lane `worktrees` SHALL be labelled "Worktrees". Worktree session cards SHALL continue to show their branch.

#### Scenario: Mixed folder
- **WHEN** folder `/repo` in `location` mode has two main-checkout sessions on `develop` and one session in worktree `os/feat-x`
- **THEN** a "Main checkout · develop" lane SHALL list the two sessions
- **AND** a "Worktrees" lane below it SHALL list the worktree session

### Requirement: Lane rendering
A lane with zero sessions SHALL NOT render. When only one lane is non-empty, no lane header SHALL render and the folder SHALL look as it does in `none` mode. Each rendered lane header SHALL show the lane label and the lane's session count, and SHALL be a keyboard-operable collapse control exposing its expanded state to assistive technology. A collapsed lane SHALL hide its cards. A collapsed `location` lane SHALL show a status rollup of its hidden sessions; a collapsed `status` lane SHALL show only its count (its sessions share one status).

#### Scenario: Empty lanes hidden
- **WHEN** a folder in `status` mode has no session in `needs-you`
- **THEN** no "Needs you" header SHALL render

#### Scenario: Single non-empty lane shows no headers
- **WHEN** every non-ended session of a folder in `location` mode is in the main checkout
- **THEN** no lane header SHALL render and the cards SHALL render as a plain list

#### Scenario: Collapse a lane
- **WHEN** the user activates the "Idle" lane header
- **THEN** the idle cards SHALL be hidden, the header SHALL show the count, and the collapsed state SHALL be persisted

#### Scenario: Collapsed location lane shows a rollup
- **WHEN** the user collapses the "Worktrees" lane containing one working and one needs-you session
- **THEN** its header SHALL show the count and a status rollup with one working and one needs-you entry

### Requirement: Lane ordering and drag-reorder
Within each lane, sessions SHALL be ordered by the folder's stored session order, preserving relative position, with sessions absent from the stored order appended by start time descending. A server move-to-front SHALL place the session at the top of its own lane. Drag-reorder SHALL be permitted within a lane and SHALL persist through the existing session-order mechanism. A drop into a different lane SHALL be rejected and the card SHALL return to its original position. While a card is dragged over a different lane, that lane SHALL indicate the drop is not allowed, and releasing there SHALL show a short message explaining that lanes are determined by status (or location) and that reordering is possible within a lane.

#### Scenario: Move to front lands at top of own lane
- **WHEN** a session in the `idle` lane is resumed and moved to the front of the stored order
- **THEN** it SHALL render at the top of whichever lane it now belongs to

#### Scenario: Reorder within a lane
- **WHEN** the user drags session B above session A inside the "Working" lane
- **THEN** B SHALL render above A and the new order SHALL persist

#### Scenario: Cross-lane drop rejected
- **WHEN** the user drags a card from the "Idle" lane and drops it inside the "Working" lane
- **THEN** the card SHALL return to the "Idle" lane at its original position
- **AND** the stored session order SHALL NOT change
- **AND** a message SHALL explain that lanes follow session status and cards can be reordered within a lane

#### Scenario: Drag-to-resume from the ended bucket still works
- **WHEN** the user drags an ended session from the ended bucket and drops it into any lane
- **THEN** the drop SHALL behave as drag-to-resume (keep-position placement), and the resumed session SHALL render in whichever lane its new status assigns

### Requirement: Status lane stability
To keep cards from moving out from under the pointer, a session leaving the `working` lane for `review` or `idle` SHALL remain displayed in `working` for a short hold period (≈3 seconds); if it re-enters `working` within that period it SHALL NOT move at all. During the hold period the card SHALL already show its new status and SHALL show a countdown indicator in the destination lane's color. A transition into `needs-you` or `error` SHALL take effect immediately. When the selected session changes lane, it SHALL be kept scrolled into view and the change SHALL be announced to assistive technology (e.g. "<session> moved to To review"). Lane changes SHALL animate the card's movement, except when the user prefers reduced motion, in which case the change SHALL be instant.

#### Scenario: Brief idle between turns does not move the card
- **WHEN** a session stops streaming and starts streaming again within the hold period
- **THEN** the card SHALL stay in the "Working" lane without moving

#### Scenario: Hold is visible
- **WHEN** a session in "Working" becomes unread and is within the hold period
- **THEN** its card SHALL show the unread status and a countdown indicator in the "To review" lane color while remaining in "Working"

#### Scenario: Lane change announced
- **WHEN** the selected session moves from "Working" to "To review"
- **THEN** a polite live-region announcement SHALL name the session and its new lane

#### Scenario: Needs you is immediate
- **WHEN** a working session starts waiting on a chat-routed `ask_user`
- **THEN** it SHALL move to the "Needs you" lane without waiting for the hold period

#### Scenario: Selected card stays visible
- **WHEN** the selected session moves from "Working" to "To review"
- **THEN** the sidebar SHALL keep that card scrolled into view

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion and a session changes lane
- **THEN** the card SHALL move without animation

### Requirement: Selected or revealed session in a collapsed lane
When a seek/reveal action targets a session inside a collapsed lane, the lane SHALL expand. When the selected session moves into a collapsed lane through a background status change, the lane SHALL NOT auto-expand, and the lane header SHALL indicate that it contains the selected session.

#### Scenario: Reveal expands the lane
- **WHEN** the user seeks to a session whose lane is collapsed
- **THEN** the lane SHALL expand and the card SHALL be scrolled into view

#### Scenario: Background move into collapsed lane
- **WHEN** the selected session moves into the collapsed "Idle" lane due to a status change
- **THEN** the "Idle" lane SHALL stay collapsed and its header SHALL show a selected indicator

### Requirement: Lanes flatten under search and filters
While a session search query or a tag/phase filter is active, lanes SHALL NOT render and the folder SHALL use its existing search/filter rendering.

#### Scenario: Search flattens lanes
- **WHEN** a folder is in `status` mode and the user types a session search query
- **THEN** matching sessions SHALL render without lane headers
- **AND** clearing the query SHALL restore the lanes

### Requirement: Grouping state shared across browsers
Per-folder modes, the global default, and lane collapse state SHALL be stored server-side, SHALL be delivered to a connecting browser before the first render of folder groups, and SHALL be broadcast to every connected browser on change.

#### Scenario: Shared across devices
- **WHEN** the user sets `/repo` to `status` on a desktop browser
- **THEN** an already open phone browser SHALL render `/repo` in `status` mode without reload

#### Scenario: No flat-then-lanes flash
- **WHEN** a browser loads the dashboard and `/repo`'s effective mode is `status`
- **THEN** `/repo` SHALL render with lanes on its first paint, never first as a flat list

### Requirement: Urgency sort toggle retired
The per-folder "Float blocked sessions to top" toggle SHALL be removed; `status` mode's "Needs you" lane supersedes it. On first load after upgrade, each folder that had the toggle enabled in that browser and has no explicit mode SHALL be given the explicit mode `status`, once; the legacy browser-local setting SHALL then be cleared.

#### Scenario: Legacy toggle migrates to Status
- **WHEN** a browser has the legacy toggle enabled for `/repo` and `/repo` has no explicit mode
- **THEN** `/repo`'s explicit mode SHALL be set to `status` and the legacy setting SHALL be cleared

#### Scenario: Existing explicit mode is not overwritten
- **WHEN** a browser has the legacy toggle enabled for `/repo` and `/repo` already has explicit mode `location`
- **THEN** `/repo` SHALL keep `location` and the legacy setting SHALL be cleared
