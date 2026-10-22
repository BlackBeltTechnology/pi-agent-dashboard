## ADDED Requirements

### Requirement: Dock collapses to a one-line summary bar

When the dock has at least one lane with visible content, it SHALL offer a **Hide** control on its top edge, named "Hide session context". Activating Hide SHALL collapse the dock: the lane region (lane rows, or in compact mode the chips and any open sheet) SHALL be hidden, and one **summary bar** SHALL render in its place. The bar is a single button with `aria-expanded="false"` and `aria-controls` naming the hidden lane region. It shows each visible lane's plain-text summary in lane order, on one line, truncated at the end, and it contains no lane actions. A lane whose content renders nothing (a `hideWhenEmpty` lane) SHALL contribute nothing to the bar. A dock whose lanes all render nothing, or that has only the YOLO footer, SHALL show neither Hide nor a bar.

#### Scenario: Hide collapses the lanes
- **WHEN** the dock of a main-checkout session shows the Changes (`3 files changed +1 −0`), OpenSpec and Context lanes and the user activates Hide
- **THEN** the lane rows SHALL be hidden and one summary bar SHALL show each lane's plain-text summary (`3 files changed +1 −0`, the OpenSpec summary, `plugin context`) in that order
- **AND** the bar SHALL report `aria-expanded="false"` and its accessible name SHALL start with "Session context"

#### Scenario: Worktree branch stays in the bar
- **WHEN** a worktree session on branch `os/x` with 4 changed files totalling +120 −33 is collapsed
- **THEN** the bar's Changes segment SHALL read `os/x 4 files +120 −33`

#### Scenario: Empty plugin lane leaves no trace in the bar
- **WHEN** the Context lane's claims all render nothing and the dock is collapsed
- **THEN** the bar SHALL contain no Context segment and no stray separator

#### Scenario: Bar never wraps
- **WHEN** the dock is collapsed in a 375 px viewport and the lane summaries are wider than the bar
- **THEN** the bar SHALL stay one line high, truncate its trailing content, and be 44 px tall

#### Scenario: Footer-only dock has nothing to collapse
- **WHEN** YOLO is active and no lane has content
- **THEN** the dock SHALL render no Hide control and no summary bar

### Requirement: Collapsed dock keeps live signals and announcements

While collapsed, a lane that carries a live signal SHALL keep that signal in the bar: a running process shows the working indicator and count, and a queue shows its count. The dock's polite live region SHALL keep announcing count changes. Header-only details (worktree base, drift, dirty markers, lane actions) are shown only while lanes are shown, and every requirement on lane headers applies whenever lanes are shown, including during a peek.

#### Scenario: Running process stays visible when collapsed
- **WHEN** the dock is collapsed and the bound session starts a background process
- **THEN** the summary bar SHALL show the Processes summary first, with its working indicator
- **AND** the dock's live region SHALL announce the new count once

#### Scenario: Header details return on peek
- **WHEN** a collapsed worktree session's dock is peeked
- **THEN** the Changes lane header SHALL show its full identity segment (branch, `← base`, dirty count, drift) as when expanded

### Requirement: Collapsed dock keeps the YOLO footer and the composer in place

Collapsing, peeking and expanding SHALL NOT change the composer card's size or its distance from the bottom of the chat pane (the card is bottom-anchored). While collapsed or peeking, the YOLO footer SHALL stay in flow as the dock's last line, directly above the composer card, below the summary bar, and never inside the peek overlay.

#### Scenario: YOLO footer under the collapsed bar
- **WHEN** YOLO is active and the dock is collapsed
- **THEN** the YOLO footer SHALL render fully visible between the summary bar and the composer card

#### Scenario: Collapsing frees chat height
- **WHEN** the expanded dock is 220 px tall and the user activates Hide
- **THEN** the transcript region SHALL grow by the difference between 220 px and the collapsed dock's height
- **AND** the composer card's distance from the bottom of the chat pane SHALL be unchanged

