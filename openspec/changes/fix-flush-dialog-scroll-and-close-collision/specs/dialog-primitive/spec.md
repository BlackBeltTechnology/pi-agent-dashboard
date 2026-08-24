## MODIFIED Requirements

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
