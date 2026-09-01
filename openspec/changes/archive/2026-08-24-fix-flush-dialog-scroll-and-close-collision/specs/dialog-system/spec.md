## MODIFIED Requirements

### Requirement: Dialog flush (edge-to-edge) body

The `Dialog` SHALL accept `flush?: boolean` (default `false`). When `true`,
the container SHALL drop its inner padding (`p-5 space-y-4`), clip its own
overflow (`overflow-hidden`) instead of `overflow-y-auto`, and establish a
**flex column formatting context** (`flex flex-col` with `min-h-0`) so a
self-framed child (one that renders its own header + scrollable body) fills the
dialog as a single window and manages its own scroll.

The flex context is what makes the child's scroll contract satisfiable. The
container carries a `max-h` cap but no definite height, so a child sized with a
percentage height (`h-full`) resolves against an indefinite parent, falls back
to `auto`, and grows to its content — leaving the child's own `overflow-y-auto`
unbounded and therefore never a scroller, with the surplus clipped away
unreachably by the container's `overflow-hidden`. A `max-h`-constrained flex
column bounds the child without any element needing a definite height, so short
content still shrinks to fit and tall content scrolls.

A flush child SHALL therefore size itself with `flex-1 min-h-0`, not `h-full`.

When `false`, padding + internal scroll are unchanged.

#### Scenario: Flush drops padding

- **WHEN** a `Dialog` is rendered with `flush`
- **THEN** the container SHALL apply `overflow-hidden` and SHALL NOT apply
  `p-5`

#### Scenario: Flush establishes a flex column

- **WHEN** a `Dialog` is rendered with `flush`
- **THEN** the container SHALL be a flex column that permits its child to
  shrink below content size (`min-h-0`)

#### Scenario: Tall flush content scrolls rather than clipping

- **GIVEN** a flush `Dialog` whose child sizes itself `flex-1 min-h-0` and
  carries an internal `overflow-y-auto`
- **WHEN** the child's content exceeds the container's `max-h` cap
- **THEN** the container SHALL clamp at its cap **and** the child SHALL become
  a working scroller, so no content is unreachable

#### Scenario: Short flush content still shrinks to fit

- **GIVEN** a flush `Dialog` whose content is shorter than its `max-h` cap
- **WHEN** it is rendered
- **THEN** the container SHALL size to its content and SHALL NOT expand to the
  cap

#### Scenario: Non-flush keeps padding + scroll

- **WHEN** a `Dialog` is rendered without `flush`
- **THEN** the container SHALL apply `p-5` and `overflow-y-auto`

### Requirement: Dialog dismissal sources

The `Dialog` SHALL invoke `onClose` for these dismissal sources: the `Esc`
key, a click on the overlay (the area outside the dialog container), any
explicit consumer-rendered cancel control, and — except when suppressed below —
a built-in ✕ close control the container renders at its top-right corner.

The built-in ✕ SHALL NOT be rendered when `flush` is set. A flush child is by
definition self-framed and renders its own header and back affordance, so the
built-in ✕ would be a duplicate dismissal affordance occupying a corner the
container does not reserve — producing a control that overlaps whatever the
child places there. A `showClose?: boolean` opt-in SHALL restore the ✕ for a
flush child that renders no header of its own.

A flush child that renders NO focusable element of its own SHALL set
`showClose`. Without it the dialog satisfies the focus requirement only via the
container fallback, leaving keyboard users no focusable target and no visible
dismissal. This is the specified purpose of the opt-in.

Suppressing the ✕ SHALL NOT weaken any dismissal guard: `Esc` and overlay
click remain, and a self-framed child's own back affordance is the child's
responsibility to route.

#### Scenario: Esc dismisses

- **WHEN** the user presses `Esc` while a `Dialog` is open
- **THEN** the dialog's `onClose` SHALL be called exactly once

#### Scenario: Overlay click dismisses

- **WHEN** the user clicks the overlay region (outside the dialog
  container)
- **THEN** the dialog's `onClose` SHALL be called exactly once

#### Scenario: Click on container does not dismiss

- **WHEN** the user clicks anywhere inside the dialog container (header,
  body, footer)
- **THEN** the dialog's `onClose` SHALL NOT be called

#### Scenario: Non-flush dialog renders the built-in close control

- **WHEN** a `Dialog` is rendered without `flush`
- **THEN** the container SHALL render a ✕ control whose activation calls
  `onClose` exactly once

#### Scenario: Flush dialog suppresses the built-in close control

- **WHEN** a `Dialog` is rendered with `flush` and without `showClose`
- **THEN** the container SHALL NOT render its built-in ✕, so nothing of the
  container's overlaps the child's own header controls

#### Scenario: Flush dialog can opt the close control back in

- **WHEN** a `Dialog` is rendered with both `flush` and `showClose`
- **THEN** the container SHALL render its built-in ✕

### Requirement: Dialog focus management

When a `Dialog` opens it SHALL move focus into the dialog and trap
keyboard focus within it; when it closes it SHALL restore focus to the
element that was focused before the dialog opened.

When the dialog opens with NO focusable child, it SHALL keep watching its own
subtree and move focus to the first focusable child that appears — at most
once, and only while focus is still on the container. Suppressing the built-in
✕ under `flush` removed the guarantee that a focusable child always existed at
open time, and a surface that renders its controls asynchronously would
otherwise strand focus on a non-interactive box.

#### Scenario: Initial focus on open

- **WHEN** a `Dialog` transitions from `open={false}` to `open={true}`
- **THEN** focus SHALL move to the first focusable element inside the
  dialog, or to the dialog container itself if no focusable child exists

#### Scenario: Focus follows a late-arriving focusable child

- **GIVEN** a `Dialog` that opened with no focusable child, leaving focus on
  the container
- **WHEN** a focusable child first appears
- **THEN** focus SHALL move to it, once, and SHALL NOT be taken back from the
  user afterwards

#### Scenario: Focus trap on Tab

- **WHEN** the user presses `Tab` while focus is on the last focusable
  element inside the dialog
- **THEN** focus SHALL move to the first focusable element inside the
  dialog (not to elements outside)

#### Scenario: Focus trap on Shift+Tab

- **WHEN** the user presses `Shift+Tab` while focus is on the first
  focusable element inside the dialog
- **THEN** focus SHALL move to the last focusable element inside the
  dialog

#### Scenario: Focus restore on close

- **WHEN** a `Dialog` transitions from `open={true}` to `open={false}`
- **THEN** focus SHALL be restored to the element that was focused
  immediately before the dialog opened, if that element is still in the
  document
