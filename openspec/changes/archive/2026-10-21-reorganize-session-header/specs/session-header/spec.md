## ADDED Requirements

### Requirement: Desktop session header SHALL be one row of three zones

The desktop `SessionHeader` SHALL render one row at least 48 px tall in three zones. Leading: back, title menu button (16 px semibold), Reveal in sidebar, meta line. Middle: footer segments, vault chip. Trailing: Modules, Changed files, Resume, Fork, layout switch, View. Header-owned controls SHALL use labels of at least 12 px and be at least 32 px tall; shared tag chips and plugin segments keep their own sizes. It SHALL NOT render Attach, an attached chip, a refresh button or a rename pencil.

#### Scenario: Live session header order
- **GIVEN** a live session with changed files and no modules
- **WHEN** the desktop header renders
- **THEN** the controls appear in order: back, title menu button, Reveal in sidebar, meta line, Changed Files, layout switch, View
- **AND** no element with `data-testid="refresh-chat"` is visible until the title menu is open

#### Scenario: Ended session keeps Resume and Fork
- **GIVEN** an ended session with a session file and an `onResume` callback
- **WHEN** the desktop header renders
- **THEN** Resume and Fork render in the trailing zone before the layout switch

#### Scenario: No attach surface in the header
- **GIVEN** a session with an attached OpenSpec change
- **WHEN** the desktop header renders
- **THEN** the header shows no Attach button, no attached-change chip, and no artifact letters

### Requirement: Header SHALL keep trailing controls whole when the row is full

At any width, when the header row cannot fit its content, the meta line SHALL wrap under the title and the title SHALL truncate before any trailing control is clipped, shrunk below its minimum or pushed out of the row.

#### Scenario: Busy ended session at 900 px
- **GIVEN** a 900 px wide header for an ended session with modules, changed files, three tags and a long name
- **WHEN** the header renders
- **THEN** Modules, Changed Files, Resume, Fork, the layout switch and View are fully visible
- **AND** the meta line sits under the title and the title ends in an ellipsis

### Requirement: Title menu SHALL hold rename, reveal, tags and reload

Activating the title button SHALL open a `role="menu"` with, in order: "Rename" (with an `F2` hint), "Reveal in sidebar", "Edit tags", a separator, and "Reload transcript" with a one-line description. An item SHALL be omitted when its callback is not wired; "Rename" SHALL also be omitted for ended sessions. Escape SHALL close the menu and return focus to the title button.

#### Scenario: Menu items for a live session
- **GIVEN** a live session with rename, reveal, tag and refresh callbacks
- **WHEN** the user activates the title button
- **THEN** the menu lists Rename, Reveal in sidebar, Edit tags and Reload transcript in that order

#### Scenario: Rename omitted for an ended session
- **GIVEN** an ended session
- **WHEN** the user opens the title menu
- **THEN** the menu has no Rename item

#### Scenario: Escape returns focus
- **GIVEN** the title menu is open
- **WHEN** the user presses Escape
- **THEN** the menu closes and focus returns to the title button

### Requirement: Header meta line SHALL label the session clock

The meta line SHALL show, in order: editable tags, the phase chip when present, `pi <version>` or the pi-below-floor warning pill in its place, the session clock, and the context ring. The clock SHALL read `running <duration>` for a live session and `ended · ran <duration>` for an ended one, where the duration is `lastActivityAt − startedAt`, or `ended` when `lastActivityAt` is absent. The clock SHALL tick once per second inside its own component so the rest of the header does not re-render.

#### Scenario: Live clock is labelled
- **GIVEN** a live session started 5 minutes 32 seconds ago
- **WHEN** the header renders
- **THEN** the meta line reads `running 5m 32s`

#### Scenario: Ended clock is labelled
- **GIVEN** an ended session that ran for 42 minutes
- **WHEN** the header renders
- **THEN** the meta line reads `ended · ran 42m`

#### Scenario: Ended clock never shows a negative duration
- **GIVEN** an ended session whose `lastActivityAt` is earlier than its `startedAt`
- **WHEN** the header renders
- **THEN** the meta line reads `ended · ran 0s`

#### Scenario: Clock never shows a negative duration
- **GIVEN** a live session whose `startedAt` is ahead of the browser clock
- **WHEN** the header renders
- **THEN** the meta line reads `running 0s`

#### Scenario: Clock tick does not re-render the header
- **GIVEN** an idle live session with the header mounted
- **WHEN** three seconds pass
- **THEN** only the clock component re-renders; the `SessionHeader` component does not commit

#### Scenario: Below-floor warning replaces the version text
- **GIVEN** a session whose `piBelowFloor` is set
- **WHEN** the header renders
- **THEN** the pi-below-floor warning pill renders in the meta line in place of the `pi <version>` text

### Requirement: Context ring SHALL show context-window usage in the header

The header SHALL show context-window usage as a ring fed by the per-session context usage that fed the former header bar. The ring SHALL expose `role="meter"` with `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` and an accessible name, show the percentage as text on desktop, and show `<used> of <window> tokens` in its tooltip. It SHALL render nothing when usage is unknown. The `contextUsageBar` preference SHALL gate it on desktop and mobile, as it gates the session card bar.

