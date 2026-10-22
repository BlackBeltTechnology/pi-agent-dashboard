# sidebar-header Specification

## Purpose

Sidebar header renders two rows: app-level controls (logo, theme, install, tunnel, server selector, settings) and filter controls (folder + session search, hidden/active toggles).

## Requirements

### Requirement: Two-row header layout
The sidebar header SHALL render as two distinct rows within a single border-bottom container. Row 1 SHALL group its controls by purpose: a left brand group (π logo, Discord link), a divider, a left tools group (Appearance trigger, Focus toggle), and a right group (open-questions pill, update badge, connection chip, Settings gear). Row 1 SHALL NOT clip or overflow any control at any sidebar width; when its controls do not fit on one line it SHALL wrap the right-hand group onto a further line instead. Row 1 SHALL stay on one line at sidebar widths ≥ 280 px with no open question, no waiting device, a live connection, quiet remote access (local-only or LAN-only) and an update count below 10, and at ≥ 400 px in every state when the current server's name is at most 8 characters (such as "Local"). Outside those states row 1 MAY wrap, but SHALL still never clip.

The icon-only header controls (the Discord link, the Appearance trigger, the Focus toggle and the Settings gear in row 1, and the filter funnel in row 2) SHALL share one icon-button recipe: a 28 px square target, an 18 px glyph painted in `--text-secondary` (at least 3:1 against the header background), a `--bg-hover` fill on hover and while its popover is open, and, when pressed, the selected-chip recipe (`--text-primary` on `--accent-soft` with an `--accent` border). None of them SHALL paint with a Tailwind palette class. While row 1 is one line, adopting the recipe SHALL NOT change its height. The Electron runtime update badge SHALL show only its glyph in the sidebar header, keeping the version in its tooltip and accessible name. The connection chip's server name SHALL truncate at 96 px for a 400–479 px header and at 160 px from 480 px; the chip's tooltip and accessible name SHALL contain the full name at every width.

#### Scenario: Row 1 contains app-level controls
- **WHEN** the sidebar header renders
- **THEN** the first row SHALL contain, left to right: the π logo, the Discord link, a non-focusable divider, the Appearance trigger, the Focus toggle; then a right-aligned group of the open-questions pill (conditional), the update badge (conditional), the connection chip, and the Settings gear as the right-most control
- **AND** the first row SHALL NOT contain a standalone ThemePicker, ThemeToggle, TunnelButton or InstallButton
- **AND** while a YOLO session is active the row SHALL additionally behave as required by "Row 1 carries an active-YOLO indicator", adding no visible control

#### Scenario: Row 1 stays on one line in the common state
- **GIVEN** one available update, a live connection, quiet remote access, no open question, no waiting device and a server name longer than 30 characters
- **WHEN** the sidebar renders at 280 px, 320 px, 411 px, 440 px, 491 px and 500 px wide
- **THEN** at every width row 1 SHALL be one line and every row-1 control SHALL be fully inside the row's visible box
- **AND** with the sidebar header narrower than 400 px the connection chip SHALL show no server name, while its accessible name still contains the server name

#### Scenario: Worst-case state never clips
- **GIVEN** two open questions, an available update, a lost connection, remote access failed, one waiting device and the current server named "Local"
- **WHEN** the sidebar renders at 180 px, 280 px, 400 px, 411 px, 491 px and 500 px wide
- **THEN** at every width every row-1 control and every attention signal SHALL be fully visible
- **AND** at 400 px, 411 px, 491 px and 500 px row 1 SHALL be one line

#### Scenario: Header icon buttons share one size
- **WHEN** the sidebar header renders
- **THEN** the Discord link, the Appearance trigger, the Focus toggle, the Settings gear and the filter funnel SHALL each have a 28 × 28 px box and an 18 px glyph
- **AND** each glyph's colour SHALL reach at least 3:1 against the header background in `{base,dark}`, `{base,light}` and `{nord,dark}`

#### Scenario: A tunnel at the narrowest width wraps instead of clipping
- **GIVEN** remote access reaches the internet, one available update and a live connection
- **WHEN** the sidebar renders at 280 px wide
- **THEN** every row-1 control SHALL be fully visible, on one line or with the right-hand group wrapped onto a further line

#### Scenario: Electron update badge stays compact
- **GIVEN** the Electron app has dashboard version 0.12.3 available
- **WHEN** the sidebar header renders
- **THEN** the runtime update badge SHALL show its glyph and no version text, and its tooltip and accessible name SHALL contain "0.12.3"

