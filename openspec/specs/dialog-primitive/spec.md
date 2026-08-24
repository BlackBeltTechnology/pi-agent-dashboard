# dialog-primitive Specification

## Purpose

Provide a portal-mounted modal dialog primitive that renders above all page content with an overlay, contains keyboard focus, exposes correct modal ARIA semantics, and supports size and intent variants. Two presets build on it: a Confirm dialog for title/message/confirm-cancel decisions and a SearchableSelect dialog for filtering and picking from an option list.
## Requirements
### Requirement: Portal Mounting and Body Scroll Lock

The dialog SHALL render into a portal attached to the document body and prevent background page scrolling while open.

#### Scenario: Dialog mounts into document body

- **WHEN** the dialog is rendered with `open` true
- **THEN** its content is mounted via a portal appended to `document.body`, outside the normal component subtree
- **AND** the dialog container is fixed and centered over the full viewport

#### Scenario: Background scroll is locked while open

- **WHEN** the dialog portal mounts
- **THEN** `document.body` overflow is set to `hidden`
- **AND** the previous overflow value is restored when the dialog unmounts

#### Scenario: Closed dialog renders nothing

- **WHEN** `open` is false
- **THEN** the dialog renders nothing and mounts no portal

### Requirement: Dismissal

The dialog SHALL invoke its `onClose` callback when the user clicks the overlay, presses Escape, or activates the built-in ✕ close control, and SHALL leave final dismissal to the controlling parent. Escape dismissal SHALL be routed through the shared escape-dismiss stack: the dialog's `onClose` SHALL fire on Escape **only when the dialog is the topmost registered dismissible layer**, so an overlay opened above the dialog consumes the Escape first and the dialog stays open.

The built-in ✕ SHALL NOT be rendered when the dialog is in flush body mode, because a self-framed child renders its own header and dismissal affordance and the panel reserves no space for the control in that mode. A `showClose` opt-in SHALL restore it for a flush child that renders no header of its own.

A flush child that renders NO focusable element of its own SHALL set `showClose`. Without it the dialog satisfies the focus requirement only via the container fallback, leaving keyboard users no focusable target and no visible dismissal. This is the specified purpose of the opt-in.

#### Scenario: Overlay click dismisses

- **WHEN** the user clicks the overlay
- **THEN** `onClose` is called

#### Scenario: Escape key dismisses

- **WHEN** the dialog is open, is the topmost dismissible layer, and the user presses the `Escape` key
- **THEN** `onClose` is called

#### Scenario: Escape over a stacked overlay does not close the dialog

- **GIVEN** an overlay registered above the dialog on the shared escape-dismiss stack
- **WHEN** the user presses `Escape`
- **THEN** the overlay consumes the key and the dialog's `onClose` SHALL NOT be called

#### Scenario: Open state is controlled by the parent

- **WHEN** `onClose` fires from any dismissal source
- **THEN** the dialog SHALL NOT close itself; the controlling parent decides whether to unmount it

#### Scenario: Built-in close control dismisses a padded dialog

- **WHEN** a dialog not in flush body mode renders and the user activates its ✕ control
- **THEN** `onClose` is called

#### Scenario: Flush body mode omits the built-in close control

- **WHEN** a dialog is in flush body mode without `showClose`
- **THEN** the panel SHALL NOT render its built-in ✕, so no panel-owned control overlaps the child's own header controls

#### Scenario: Flush body mode can opt the close control back in

- **WHEN** a dialog is in flush body mode with `showClose`
- **THEN** the panel SHALL render its built-in ✕

### Requirement: Focus Containment

The dialog SHALL move focus into itself on open, trap Tab and Shift+Tab within its focusable elements, and restore focus to the previously focused element on close.

When the dialog has no focusable descendant at the moment it opens, it SHALL keep watching its own subtree and move focus to the first focusable descendant that appears, at most once, and only while focus is still on the dialog container. A child that renders its controls asynchronously would otherwise strand focus on a non-interactive box: the built-in ✕ used to guarantee a non-empty focusable set, and suppressing it under `flush` removes that guarantee.