### Requirement: Resting on the collapsed bar peeks the dock as an overlay

On devices matching `(hover: hover) and (pointer: fine)`, resting on the collapsed summary bar SHALL peek the dock. The dwell and speed values are the session actions menu hover strip's: at least 300 ms on the bar, with speed below 0.4 px/ms over the most recent 100 ms. Unlike the strip, the bar button itself arms: the bar is the hover zone the user asked for, and clicking it pins. Leaving the bar first cancels. A peek SHALL show the lane region exactly as when expanded (rows, or chips and sheet in compact mode, with the same open lane), as an overlay that grows upward over the transcript. It SHALL NOT reflow the transcript, move the composer card, move focus, or refetch lane data. The bar SHALL NOT arm without fine hover, while a pointer button is pressed, while a dialog is open, while a dock menu opened by click or keyboard is open, or on a dock that is not live for its session (a frozen transition underlay). A peek SHALL end when the dock binds to another session.

#### Scenario: Dwell peeks the dock
- **WHEN** the dock is collapsed and the pointer rests on the summary bar for 300 ms below the speed cutoff
- **THEN** the lane region SHALL render as an overlay above the bar
- **AND** the composer card's position and the transcript's scroll position SHALL be unchanged
- **AND** keyboard focus SHALL remain where it was

#### Scenario: Fast pass toward the composer does not peek
- **WHEN** the pointer crosses the summary bar toward the composer input at 1.5 px/ms without stopping
- **THEN** the dock SHALL NOT peek

#### Scenario: Compact peek shows chips and sheet
- **WHEN** the composer column is 480 px wide, the Changes lane was last open, and the collapsed bar is peeked
- **THEN** the overlay SHALL show the summary chips with the Changes sheet open below them

#### Scenario: Tall content scrolls inside the overlay
- **WHEN** the peeked lanes are taller than the chat pane space above the composer card
- **THEN** the overlay SHALL be no taller than that space and SHALL scroll internally

#### Scenario: Touch never peeks
- **WHEN** the device has no fine hover and the user taps the summary bar
- **THEN** the dock SHALL expand without a peek stage

### Requirement: A peek closes on leave or Escape, never under an open dock menu or focus

A peeked dock SHALL close after a 300 ms grace period once the pointer is outside the bar and the overlay. It SHALL NOT close on pointer leave while a menu, popover or dialog opened from a trigger inside the dock is open (including one rendered outside the overlay), or while keyboard focus is inside the overlay. An open lane disclosure or compact chip does not by itself keep a peek open. Escape SHALL first close any open dock menu or dialog. It SHALL close the peek only when none is open and focus is on the bar or inside the overlay, and then move focus to the bar. A modal dialog opening while the dock is peeked SHALL return it to collapsed. Escape elsewhere (for example in the composer input) SHALL keep its existing meaning and SHALL NOT be consumed by the dock.

#### Scenario: Leaving closes after the grace period
- **WHEN** the dock is peeked and the pointer leaves the bar and the overlay for longer than 300 ms
- **THEN** the dock SHALL return to collapsed

#### Scenario: Open menu keeps the peek
- **WHEN** the dock is peeked, the user opens the OpenSpec lane's `⋯` menu, and the pointer moves onto the menu outside the overlay
- **THEN** the dock SHALL stay peeked until that menu closes

#### Scenario: Focus inside keeps the peek
- **WHEN** the dock is peeked, the user tabs onto Review inside the overlay, and the pointer leaves
- **THEN** the dock SHALL stay peeked while focus remains inside the overlay

#### Scenario: Escape inside the peek closes it
- **WHEN** the dock is peeked, focus is on a control inside the overlay, and the user presses Escape
- **THEN** the dock SHALL return to collapsed and focus SHALL move to the summary bar

#### Scenario: Escape closes an open menu before the peek
- **WHEN** the dock is peeked with the OpenSpec `⋯` menu open and focus in it, and the user presses Escape
- **THEN** the menu SHALL close and the dock SHALL stay peeked