#### Scenario: Row 2 contains filter controls
- **WHEN** the sidebar header renders
- **THEN** the second row SHALL contain one search box with a Sessions/Folders scope toggle and a filter-funnel button
- **AND** the second row SHALL NOT contain a folder Pin+ button (relocated to the scroll list per `dashboard-add-buttons`)

#### Scenario: Row spacing
- **WHEN** both rows render
- **THEN** row 1 SHALL use compact padding and row 2 SHALL use normal padding, with no visible divider between them

### Requirement: All existing controls preserved
Every former header control SHALL remain functional and reachable from the sidebar header within at most two activations: directly in row 1, or as an item in a popover opened from a row-1 or row-2 trigger. The folder Pin+ button is the only exception; it relocates to the scroll list. Each control SHALL keep its existing `data-testid`.

#### Scenario: No controls removed except Pin+
- **WHEN** the sidebar header renders with all features enabled
- **THEN** the π logo, Discord link, Appearance trigger, Focus toggle, connection chip and Settings gear SHALL be present in row 1
- **AND** opening the Appearance dropdown SHALL expose the color-mode choice (Light / System / Dark) and every palette
- **AND** opening the connection chip SHALL expose the server list, "Manage servers…", the Remote access item and, when installable, the Install as app item
- **AND** opening the filter funnel SHALL expose the Include archive and Show hidden toggles
- **AND** the folder Pin+ button SHALL NOT be present in the header

#### Scenario: Conditional controls still conditional
- **WHEN** InstallButton conditions are not met (already installed or not installable)
- **THEN** the connection menu SHALL NOT render an Install as app item, same as current behavior

#### Scenario: Remote access item opens the existing dialog
- **WHEN** the user opens the connection chip and activates the Remote access item
- **THEN** the menu SHALL close, the Remote access dialog SHALL open on its landing view exactly as the former row-1 Remote access button did, and focus SHALL move into the dialog
- **AND** closing the dialog SHALL return focus to the connection chip that opened it when that chip is still visible, otherwise to a visible connection chip

#### Scenario: Access items are reachable by keyboard
- **GIVEN** the connection menu is open with an installable PWA
- **WHEN** the user presses ArrowDown repeatedly from the first server entry
- **THEN** focus SHALL move through every server entry, "Manage servers…", Remote access and Install as app, skipping the non-focusable Access group label

### Requirement: Row 1 carries an active-YOLO indicator

While a YOLO session is active, the sidebar header's app-level control row
SHALL be visibly tinted. The tint is the row-1 YOLO indicator: it SHALL NOT add a
visible control, SHALL NOT displace or replace any row-1 control, and SHALL NOT
name the remaining time
(the remaining time is named on the prompt composer and the Access page).

The tint SHALL be conditional: with no YOLO session active, row 1 SHALL render
exactly the controls required by "Two-row header layout".

While tinted, row 1 SHALL carry the full YOLO description as its pointer
tooltip (row-1 controls with their own tooltip keep it); SHALL contain, as its first focusable element, a link to the surface
where the session can be ended that is visually hidden until it receives
keyboard focus and whose accessible name is the full description. Row 1 itself
SHALL NOT navigate on click. The tint SHALL NOT be dismissible.

At viewport widths of 375 px (with the sidebar drawer opened), 768 px and
1500 px, each at a viewport height of at least 600 px, with the interface
language set to `en` and to `hu`, scoped or unscoped, row 1's height with the
tint SHALL equal its height with no YOLO session active, including while the
YOLO link holds keyboard focus.

In every named theme in light and dark mode, while tinted, row 1's secondary and
tertiary text SHALL each have a contrast against the tint of at least 4.5:1 or
of at least 85% of its contrast against the untinted row background, and the
tint's underline SHALL have a contrast of at least 3:1 against the tint. The tint's visual
boundary SHALL NOT be drawn with a border that adds to the row's box. This
requirement does not constrain how the other row-1 controls render when row 1
runs out of width.

#### Scenario: The indicator is absent by default

- **WHEN** the sidebar header renders and no YOLO session is active
- **THEN** row 1 SHALL contain exactly the controls required by "Two-row header layout", with no tint, no YOLO tooltip and no YOLO link

#### Scenario: The indicator appears while YOLO is active

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL be tinted
- **AND** it SHALL contain exactly the same visible controls as with no YOLO session active
- **AND** hovering row 1 outside its controls that have their own tooltip SHALL show the full YOLO description

#### Scenario: The tint does not change row 1's height

- **GIVEN** an active YOLO session, scoped or unscoped, and the interface language is `en` or `hu`
- **WHEN** the sidebar header renders at a viewport width of 375 px (sidebar drawer opened), then 768 px, then 1500 px, with a viewport height of at least 600 px
- **THEN** at each width row 1's height SHALL equal its height when no YOLO session is active at that same width