#### Scenario: Initial focus moves into the dialog

- **WHEN** the dialog transitions to open
- **THEN** focus moves to the first focusable descendant (matching links, enabled buttons/inputs/textareas/selects, or elements with a non-negative tabindex)
- **AND** if no focusable descendant exists, focus moves to the dialog container itself

#### Scenario: Focus moves to a late-arriving focusable descendant

- **GIVEN** a dialog that opened with no focusable descendant, so focus is on the dialog container
- **WHEN** a focusable descendant first appears
- **THEN** focus SHALL move to it
- **AND** the dialog SHALL NOT move focus again for later descendants, nor take focus back from the user

#### Scenario: Hidden and aria-hidden elements are excluded from focus

- **WHEN** the dialog selects an initial or trapped focus target
- **THEN** elements carrying the `hidden` attribute or `aria-hidden="true"` are excluded from the focusable set, even when they match the focusable selector

#### Scenario: Tab cycles forward within the dialog

- **WHEN** focus is on the last focusable element and the user presses `Tab`
- **THEN** focus wraps to the first focusable element

#### Scenario: Shift+Tab cycles backward within the dialog

- **WHEN** focus is on the first focusable element and the user presses `Shift+Tab`
- **THEN** focus wraps to the last focusable element

#### Scenario: Tab is contained when no focusable element exists

- **WHEN** the dialog has no focusable descendants and the user presses `Tab`
- **THEN** the default tab behavior is prevented and focus stays on the dialog container

#### Scenario: Focus is restored on close

- **WHEN** the dialog closes or unmounts
- **THEN** focus returns to the element that was focused before the dialog opened, provided it is still in the document

### Requirement: Modal ARIA Semantics

The dialog SHALL expose modal dialog semantics and an accessible name derived from its title or an explicit label.

#### Scenario: Modal dialog role and modality

- **WHEN** the dialog is open
- **THEN** the dialog panel has role `dialog` and `aria-modal` set to `true`

#### Scenario: Accessible name from title

- **WHEN** a `title` is provided
- **THEN** the title is rendered as a heading and the dialog references it via `aria-labelledby`

#### Scenario: Accessible name without a title

- **WHEN** no `title` is provided
- **THEN** the dialog uses the provided `ariaLabel` as its `aria-label`

### Requirement: Header with Title and Icon

The dialog SHALL render a header region when a title or a leading icon is provided, showing the optional icon alongside the optional title.

#### Scenario: Header shows when title or icon is present

- **WHEN** either a `title` or an `icon` prop is provided
- **THEN** a header region is rendered above the body content
- **AND** when neither is provided, no header region is rendered

#### Scenario: Leading icon in the header

- **WHEN** an `icon` prop (an mdi path string) is provided
- **THEN** the icon is rendered in a leading badge within the header, alongside the title when a title is also present

### Requirement: Size and Intent Variants

The dialog SHALL support discrete size variants that control maximum width and height, and footer actions SHALL support discrete intent variants.

#### Scenario: Size variants

- **WHEN** a `size` of `sm`, `md`, `lg`, or `full` is set (defaulting to `md`)
- **THEN** the panel applies the corresponding maximum width and height constraint, with `full` allowing a wider and taller stage than the other sizes

#### Scenario: Action intent variants

- **WHEN** a footer action is rendered with an `intent` of `primary`, `danger`, or `neutral` (defaulting to `primary`)
- **THEN** the action button applies the styling for that intent

#### Scenario: Disabled action

- **WHEN** a footer action is marked disabled
- **THEN** the button is non-interactive and visually de-emphasized

### Requirement: Flush Body Mode

The dialog SHALL support an edge-to-edge body mode that drops the inner padding, clips its own overflow, and establishes a flex column formatting context so a self-framed child fills the dialog as a single window and manages its own scroll.

The flex context is load-bearing, not cosmetic. The panel carries a height cap but no definite height, so a child sized with a percentage height resolves against an indefinite parent, falls back to `auto`, and grows to its content — leaving the child's own scroll container unbounded and therefore never a scroller, while the panel's `overflow-hidden` clips the surplus away unreachably. A cap-constrained flex column bounds the child without any element needing a definite height.