#### Scenario: Ring shows usage
- **GIVEN** a session using 127,000 of 1,000,000 context tokens
- **WHEN** the desktop header renders
- **THEN** the ring shows `13%` and exposes `aria-valuenow="13"`
- **AND** its tooltip reads `127.0k of 1.0M tokens`

#### Scenario: Ring goes critical
- **GIVEN** a session at 95% context usage
- **WHEN** the header renders
- **THEN** the ring arc uses `--accent-red-text` and the text reads `95%`

#### Scenario: Tier boundaries follow the shown percentage
- **GIVEN** usage that rounds to 30%, 31%, 50%, 51%, 70%, 71%, 90% and 91%
- **WHEN** the ring renders
- **THEN** the arc is neutral, blue, blue, green, green, orange, orange and red respectively

#### Scenario: Usage above the window
- **GIVEN** a session using 1,020,000 tokens of a 1,000,000-token window
- **WHEN** the header renders
- **THEN** the ring shows `100%` with the red arc and `aria-valuenow="100"`
- **AND** its tooltip reads `1.02M of 1.0M tokens`

#### Scenario: Ring warns near capacity
- **GIVEN** a session at 85% context usage
- **WHEN** the header renders
- **THEN** the ring arc uses `--accent-orange-text` and the text still reads `85%`

#### Scenario: Ring hidden when usage is unknown
- **GIVEN** a session with no context-window size
- **WHEN** the header renders
- **THEN** no ring renders

#### Scenario: Preference hides the ring
- **GIVEN** the effective `contextUsageBar` preference is off for the session
- **WHEN** the header renders
- **THEN** no ring renders

### Requirement: Context ring colours SHALL meet non-text contrast

On a `--border-secondary` track the arc SHALL use, by the rounded percentage shown: `--text-secondary` up to 30%, `--accent-blue-text` 31–50%, `--accent-green-text` 51–70%, `--accent-orange-text` 71–90%, `--accent-red-text` from 91%. Each colour SHALL measure at least 3:1 against the page and the track in every built-in palette, dark and light (WCAG 1.4.11). The percentage text SHALL remain, so colour is never the only cue.

#### Scenario: Arc contrast in every tested palette
- **GIVEN** the ring at 13%, 40%, 60%, 85% and 95% in every palette of `THEMES`, dark and light
- **WHEN** the arc colour is measured against `--bg-primary` and the track colour
- **THEN** every ratio is at least 3:1

### Requirement: Header SHALL collapse by priority in narrow containers

Below a 760 px header container width, the header SHALL move the meta line under the title, hide the `pi <version>` text, render the layout switch and the View menu icon-only with accessible names and tooltips, and hide the Changed Files word while keeping its counts and its accessible name. The title SHALL stay on one line and truncate with an ellipsis, with the full name in its tooltip; it SHALL NOT wrap.

#### Scenario: Long title truncates instead of wrapping
- **GIVEN** a 560 px wide header and a 66-character session name
- **WHEN** the header renders
- **THEN** the title occupies one line ending in an ellipsis
- **AND** the layout switch keeps three visible segments of at least 32 px

#### Scenario: Low-priority meta hides first
- **GIVEN** a 560 px wide header
- **WHEN** the header renders
- **THEN** the `pi <version>` text is hidden while the tags, the `+ tag` control, the clock and the context ring stay visible

### Requirement: Mobile session header SHALL be one row

In the mobile layout the session header SHALL render one row at least 48 px tall: back, title (truncating), the context ring button, the layout-mode button, the View button, and the session actions (⋯) button, each a 44 px target. The pi-below-floor warning and the vault chip SHALL keep rendering below the row when present. No info strip (model, thinking level, current tool, cost, context bar) SHALL render under the mobile header.

#### Scenario: Single-row mobile header
- **GIVEN** a 390 px wide viewport and an open session
- **WHEN** the mobile header renders
- **THEN** back, title, context ring, layout button, View and ⋯ render in one row
- **AND** no model, thinking-level, current-tool or cost strip renders below it

#### Scenario: Conditional rows stay
- **GIVEN** a mobile session whose `piBelowFloor` is set and that has vault bindings
- **WHEN** the mobile header renders
- **THEN** the pi-below-floor warning and the vault chip render below the header row

### Requirement: Mobile context ring SHALL open a usage popover

Tapping the mobile ring button SHALL open a non-modal popover (`role="dialog"`, `aria-modal="false"`, an `aria-label`) reading `<percent>% · <used> of <window> tokens`, followed by ` · <cost>` only when the session cost is above zero. An outside tap or Escape SHALL close it and return focus to the ring button.

#### Scenario: Ring popover shows the numbers
- **GIVEN** the mobile header for a session at 13% context usage that cost $0.99
- **WHEN** the user taps the ring
- **THEN** a popover reads `13% · 127.0k of 1.0M tokens · $0.99`

#### Scenario: Zero cost is omitted
- **GIVEN** a session at 13% context usage with no cost yet
- **WHEN** the user taps the ring
- **THEN** the popover reads `13% · 127.0k of 1.0M tokens`

#### Scenario: Escape closes the popover
- **GIVEN** the ring popover is open
- **WHEN** the user presses Escape
- **THEN** the popover closes and focus returns to the ring button