#### Scenario: A modal dialog ends the peek
- **WHEN** the dock is peeked and a modal dialog opens
- **THEN** the dock SHALL return to collapsed

#### Scenario: Escape in the composer is not taken
- **WHEN** the dock is peeked, focus is in the composer input, and the user presses Escape
- **THEN** the composer's own Escape behaviour SHALL run unchanged and the dock SHALL NOT consume the key

### Requirement: Pin and the bar expand the dock

A peeked dock SHALL show a **Pin** button, named "Pin session context open". Activating Pin, or activating the summary bar (click, Enter, Space or tap) while collapsed or peeked, SHALL expand the dock: in flow as today, with the Hide control, and with the bar gone. A dock expanded this way SHALL NOT close on pointer leave. When the bar or Pin had focus at expansion (click, tap or keyboard), focus SHALL move to the Hide control; otherwise focus stays where it was. Hide, Pin and the bar SHALL have targets of at least 24×24 CSS px (44×44 at phone width).

#### Scenario: Pin keeps the dock open
- **WHEN** the dock is peeked and the user activates Pin
- **THEN** the dock SHALL be expanded in flow
- **AND** moving the pointer away for longer than 300 ms SHALL NOT collapse it

#### Scenario: Clicking the bar while peeked pins
- **WHEN** the dock is peeked and the user clicks the summary bar
- **THEN** the dock SHALL be expanded in flow

#### Scenario: Keyboard expand
- **WHEN** focus is on the collapsed summary bar and the user presses Enter
- **THEN** the dock SHALL be expanded and focus SHALL move to the Hide control

### Requirement: Collapse state persists per session and defaults to expanded

The dock's collapsed or expanded state SHALL be remembered per session in browser storage. Switching sessions SHALL show each session's own stored state. A session with no stored state SHALL show the dock expanded, and the dock SHALL NOT collapse on its own. A peek SHALL NOT be stored, so a reload or session switch during a peek SHALL show collapsed. A dock not bound to a session (the folder home) SHALL neither read nor write the state; a dock that is not live for its session (a frozen transition underlay) MAY read it but SHALL NOT write it and SHALL offer no Hide, Pin or peek. Storage failures SHALL fall back to expanded without an error surface.

#### Scenario: Per-session memory
- **WHEN** the user collapses the dock in session `s1`, switches to session `s2` (no stored state), then back to `s1`
- **THEN** `s2` SHALL show the dock expanded and `s1` SHALL show it collapsed

#### Scenario: Survives reload
- **WHEN** the dock of session `s1` is collapsed and the page reloads
- **THEN** the dock of `s1` SHALL render collapsed

#### Scenario: Storage unavailable
- **WHEN** browser storage throws on read
- **THEN** the dock SHALL render expanded

## MODIFIED Requirements

### Requirement: Dock is a shrinkable row of the chat pane

The dock SHALL be a shrinkable row of the chat pane's height budget, declared in the row table. Under a deficit its lanes SHALL give height by scrolling, down to a bound equal to the YOLO footer's fixed one-line height (0 without YOLO). A collapsed dock SHALL declare its own entry whose bound equals the summary bar plus the YOLO footer when active, so the bar and the footer are never clipped. A peek overlay SHALL NOT count toward the row. In every state the declared floor SHALL exceed the bound, so the footer is never clipped.

#### Scenario: Footer-only dock keeps floor above bound
- **WHEN** YOLO is active and no lane has content
- **THEN** the row's declared bound SHALL equal the footer height and its floor SHALL be greater than the bound

#### Scenario: Short pane
- **WHEN** the pane is too short to fit the transcript floor, the dock and the composer at their content heights
- **THEN** the dock's lanes SHALL scroll internally and the YOLO footer and composer card SHALL remain fully visible