#### Scenario: The row leads to the Access page

- **GIVEN** an active YOLO session
- **WHEN** keyboard focus enters row 1 and Enter is pressed on the now-visible YOLO link
- **THEN** the Access settings page SHALL be shown
- **AND** clicking row 1 anywhere outside that link, including its existing controls, SHALL behave as it does with no YOLO session active

#### Scenario: The tint keeps row 1 legible in every theme

- **GIVEN** an active YOLO session
- **WHEN** row 1 is rendered in each named theme, light and dark
- **THEN** its secondary and tertiary text SHALL each reach 4.5:1 against the tint, or at least 85% of their contrast against the untinted row background
- **AND** the underline SHALL reach 3:1 against the tint

#### Scenario: The indicator is not the only signal

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header is not visible
- **THEN** the operator SHALL still be shown that YOLO is active and the remaining time by the strip on every dashboard prompt composer in scope

### Requirement: Row 1 carries an open-questions pill

The sidebar header's app-level control row SHALL render a compact open-questions
pill while at least one question is open for the user (see
`pending-question-stack`), placed as the first control of row 1's right-hand group.
The pill SHALL show a question glyph and the open-question count, SHALL expose an
accessible name stating the count, and SHALL open the question panel. It SHALL
NOT render when no question is open, and it SHALL NOT displace or replace any
other row-1 control.

#### Scenario: Absent with no open questions
- **WHEN** the sidebar header renders and no question is open
- **THEN** row 1 SHALL contain no open-questions pill and every other row-1 control SHALL be present

#### Scenario: Present with open questions
- **GIVEN** three open questions
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL additionally contain the pill showing 3 with accessible name "3 open questions"
- **AND** every other row-1 control SHALL still be present
- **AND** the pill SHALL be the first control of the right-hand group whether or not a YOLO session is active

### Requirement: Appearance popover
Row 1 SHALL render one Appearance trigger whose glyph is `mdiBrightness6`. Its dropdown SHALL hold a "Mode" section above a "Palette" section, each with a visible heading. The Mode section SHALL be a segmented control of Light, System and Dark, each showing its icon and a visible text label, with the active mode exposed as pressed. The Palette section SHALL list every palette as a row showing a swatch of that palette's background and accent colours for the resolved color mode and the palette's name, laid out in two columns, or one column when the dropdown is too narrow for two. The active palette SHALL be exposed as pressed and marked by the selected-chip fill and border and a bolder name, not by colour alone. Selecting a mode or a palette SHALL apply and persist it as before. Selecting a mode SHALL keep the dropdown open. The dropdown SHALL be at most 300 px wide, clamped to the viewport, and SHALL keep its existing viewport flip-and-clamp positioning; when its content is taller than the space available, the palette list SHALL scroll while the Mode section stays visible.

#### Scenario: Change mode from the dropdown
- **GIVEN** the color mode is Dark
- **WHEN** the user opens Appearance and selects Light
- **THEN** the dashboard SHALL switch to light mode, the Light control SHALL be exposed as pressed, and the dropdown SHALL remain open

#### Scenario: Change palette from the dropdown
- **WHEN** the user opens Appearance and selects the Nord palette
- **THEN** the Nord palette SHALL be applied and marked active, and reloading the page SHALL keep Nord

#### Scenario: Dropdown shows labelled sections
- **WHEN** the user opens Appearance
- **THEN** the dropdown SHALL show the headings "Mode" and "Palette", the visible labels "Light", "System" and "Dark", and the palette rows in two columns
- **AND** exactly one palette row SHALL be exposed as pressed, with the selected-chip border

#### Scenario: Palette names fit on a phone
- **GIVEN** a 375 px viewport with the sidebar drawer open
- **WHEN** the user opens Appearance and the palette rows render in two columns
- **THEN** no palette name SHALL be truncated, including the active row
- **AND** the mode labels SHALL be fully visible in the English, Chinese and Hungarian catalogs

#### Scenario: Swatches follow the resolved mode
- **GIVEN** the color mode is Light
- **WHEN** the user opens Appearance
- **THEN** each palette row's swatch SHALL show that palette's light-mode `--bg-primary` and `--accent-blue` values

#### Scenario: Short viewport
- **GIVEN** a viewport height of 480 px
- **WHEN** the user opens Appearance
- **THEN** the dropdown SHALL lie fully inside the viewport, the Mode control SHALL stay fully visible, and the palette list SHALL scroll internally if its content is taller

