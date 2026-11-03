## RENAMED Requirements

- FROM: `### Requirement: Canvas chip tray floats above the composer without affecting layout`
- TO: `### Requirement: Canvas chip tray sits in the chat column above the composer dock`

## MODIFIED Requirements

### Requirement: Canvas chip tray sits in the chat column above the composer dock

The canvas chip tray (server chip and mobile tap-to-open chip) SHALL render in a content-height slot inside the live session's chat column, directly above the composer dock (or directly above the composer card when no dock renders). The slot SHALL take no height while no chip exists. A chip appearing, changing or disappearing SHALL NOT move the header, toolbar, dock or composer; the transcript's viewport height MAY change by the chip's own height, and a transcript the user has scrolled away from the bottom SHALL keep its scroll position while a chip appears or disappears. The tray SHALL stay within the composer's horizontal extent (the dock's, or the composer card's when no dock renders), SHALL NOT overlap the transcript, its scrollbar, the editor pane, the dock or the dock's Hide handle, and SHALL truncate long labels rather than widen. The slot's chips SHALL be reachable by assistive technology (the slot SHALL NOT be hidden from the accessibility tree). A frozen (overlay-underlay) session view SHALL NOT provide the slot. When no live composer is mounted, or the chat pane is hidden because the editor is in full-width mode, the tray SHALL rest as a fixed overlay at the viewport's bottom-right inset, clear of the device safe-area inset, never wider than the viewport minus its inset, stacked below composer popovers, dialogs and toasts, with only the chips receiving pointer input and the tray's empty area letting pointer events through to the content beneath.

#### Scenario: Chip appearing does not move the toolbar
- **GIVEN** a desktop session view with no canvas chip
- **WHEN** the session's canvas state gains a server chip
- **THEN** the header and toolbar bounding boxes are unchanged
- **AND** the chip is visible directly above the composer dock

#### Scenario: Tray follows a growing composer stack
- **GIVEN** a server chip is shown above the composer stack
- **WHEN** the stack grows (multi-line draft or a queued follow-up row)
- **THEN** the chip's bottom edge stays above the stack's top edge

#### Scenario: A frozen underlay never anchors the tray
- **GIVEN** a server chip is shown for a session
- **WHEN** a route-backed overlay dialog is open over a frozen copy of that session view
- **THEN** the tray is not placed in the frozen copy's composer column
- **AND** the dialog paints above the tray

#### Scenario: Tray does not flash before it is positioned
- **GIVEN** a live composer stack is mounted
- **WHEN** a chip first appears
- **THEN** the tray is never visible at a position that overlaps the composer stack

#### Scenario: Tray stays above the soft keyboard
- **GIVEN** a mobile viewport with a chip shown
- **WHEN** the soft keyboard opens and shrinks the visual viewport
- **THEN** the chip stays visible above the composer stack

#### Scenario: Composer popover paints above the tray
- **GIVEN** a server chip is shown
- **WHEN** the user opens the composer's model selector
- **THEN** the popover is painted above the chip

#### Scenario: Tray clears the dock's Hide handle
- **GIVEN** a server chip is shown above a dock that offers a Hide handle
- **WHEN** the layout settles
- **THEN** the tray's bounding box does not intersect the Hide handle's bounding box

#### Scenario: Slot chips are reachable by role
- **GIVEN** a server chip is shown in the slot
- **WHEN** the accessibility tree is read
- **THEN** the chip's link or button is exposed by role and name, not hidden

#### Scenario: Fallback overlay stacks below toasts
- **GIVEN** a chip is shown in the no-live-composer fallback overlay
- **WHEN** a toast is shown
- **THEN** the toast is painted above the tray

#### Scenario: Empty tray area does not block clicks
- **GIVEN** a chip is shown in the no-live-composer fallback overlay
- **WHEN** the user clicks content beneath the tray's empty area
- **THEN** the click reaches that content

#### Scenario: Tray stays inside the chat column with the editor open
- **GIVEN** a desktop session with the editor pane open beside the chat and a server chip shown
- **WHEN** the layout settles
- **THEN** the tray's bounding box lies within the chat column and does not intersect the editor pane

#### Scenario: Tray does not cover the transcript or scrollbar
- **GIVEN** a server chip is shown and the chat is pinned to the bottom
- **WHEN** the layout settles
- **THEN** the tray's bounding box does not intersect the transcript's last rendered row nor the chat scrollbar
- **AND** the tray's horizontal extent lies within the composer's horizontal extent

#### Scenario: Newest message stays readable above the chip on mobile
- **GIVEN** a mobile viewport with a chip shown and the chat pinned to the bottom
- **WHEN** the layout settles
- **THEN** the last message's bottom edge is above the tray's top edge

#### Scenario: Long label truncates instead of widening
- **GIVEN** a server chip whose title plus URL is longer than the dock width
- **WHEN** the chip renders
- **THEN** the label is truncated and the chip is no wider than the dock

#### Scenario: Long server path truncates instead of overflowing
- **GIVEN** a server chip whose declared path makes its address longer than the dock width
- **WHEN** the chip renders
- **THEN** the address is truncated and the chip is no wider than the dock

#### Scenario: Chip stays reachable in full-editor mode
- **GIVEN** a server chip is shown and the editor is in full-width mode (chat pane hidden)
- **WHEN** the layout settles
- **THEN** the chip is visible as the fixed bottom-right overlay
- **AND** returning to split mode places it in the slot above the dock again

#### Scenario: Mobile tap-to-open chip floats too
- **GIVEN** a mobile viewport with a pending canvas file target
- **WHEN** the tap-to-open chip is shown
- **THEN** it appears in the slot above the composer without covering the transcript or shifting the header
- **AND** tapping it still opens the target in the foreground

#### Scenario: Chip appearing does not yank a scrolled-up transcript
- **GIVEN** a transcript the user has scrolled up away from the bottom
- **WHEN** a server chip appears or disappears
- **THEN** the transcript's scroll position is unchanged

#### Scenario: Composer stays fully visible on a short pane with two chips
- **GIVEN** a 375×320 viewport with both the mobile tap-to-open chip and the server chip shown
- **WHEN** the layout settles
- **THEN** the composer card's bounding box lies within the chat pane's bounding box
- **AND** the transcript MAY shrink to its minimum bound to make room
