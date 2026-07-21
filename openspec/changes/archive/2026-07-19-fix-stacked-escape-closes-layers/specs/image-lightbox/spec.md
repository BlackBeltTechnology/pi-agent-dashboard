## MODIFIED Requirements

### Requirement: Close lightbox with Escape key

The lightbox dialog SHALL close when the user presses the Escape key. Escape dismissal SHALL be routed through the shared escape-dismiss stack so that, when the lightbox is opened above another dismissible surface (a dialog, another overlay), one Escape closes **only the lightbox** and leaves the surface beneath it open.

#### Scenario: Press Escape to close

- **WHEN** the lightbox is open and user presses Escape
- **THEN** the lightbox closes and the previously visible surface is visible again

#### Scenario: Escape does not close the underlying dialog

- **WHEN** the lightbox was opened from within an open dialog (e.g. a pasted-image thumbnail in the Explore dialog)
- **AND** the user presses Escape
- **THEN** only the lightbox closes
- **AND** the underlying dialog remains open
- **AND** a second Escape then closes the dialog
