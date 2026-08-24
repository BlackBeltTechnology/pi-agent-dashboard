## Purpose

Define the unified `Dialog` primitive: a single modal building block rendered through `DialogPortal`, with consistent dismissal sources, focus management, ARIA semantics, visual baseline, size variants, header slot, composable footer/action subcomponents, action button intents, and testId hooks.
## Requirements
### Requirement: Dialog primitive renders via DialogPortal

The `Dialog` component SHALL render its overlay and container as children
of `DialogPortal`, so every dialog inherits the portal's body-scroll-lock
and stacking-context-escape behaviour without each consumer wiring it.

#### Scenario: Dialog mounts inside DialogPortal

- **WHEN** a `Dialog` with `open={true}` is rendered
- **THEN** its DOM SHALL be a descendant of `document.body` (not of the
  React tree's ancestor stacking context)

#### Scenario: Dialog returns null when closed

- **WHEN** a `Dialog` is rendered with `open={false}`
- **THEN** no portal SHALL be mounted and no DOM SHALL be added to
  `document.body`

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

### Requirement: Dialog ARIA semantics

The `Dialog` container SHALL set `role="dialog"` and `aria-modal="true"`,
and SHALL set `aria-labelledby` to the id of its title element when a
title is provided.

#### Scenario: Role and modal flag

- **WHEN** a `Dialog` is open
- **THEN** the dialog container SHALL have attribute `role="dialog"` and
  `aria-modal="true"`

#### Scenario: Labelled by title

- **WHEN** a `Dialog` is rendered with a `title` prop
- **THEN** the dialog container SHALL have `aria-labelledby` pointing to
  the rendered title element's id

#### Scenario: No title, no labelledby

- **WHEN** a `Dialog` is rendered without a `title` prop
- **THEN** the dialog container SHALL NOT have an `aria-labelledby`
  attribute (consumers may instead pass `aria-label`)

### Requirement: Dialog visual baseline

The `Dialog` SHALL render with a single, consistent visual baseline:
overlay tint `bg-black/60`, container background
`var(--bg-primary)`, container border `var(--border-primary)`, rounded
corners, single fixed z-index layer at `z-[60]`.

#### Scenario: Overlay tint

- **WHEN** a `Dialog` is open
- **THEN** the overlay element SHALL have class `bg-black/60`

#### Scenario: Container chrome

- **WHEN** a `Dialog` is open
- **THEN** the dialog container SHALL apply `bg-[var(--bg-primary)]` and
  `border-[var(--border-primary)]`

#### Scenario: z-index layer

- **WHEN** a `Dialog` is open
- **THEN** the dialog root SHALL have z-index class `z-[60]`, layering
  above `MobileOverlay` (`z-50`)

### Requirement: Dialog size variants

The `Dialog` SHALL accept `size="sm" | "md" | "lg" | "full"` (default `md`),
mapping `sm`/`md`/`lg` to `max-w-sm`/`max-w-md`/`max-w-lg` and `full` to
`max-w-[95vw]`. The `sm`/`md`/`lg` variants apply `max-h-[80vh]`; the `full`
variant applies `max-h-[92vh]`. All variants use internal scroll when content
exceeds the height cap.

#### Scenario: Default size

- **WHEN** a `Dialog` is rendered without `size`
- **THEN** the container SHALL apply `max-w-md`

#### Scenario: Explicit small size

- **WHEN** a `Dialog` is rendered with `size="sm"`
- **THEN** the container SHALL apply `max-w-sm`

#### Scenario: Explicit large size

- **WHEN** a `Dialog` is rendered with `size="lg"`
- **THEN** the container SHALL apply `max-w-lg`

#### Scenario: Explicit full size

- **WHEN** a `Dialog` is rendered with `size="full"`
- **THEN** the container SHALL apply `max-w-[95vw]` and `max-h-[92vh]`

#### Scenario: Tall content scrolls inside

- **WHEN** a `Dialog`'s body content exceeds its height cap
- **THEN** the container SHALL apply its `max-h` (`80vh` for sm/md/lg,
  `92vh` for full) with internal `overflow-y-auto`, leaving the overlay
  non-scrolling

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

### Requirement: Dialog header slot

The `Dialog` SHALL render an optional header containing a title and an
optional leading icon (mdi path). The header is omitted entirely if
neither `title` nor `icon` is provided.

#### Scenario: Title only

- **WHEN** a `Dialog` is rendered with `title="Switch branch"` and no
  `icon`
- **THEN** the header SHALL render the title text without an icon slot

#### Scenario: Title and icon

- **WHEN** a `Dialog` is rendered with both `title` and an `icon` mdi path
- **THEN** the header SHALL render the icon in an accent-tinted square
  to the left of the title

#### Scenario: Neither title nor icon

- **WHEN** a `Dialog` is rendered without `title` and without `icon`
- **THEN** no header element SHALL be rendered

### Requirement: Dialog action button intents

The `Dialog.Action` button SHALL accept `intent="primary" | "danger" |
"neutral"` (default `primary`) and apply visually distinct styles per
intent.

#### Scenario: Primary intent uses accent

- **WHEN** a `Dialog.Action` is rendered with `intent="primary"` (or no
  intent)
- **THEN** the button SHALL apply `bg-[var(--accent-primary)]` with a
  hover state

#### Scenario: Danger intent uses red

- **WHEN** a `Dialog.Action` is rendered with `intent="danger"`
- **THEN** the button SHALL apply `bg-red-600` with `hover:bg-red-500`

#### Scenario: Neutral intent matches Cancel

- **WHEN** a `Dialog.Action` is rendered with `intent="neutral"`
- **THEN** the button SHALL apply the same border + transparent
  background as `Dialog.Cancel`

### Requirement: Dialog footer composition

The `Dialog` SHALL provide composable `Dialog.Footer`, `Dialog.Cancel`,
and `Dialog.Action` subcomponents. Consumers compose them; the primitive
imposes no fixed footer order.

#### Scenario: Footer renders supplied children

- **WHEN** a consumer renders `<Dialog.Footer><Dialog.Cancel/><Dialog.Action/></Dialog.Footer>`
- **THEN** the rendered footer SHALL contain those children, right-aligned,
  with consistent gap spacing

#### Scenario: Cancel calls onClose

- **WHEN** the user clicks `Dialog.Cancel`
- **THEN** the dialog's `onClose` SHALL be called

### Requirement: Dialog testId hooks

The `Dialog` SHALL accept a `testId` prop and apply it as `data-testid`
on the dialog container, with derived ids on overlay (`-overlay`),
cancel (`-cancel`), and action (`-action`) where present, so tests can
target dialog parts deterministically.

#### Scenario: testId propagation

- **WHEN** a `Dialog` is rendered with `testId="confirm-action"`
- **THEN** the dialog container SHALL have `data-testid="confirm-action"` and
  the overlay SHALL have `data-testid="confirm-action-overlay"`

