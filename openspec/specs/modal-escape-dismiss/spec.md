# modal-escape-dismiss Specification

## Purpose

Shared global Escape-key dismissal contract for stacked, portaled overlay surfaces (dialogs, image lightbox, file preview). A single module-stable listener routes Escape to a LIFO stack so one press dismisses only the topmost registered layer, never more than one — preventing stacked surfaces from closing together. Layers register while open and unregister by identity when they close.

## Requirements
### Requirement: Topmost-only Escape dismissal

The application SHALL arbitrate global Escape-key dismissal through a **single shared listener** so that pressing Escape dismisses only the **topmost** registered dismissible layer, never more than one registered layer per keypress. Because all participating layers share one listener, topmost-only dismissal is enforced by the stack itself and does not depend on out-competing other DOM listeners. A stack-eligible layer (a portaled, focus-trapping or viewport-covering surface — e.g. dialog, image lightbox, file-preview overlay) SHALL register itself with the stack while open and SHALL unregister when it closes.

#### Scenario: Escape dismisses only the top layer

- **WHEN** two dismissible layers are open, layer B stacked above layer A
- **AND** the user presses Escape once
- **THEN** only layer B's dismiss handler is invoked
- **AND** layer A remains open

#### Scenario: Successive Escapes peel one layer at a time

- **WHEN** layers A then B then C are open (C topmost)
- **AND** the user presses Escape three times
- **THEN** the first Escape dismisses C, the second dismisses B, the third dismisses A

#### Scenario: Single layer still dismisses

- **WHEN** exactly one dismissible layer is open
- **AND** the user presses Escape
- **THEN** that layer's dismiss handler is invoked

### Requirement: Order-independent registration lifecycle

A layer SHALL unregister from the stack by its own identity, not by stack position, so that layers whose open/close lifecycles interleave (non-LIFO) do not leave stale entries or dismiss the wrong layer.

#### Scenario: Non-LIFO unregister targets the correct layer

- **WHEN** layers A and B are registered (B topmost) and A unregisters first
- **AND** the user then presses Escape
- **THEN** B's dismiss handler is invoked
- **AND** no stale entry for A remains

#### Scenario: The shared listener attaches once and is never duplicated

- **WHEN** layers register, all of them unregister, and a new layer then registers again
- **THEN** exactly one global keydown listener for Escape dismissal stays attached for the session
- **AND** it is attached once on the first registration, is NOT detached when the stack empties, and is never duplicated across the register→empty→register cycle

> Rationale: the listener stays attached (early-returns on an empty stack) rather than detaching on empty. Detaching would let another `document` listener slip ahead in registration order during an idle window and permanently sit in front of the stack. "No leak" here means exactly one listener that never accumulates — not zero.

#### Scenario: Latest handler is used without re-registration

- **WHEN** a registered layer's dismiss callback changes across re-renders
- **THEN** an Escape press invokes the latest callback
- **AND** the layer is not duplicated in the stack

### Requirement: Consume the Escape event when a layer is dismissed

When the stack dismisses a layer on Escape, it SHALL consume the event (`preventDefault` + `stopImmediatePropagation`). This reliably suppresses `window`-level keydown listeners and any `document`-bubble listener registered after the shared listener. It does NOT suppress a `document` listener registered before the shared listener (DOM fires same-target listeners in registration order) — this is a best-effort bound on interference with unmigrated listeners, not a hard guarantee, and the topmost-only correctness among stack-eligible layers does not depend on it. When the stack is empty, an Escape keypress SHALL pass through untouched.

#### Scenario: A co-registered global listener does not also fire

- **WHEN** a dismissible layer is registered and a separate global `window` keydown listener is also present
- **AND** the user presses Escape
- **THEN** only the topmost layer's dismiss handler runs
- **AND** the separate global listener does NOT fire for that keypress

#### Scenario: Empty stack does not swallow Escape

- **WHEN** no dismissible layer is registered
- **AND** the user presses Escape
- **THEN** the stack does not consume the event and it propagates normally

### Requirement: Do not dismiss when Escape is already handled or repeating

The stack SHALL NOT dismiss a layer when the Escape event is already handled by a focused element (`defaultPrevented` is true) or when the event is an auto-repeat (`repeat` is true). This keeps Escape-to-clear on a focused input/typeahead from also dismissing the surrounding layer, and prevents a held Escape key from peeling multiple layers in one press.

#### Scenario: Escape in a focused typeahead clears the field only

- **WHEN** a dismissible layer contains a focused typeahead whose own Escape handler calls `preventDefault`
- **AND** the user presses Escape
- **THEN** the stack does NOT dismiss the layer
- **AND** the surrounding layer stays open

#### Scenario: Held Escape peels one layer per press

- **WHEN** two layers are stacked and the user holds Escape so the browser emits auto-repeat keydown events
- **THEN** only the first (non-repeat) keydown dismisses the topmost layer
- **AND** auto-repeat events do not dismiss further layers

