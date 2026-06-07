## ADDED Requirements

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

The `Dialog` SHALL invoke `onClose` for three dismissal sources: the
`Esc` key, a click on the overlay (the area outside the dialog
container), and any explicit consumer-rendered cancel control.

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

### Requirement: Dialog focus management

When a `Dialog` opens it SHALL move focus into the dialog and trap
keyboard focus within it; when it closes it SHALL restore focus to the
element that was focused before the dialog opened.

#### Scenario: Initial focus on open

- **WHEN** a `Dialog` transitions from `open={false}` to `open={true}`
- **THEN** focus SHALL move to the first focusable element inside the
  dialog, or to the dialog container itself if no focusable child exists

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

The `Dialog` SHALL accept `size="sm" | "md" | "lg"` (default `md`),
mapping to `max-w-sm`, `max-w-md`, `max-w-lg` respectively, with
`max-h-[80vh]` and internal scroll when content exceeds the viewport.

#### Scenario: Default size

- **WHEN** a `Dialog` is rendered without `size`
- **THEN** the container SHALL apply `max-w-md`

#### Scenario: Explicit small size

- **WHEN** a `Dialog` is rendered with `size="sm"`
- **THEN** the container SHALL apply `max-w-sm`

#### Scenario: Explicit large size

- **WHEN** a `Dialog` is rendered with `size="lg"`
- **THEN** the container SHALL apply `max-w-lg`

#### Scenario: Tall content scrolls inside

- **WHEN** a `Dialog`'s body content exceeds `80vh`
- **THEN** the container SHALL apply `max-h-[80vh]` with internal
  `overflow-y-auto`, leaving the overlay non-scrolling

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

- **WHEN** a `Dialog` is rendered with `testId="jj-forget"`
- **THEN** the dialog container SHALL have `data-testid="jj-forget"` and
  the overlay SHALL have `data-testid="jj-forget-overlay"`
