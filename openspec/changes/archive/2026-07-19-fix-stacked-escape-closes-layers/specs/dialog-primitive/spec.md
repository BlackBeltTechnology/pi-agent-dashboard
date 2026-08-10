## MODIFIED Requirements

### Requirement: Dismissal

The dialog SHALL invoke its `onClose` callback when the user clicks the overlay or presses Escape, and SHALL leave final dismissal to the controlling parent. Escape dismissal SHALL be routed through the shared escape-dismiss stack: the dialog's `onClose` SHALL fire on Escape **only when the dialog is the topmost registered dismissible layer**, so an overlay opened above the dialog consumes the Escape first and the dialog stays open.

#### Scenario: Overlay click dismisses

- **WHEN** the user clicks the backdrop overlay behind the dialog panel
- **THEN** `onClose` is called

#### Scenario: Escape key dismisses

- **WHEN** the dialog is open, is the topmost dismissible layer, and the user presses the `Escape` key
- **THEN** `onClose` is called

#### Scenario: Escape over a stacked overlay does not close the dialog

- **WHEN** the dialog is open and a full-screen overlay (image lightbox, file preview, focused diagram) is open above it
- **AND** the user presses `Escape`
- **THEN** only the overlay is dismissed
- **AND** the dialog's `onClose` is NOT called

#### Scenario: Open state is controlled by the parent

- **WHEN** `onClose` fires from overlay click or Escape
- **THEN** the dialog does not close itself; it stays open until the parent sets `open` to false
