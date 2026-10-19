## MODIFIED Requirements

### Requirement: Desktop session card exposes one session actions menu with four entry points

The desktop session card SHALL expose a single session actions menu. The same menu, with the same items, SHALL open from each of these entry points:
- **Trigger:** a button (`session-actions-trigger-<sessionId>`, `aria-haspopup="menu"`, `aria-expanded` reflecting open state) drawn as a small pill of vertical dots. Its placement and behaviour:
  - **Position:** vertically centred on the whole card, measured from the card's top border to its bottom border, whatever the card's height. It sits on the card's right edge, straddling the right border. It SHALL NOT render in the card header.
  - **Bounds:** it SHALL stay inside the space between the card and the enclosing folder border, keeping at least 1 px clear of that border, so it neither overlaps the border nor gets clipped. The transient keyboard focus indicator (`:focus-visible` outline) is exempt from the 1 px clearance, but SHALL NOT be clipped.
  - **Rest state:** always rendered and visible at a reduced emphasis, including on devices without hover. Reduced emphasis SHALL NOT bring the dots below 3:1 contrast against the card surface (WCAG 1.4.11) in the dark and light mode of every built-in palette. This floor applies to cards at full opacity. A card dimmed as a whole (hidden, or closing) dims its trigger together with all its other content.
  - **Reserved gutter:** the card SHALL reserve a right-hand gutter for the trigger. Every other card control and every subcard SHALL end at or left of the trigger's hit area.
  - **Full emphasis:** while the pointer is over the card, while the trigger has keyboard focus (`:focus-visible`), and while its menu is open.
  - **Hit area:** at least 24×24 CSS px. The part beyond the visible pill lies in the reserved gutter and SHALL NOT overlap any other control on the card, whatever the card's height or content.
  - **Activation:** what a click on the trigger does depends on the menu's state:
    - closed: it SHALL open the menu as a click-opened menu;
    - open from the trigger, right-click or keyboard: it SHALL close the menu;
    - opened by the hover strip: it SHALL NOT close the menu. Instead it SHALL convert it to a click-opened menu, which then stays open when the pointer leaves, with focus handled as for a trigger click-open. A further click closes it.
  - **Glyph:** SHALL differ from the folder actions menu's trigger and from every other menu trigger rendered on the card.
  - **Tab order:** the trigger SHALL be reachable with Tab and SHALL come after the card's other focusable controls.
- **Hover strip:** a hover-intent zone along the card's right edge (see "Hover strip opens the menu only on deliberate dwell").
- **Right-click:** a `contextmenu` event on the card, which SHALL open the menu at the pointer and suppress the browser context menu. This SHALL NOT happen when:
  - the event target is a link or a text input (including the inline rename input);
  - the user has a non-empty text selection inside the card;
  - the card is being dragged.

  In those cases the browser's native menu SHALL appear.
- **Keyboard:** Shift+F10 or the ContextMenu key while keyboard focus is on an element inside the card that is not a text input. The card root itself does not need to be focusable.

Activating any entry point, and activating any item inside the menu, SHALL NOT select, navigate to, or start a drag of the card. Click, `contextmenu` and `keydown` events that originate inside the open menu SHALL NOT reach the card's own handlers, so they neither re-open nor move the menu. The mobile session card SHALL NOT render this menu.

#### Scenario: Trigger opens the menu
- **WHEN** the user clicks `session-actions-trigger-s1`
- **THEN** the session actions menu for `s1` SHALL open
- **AND** the trigger SHALL report `aria-expanded="true"`
- **AND** session `s1` SHALL NOT become selected as a result of the click

#### Scenario: Trigger sits centred on the card's right edge, not in the header
- **WHEN** desktop session card `s1` renders, as a minimal card and as a tall card with subcards
- **THEN** `session-actions-trigger-s1` SHALL NOT be a descendant of the card's header row
- **AND** the trigger's vertical centre SHALL be within 1 px of the card's vertical centre
- **AND** the trigger's horizontal span SHALL contain the card's right border x-coordinate

#### Scenario: Trigger is visible at rest and emphasised on hover
- **WHEN** desktop session card `s1` renders and the pointer is not over it
- **THEN** `session-actions-trigger-s1` SHALL be visible (non-zero opacity and not `visibility: hidden`) at reduced emphasis
- **WHEN** the pointer moves over card `s1`
- **THEN** the trigger SHALL render at full emphasis

#### Scenario: Trigger stays emphasised while its menu is open or it has focus
- **WHEN** the session actions menu of `s1` is open, or `session-actions-trigger-s1` has keyboard focus via Tab
- **THEN** the trigger SHALL render at full emphasis regardless of pointer position

#### Scenario: Trigger is reachable on touch devices
- **WHEN** the device does not match `(hover: hover) and (pointer: fine)` and desktop session card `s1` renders
- **THEN** `session-actions-trigger-s1` SHALL be visible
- **AND** tapping it SHALL open the session actions menu for `s1`

#### Scenario: Trigger hit area meets the minimum target size
- **WHEN** desktop session card `s1` renders
- **THEN** the trigger's clickable area SHALL be at least 24×24 CSS px
- **AND** it SHALL NOT overlap the Exit ✕ button, the Archive button, or any other control on the card
- **AND** clicking anywhere inside that 24×24 area, including the part beyond the visible pill, SHALL toggle the menu
- **AND** this SHALL hold for a minimal card (title, status and model rows only), for a card with an attached change, dirty and PR pills, and for a card with a PROCESS row

#### Scenario: Faint trigger still meets non-text contrast
- **WHEN** desktop session card `s1` renders at rest and undimmed, in the dark and light mode of each built-in palette
- **THEN** the contrast ratio between the trigger's dots and the card surface SHALL be at least 3:1

#### Scenario: Clicking the trigger pins a hover-opened menu
- **WHEN** the session actions menu of `s1` was opened by the hover strip and the user clicks `session-actions-trigger-s1`
- **THEN** the menu SHALL stay open
- **AND** `aria-expanded` SHALL remain `"true"`
- **AND** moving the pointer outside the card, gap and menu for longer than the hover close grace period SHALL NOT close it
- **WHEN** the user clicks `session-actions-trigger-s1` again
- **THEN** the menu SHALL close

#### Scenario: Resting on the trigger does not auto-open the menu
- **WHEN** the pointer rests on `session-actions-trigger-s1`, either on the visible pill or on its invisible hit area, for 500 ms below the hover speed cutoff without clicking
- **THEN** the hover strip SHALL NOT open the menu
- **AND** a click on the trigger SHALL then open it

#### Scenario: Right-click opens the same menu at the pointer
- **WHEN** the user right-clicks a non-link area of session card `s1` at viewport point (150, 440)
- **THEN** the browser context menu SHALL NOT appear
- **AND** the session actions menu for `s1` SHALL open with its top-left corner at (150, 440), clamped to stay inside the viewport
- **AND** its items SHALL be identical to those shown when it is opened from the trigger

#### Scenario: Right-click on a link keeps the native menu
- **WHEN** the user right-clicks the PR link on session card `s1`
- **THEN** the browser's native context menu SHALL appear
- **AND** no session actions menu SHALL open

#### Scenario: Keyboard opens the menu from inside the card
- **WHEN** keyboard focus is on the Archive button of session card `s1` and the user presses Shift+F10
- **THEN** the session actions menu for `s1` SHALL open and focus its first enabled item

#### Scenario: Mobile card has no session actions menu
- **WHEN** the session list renders in the mobile layout
- **THEN** no `session-actions-trigger-*` SHALL render and right-clicking a card SHALL NOT open a session actions menu