#### Scenario: Dropdown probes pass in every theme
- **WHEN** the contrast probe runs on the open dropdown in `{base,dark}`, `{base,light}` and `{nord,dark}`
- **THEN** every contrast and size failure list SHALL be empty

### Requirement: Header popovers are keyboard operable
The Appearance dropdown, the connection menu and the filter funnel SHALL each move keyboard focus to their first control when opened from the keyboard. Each SHALL close on Escape or an outside click. Escape SHALL return focus to its trigger. A selection that closes a popover without opening a dialog or navigating to another page SHALL return focus to its trigger. A popover SHALL lie fully inside the viewport horizontally and vertically.

#### Scenario: Escape returns focus
- **WHEN** any of the three popovers is open and the user presses Escape
- **THEN** the popover SHALL close and keyboard focus SHALL be on the button that opened it

#### Scenario: Keyboard open focuses inside
- **WHEN** the user focuses the filter funnel and presses Enter
- **THEN** the funnel SHALL open with keyboard focus on its first toggle

#### Scenario: Palette selection returns focus
- **WHEN** the user selects a palette in the Appearance dropdown
- **THEN** the dropdown SHALL close and keyboard focus SHALL be on the Appearance trigger

#### Scenario: Narrowest sidebar keeps popovers on-screen
- **GIVEN** a 375 px viewport with a 180 px sidebar
- **WHEN** the user opens Appearance, the connection menu and the filter funnel in turn
- **THEN** each panel SHALL lie fully inside the viewport

#### Scenario: Install selection returns focus
- **GIVEN** an installable PWA
- **WHEN** the user selects Install as app in the connection menu
- **THEN** the menu SHALL close, keyboard focus SHALL be on the connection chip, and the browser install prompt SHALL be requested

### Requirement: Connection chip surfaces state that needs attention
The connection chip SHALL lead with a server-kind glyph: a laptop when the current server is the local dashboard (the dashboard's "Local" entry, or a loopback current host) and a networked server otherwise. An `aria-hidden` status dot coloured by connection state SHALL sit on the glyph as a corner badge. When disconnected, the glyph SHALL switch to its crossed-out ("off") form in the red on-surface text colour, a shape cue at every header width, and the badge SHALL NOT cover the glyph's slash; with the sidebar header at least 480 px wide the chip SHALL also show the text "Offline". Below a 400 px header the chip SHALL show no server name and no chevron and SHALL be at least 32 px wide and tall; at 400 px and wider it SHALL show the server name and a chevron. It SHALL show a distinct-shape glyph per remote-access attention state (internet, partial, failed) and a count badge when devices await pairing approval. Its accessible name SHALL state server, connection and remote-access state.

#### Scenario: Glyph names the server kind
- **WHEN** the dashboard is served from `localhost`, then from `127.0.0.1`, then the current server is a remote server
- **THEN** the chip's leading glyph SHALL be the laptop glyph, the laptop glyph, then the networked-server glyph, each with a status-dot badge in the connected colour
- **AND** on `127.0.0.1` the chip's visible name SHALL be unchanged from today

#### Scenario: Disconnected is not colour-only
- **WHEN** the dashboard loses its server connection
- **THEN** at every header width the chip SHALL show the "off" glyph, whose shape differs from the connected glyph, with an error-coloured dot badge
- **AND** with the sidebar header at least 480 px wide it SHALL also show the text "Offline", and narrower than 480 px it SHALL NOT
- **AND** the chip's accessible name SHALL contain "offline"

#### Scenario: Collapsed chip drops name and chevron
- **GIVEN** the sidebar header is narrower than 400 px
- **WHEN** the sidebar header renders with a live connection and quiet remote access
- **THEN** the chip SHALL show only the server-kind glyph with its dot badge, at a target of at least 32 × 32 px
- **AND** its accessible name SHALL still contain the server name and the connection state

#### Scenario: Remote-access states differ by shape, not colour
- **WHEN** the remote-access state is internet, then partial, then failed
- **THEN** the chip SHALL show three glyphs of mutually different shapes, and its accessible name SHALL name the state

#### Scenario: Waiting device is visible without opening the menu
- **GIVEN** one device is waiting for pairing approval
- **WHEN** the sidebar header renders
- **THEN** the chip SHALL show a badge with 1, and the Remote access item inside the menu SHALL state "1 device waiting"

#### Scenario: Local-only access stays quiet
- **GIVEN** remote access is local-only or LAN-only with no waiting device
- **WHEN** the sidebar header renders
- **THEN** the chip SHALL show no remote-access glyph and no badge
