## MODIFIED Requirements

### Requirement: Preview overlay does not block the composer

The file/URL preview overlay SHALL be a non-blocking inspector: while it is open, the chat composer (textarea and all its controls, including the send button) SHALL remain interactive. The overlay's dimming backdrop SHALL NOT intercept pointer events over the composer region, so a user can send a new prompt without first dismissing the preview. Explicit dismissal (Esc, close button, backdrop click outside the panel) SHALL still close the overlay.

This preserves the companion invariant (change `fix-file-preview-survives-message-churn`): the overlay stays open with its content intact across a new message, streaming tokens, and the streaming→committed transition.

#### Scenario: Send a prompt while a preview is open

- **WHEN** a file preview overlay is open
- **AND** the user types a prompt into the composer and clicks the send button
- **THEN** the prompt SHALL be sent (the send-button click SHALL NOT be intercepted by the preview backdrop)
- **AND** the overlay SHALL remain open with its content intact

#### Scenario: Explicit dismissal still closes the overlay

- **WHEN** a file preview overlay is open
- **AND** the user presses Escape
- **THEN** the overlay SHALL close