#### Scenario: Collapsed dock in a short pane
- **WHEN** the dock is collapsed with YOLO active and the pane is too short for the transcript floor
- **THEN** the summary bar and the YOLO footer SHALL remain fully visible and the row's floor SHALL exceed its bound

#### Scenario: Peek does not change the row budget
- **WHEN** the collapsed dock is peeked
- **THEN** the dock row's height in the chat pane SHALL equal the collapsed height

### Requirement: Changes lane shows worktree identity and the session's changed files

The Changes lane header SHALL carry the Git group's worktree identity and worktree actions when the session is a worktree session, then the session's changed-file count with added and removed line totals, and a Review action that opens the session diff page. Expanding the lane SHALL list each changed file with its origin and line delta. Each in-cwd row SHALL offer two targets:
- **Open** opens the file itself (its current content) in the bound session's editor pane. The file name is also activatable and has the same effect.
- **Diff** opens that file's per-file diff tab in the editor pane, never the whole-session diff page.

Rules:
- A file missing on disk keeps both targets. Open SHALL show, in that tab, that the file no longer exists, naming its path (never a blank viewer or a crash), for every built-in viewer kind. Diff SHALL render from the session diff, which does not read the disk.
- An out-of-cwd entry SHALL render with no target.
- Both targets SHALL be visible without hover and carry accessible names that include the path, and the descriptive text SHALL truncate before either target is hidden.
- Activating a target from a peeked dock SHALL return the dock to collapsed.
- Rows SHALL offer no targets when the dock is not live for the session the editor pane serves.

#### Scenario: Worktree header
- **WHEN** the session has `gitBranch = "os/x"`, `gitWorktree.base = "develop"`, 4 changed files totalling +120 −33, and is 2 commits ahead
- **THEN** the header SHALL show `os/x`, `← develop`, `4 files +120 −33` and `↑2`, followed by Review and the worktree actions

#### Scenario: Main checkout header
- **WHEN** the session is not a worktree session and has 4 changed files
- **THEN** the header SHALL show `4 files changed` with the totals and Review, and no branch

#### Scenario: Open shows the file itself
- **WHEN** the user activates Open on the row for `packages/client/src/App.tsx`
- **THEN** the editor pane SHALL open (revealing the split if closed) with `packages/client/src/App.tsx` as the active file tab, showing its current content
- **AND** no diff tab and no diff page SHALL open

#### Scenario: File name opens the file
- **WHEN** the user activates the file name `App.tsx` in that row
- **THEN** the result SHALL be the same as activating Open

#### Scenario: File opens its diff
- **WHEN** the user activates Diff on the row for `packages/client/src/App.tsx`
- **THEN** the editor pane SHALL show the per-file diff tab for `packages/client/src/App.tsx` as the active tab
- **AND** the session diff page SHALL NOT open

#### Scenario: Review still opens the session diff page
- **WHEN** the user activates Review in the Changes lane header
- **THEN** the session diff page SHALL open

#### Scenario: File missing on disk
- **WHEN** a row's file no longer exists on disk and the user activates Open
- **THEN** the tab SHALL show that the file no longer exists, naming its path
- **AND** activating Diff on the same row SHALL still open the file's diff tab, rendered from the session diff

#### Scenario: Count and totals cover the same files
- **WHEN** the session diff lists 4 in-cwd files with line totals and 1 out-of-cwd entry that is not previewable
- **THEN** the header count and totals SHALL cover the same entries, and the out-of-cwd row SHALL render without Open and without Diff

#### Scenario: Open from a peek collapses the dock
- **WHEN** the dock is peeked and the user activates Open on a row
- **THEN** the file SHALL open in the editor pane and the dock SHALL return to collapsed

#### Scenario: Missing image opens a message, not a blank pane
- **WHEN** a changed `docs/logo.png` no longer exists on disk and the user activates Open
- **THEN** the tab SHALL show that `docs/logo.png` no longer exists

#### Scenario: Two targets fit at phone width
- **WHEN** the Changes lane renders at a 375 px viewport with a long file path
- **THEN** the folder text SHALL truncate first, Open and Diff SHALL stay visible at 44×44 CSS px, and the row SHALL NOT overflow