A flush child SHALL size itself as a flex item permitted to shrink below its content (`flex-1 min-h-0`), not with a percentage height.

#### Scenario: Flush drops padding and clips overflow

- **WHEN** the `flush` prop is true
- **THEN** the panel omits the default inner padding and scrolling body layout and instead clips overflow (`overflow-hidden`) so the child renders edge-to-edge

#### Scenario: Flush establishes a flex column

- **WHEN** the `flush` prop is true
- **THEN** the panel SHALL be a flex column permitting its child to shrink below content size

#### Scenario: Tall flush content remains reachable

- **GIVEN** a flush dialog whose child sizes itself `flex-1 min-h-0` and owns an internal scroll container
- **WHEN** the child's content exceeds the panel's height cap
- **THEN** the panel SHALL clamp at its cap **and** the child SHALL become a working scroller, so no content is unreachable

#### Scenario: Short flush content shrinks to fit

- **GIVEN** a flush dialog whose content is shorter than the panel's height cap
- **WHEN** it is rendered
- **THEN** the panel SHALL size to its content and SHALL NOT expand to the cap

#### Scenario: Default padded body

- **WHEN** `flush` is false or omitted
- **THEN** the panel applies inner padding and a vertically scrollable body

### Requirement: Confirm Preset

The Confirm dialog SHALL present a title, message, optional body, and confirm/cancel actions, delegating all dialog chrome to the dialog primitive without auto-closing on confirm.

#### Scenario: Confirm and cancel actions

- **WHEN** the Confirm dialog is open
- **THEN** it renders the title, the message text, an optional body, a cancel button, and a confirm action button
- **AND** clicking cancel calls `onClose` and clicking confirm calls `onConfirm`

#### Scenario: Confirm does not auto-dismiss

- **WHEN** the user clicks the confirm action
- **THEN** `onConfirm` is invoked and the dialog remains open until the caller sets `open` to false

#### Scenario: Confirm honors intent and labels

- **WHEN** an `intent`, `confirmLabel`, or `cancelLabel` is provided
- **THEN** the confirm action uses that intent and the buttons use those labels (defaulting to `Confirm` and `Cancel`)

### Requirement: SearchableSelect Preset

The SearchableSelect dialog SHALL let the user filter a list of options by text and choose one via keyboard or pointer, with keyboard highlight navigation.

#### Scenario: Autofocus the search input

- **WHEN** the SearchableSelect dialog opens
- **THEN** the search text input receives focus

#### Scenario: Filter options by query

- **WHEN** the user types a query
- **THEN** the list is filtered to options whose label or description contains the query, case-insensitively
- **AND** an empty-state message is shown when no options match

#### Scenario: Keyboard highlight navigation

- **WHEN** the user presses `ArrowDown` or `ArrowUp` in the input
- **THEN** the highlighted option index moves down or up, clamped within the filtered list, and the highlighted item is scrolled into view

#### Scenario: Hover updates the highlight

- **WHEN** the pointer enters an option (onMouseEnter)
- **THEN** the highlighted index moves to that option's position in the filtered list

#### Scenario: Selection commits a value

- **WHEN** the user presses `Enter` on a highlighted option or clicks an option
- **THEN** `onSelect` is called with that option's value

#### Scenario: Highlight resets on filter change

- **WHEN** the filtered result set changes
- **THEN** the highlighted index resets to the first item

#### Scenario: Option badge rendering

- **WHEN** an option provides a `badge`
- **THEN** the badge label is rendered on the option row, using the option's `badgeColor` class when provided and a default muted color otherwise

#### Scenario: Footer keyboard hint

- **WHEN** the SearchableSelect dialog is open
- **THEN** a footer hint reads "↑↓ navigate · Enter select · Esc cancel"

#### Scenario: Cancel dismisses the select

- **WHEN** the user dismisses the dialog via overlay click or Escape
- **THEN** `onCancel` is called

