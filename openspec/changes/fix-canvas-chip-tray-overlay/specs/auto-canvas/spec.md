## ADDED Requirements

### Requirement: Canvas chip tray floats above the composer without affecting layout

The canvas chip tray (server chip and mobile tap-to-open chip) SHALL render as a
floating overlay portaled to the top-level layer root, taking no space in the page layout. A chip appearing,
changing or disappearing SHALL NOT change the position or size of any other
element. The tray SHALL be anchored at the bottom-right, directly above the live session's
composer stack (the context strip, status, queue and composer rows, including plugin
composer-panel content), and SHALL track that stack's top edge so it never overlaps
it. A frozen (overlay-underlay) session view SHALL NOT determine the anchor. When no
live composer is mounted the tray SHALL rest at the viewport's bottom-right inset,
clear of the device safe-area inset, and SHALL never be wider than the viewport minus its inset.
The tray SHALL stack below composer popovers, dialogs and toasts. Only the chips
SHALL receive pointer input; the tray's empty area SHALL let pointer events
through to the content beneath.

#### Scenario: Chip appearing does not move the toolbar
- **GIVEN** a desktop session view with no canvas chip
- **WHEN** the session's canvas state gains a server chip
- **THEN** the header and toolbar bounding boxes are unchanged
- **AND** the chip is visible at the bottom-right above the composer

#### Scenario: Tray follows a growing composer stack
- **GIVEN** a server chip is shown above the composer stack
- **WHEN** the stack grows (multi-line draft or a queued follow-up row)
- **THEN** the chip's bottom edge stays above the stack's top edge

#### Scenario: A frozen underlay never anchors the tray
- **GIVEN** a server chip is shown for a session
- **WHEN** a route-backed overlay dialog is open over a frozen copy of that session view
- **THEN** the tray is not anchored to the frozen copy's composer stack
- **AND** the dialog paints above the tray

#### Scenario: Tray does not flash before it is positioned
- **GIVEN** a live composer stack is mounted
- **WHEN** a chip first appears
- **THEN** the tray is not visible at any position that overlaps the composer stack before its anchor has been measured

#### Scenario: Tray stays above the soft keyboard
- **GIVEN** a mobile viewport with a chip shown
- **WHEN** the soft keyboard opens and shrinks the visual viewport
- **THEN** the chip stays visible above the composer stack

#### Scenario: Composer popover paints above the tray
- **GIVEN** a server chip is shown
- **WHEN** the user opens the composer's model selector
- **THEN** the popover is painted above the chip

#### Scenario: Empty tray area does not block clicks
- **GIVEN** a chip is shown
- **WHEN** the user clicks content beneath the tray's empty area
- **THEN** the click reaches that content

#### Scenario: Mobile tap-to-open chip floats too
- **GIVEN** a mobile viewport with a pending canvas file target
- **WHEN** the tap-to-open chip is shown
- **THEN** it floats above the composer without shifting the chat layout
- **AND** tapping it still opens the target in the foreground