#### Scenario: Bash-created file is marked
- **WHEN** a changed file's session-diff entry has `detectedVia = "bash-artifact"`
- **THEN** its row SHALL mark it as created via bash

#### Scenario: Deltas are not colour-only
- **WHEN** a row shows +64 −20
- **THEN** both values SHALL carry their sign characters as well as their colour

### Requirement: Compact dock below 520 px

When the composer column is narrower than 32.5rem (520 px at the default 16 px root), every lane SHALL render as one summary chip in a single row while the dock is expanded or peeked; a collapsed compact dock shows the summary bar instead, and its Hide control sits on the dock's top edge as in row layout. Each chip is a disclosure control naming the lane and its count, also for lanes that are not expandable in rows. It SHALL open a sheet below the chips holding that lane's header actions and body, one lane at a time. The YOLO footer is not a chip. The threshold follows the container width.

#### Scenario: Narrow split pane on a wide viewport
- **WHEN** the chat pane is 480 px wide inside a 1500 px viewport at the default root size
- **THEN** the dock SHALL render summary chips instead of lane rows

#### Scenario: Chip opens its lane
- **WHEN** the user activates the Changes chip in compact mode
- **THEN** the Changes lane's actions and file list SHALL render below the chips and the chip SHALL report `aria-expanded="true"`

#### Scenario: Layout flip keeps the open lane and focus
- **WHEN** the Changes lane is open and the dock container shrinks from 521 px to 519 px
- **THEN** the Changes chip SHALL be expanded with its sheet shown, and focus SHALL move to the Changes chip if it was inside the lane

#### Scenario: Phone targets
- **WHEN** the dock renders at a 375 px viewport
- **THEN** every chip, row action and lane control SHALL be at least 44×44 CSS px

#### Scenario: Collapsed compact dock shows the bar
- **WHEN** the composer column is 480 px wide and the dock is collapsed
- **THEN** no chips SHALL render and the summary bar SHALL render in their place
- **AND** activating the bar SHALL show the chips again with the previously open lane's sheet

### Requirement: Changes lane identity segment for worktree sessions

Whenever the Changes lane is shown (expanded, peeked, or as a compact sheet), it SHALL carry a worktree identity segment only when `session.gitWorktree` is set: the branch when known; `← <base>` only when `gitWorktree.base` is present; and, when `gitStatus` is present, the dirty count, `↑ahead` / `↓behind` when non-zero, or a no-local-changes marker that never claims remote sync. Without `gitStatus`, no drift or no-changes marker SHALL render. Every marker SHALL have a text alternative.

#### Scenario: Git identity shows branch, base and drift
- **WHEN** the bound session has `gitBranch = "os/x"`, `gitWorktree = { name: "os-x", mainPath: "/repo", base: "develop" }` and `gitStatus = { dirtyCount: 3, ahead: 2, behind: 0, … }`
- **THEN** the Changes lane's identity segment SHALL show `os/x`, `← develop`, a dirty count of `3` and `↑2`
- **AND** it SHALL NOT show a behind count

#### Scenario: Base omitted when unknown
- **WHEN** `gitWorktree.base` is absent
- **THEN** the identity segment SHALL NOT render a `←` base marker

#### Scenario: Unknown status is not shown as clean
- **WHEN** `gitStatus` is absent
- **THEN** the identity segment SHALL render neither a no-changes marker nor drift markers

#### Scenario: Identity tooltip names the worktree
- **WHEN** the user hovers the identity segment of worktree `os-x` whose main checkout is `/repo`
- **THEN** its tooltip SHALL name `os-x` and `/repo`

#### Scenario: Collapsed bar keeps only the branch
- **WHEN** a worktree session's dock is collapsed
- **THEN** the summary bar SHALL show the branch with the file count and totals, and SHALL NOT show the base, dirty or drift markers
