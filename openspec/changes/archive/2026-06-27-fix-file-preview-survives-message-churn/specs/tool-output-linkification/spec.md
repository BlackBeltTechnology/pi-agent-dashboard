# tool-output-linkification — delta

## ADDED Requirements

### Requirement: Preview overlay persists across message re-renders

The in-dashboard file preview overlay (`FilePreviewOverlay`) SHALL remain open
across chat message updates until the user explicitly dismisses it (Esc,
backdrop click, or close button) or leaves the chat view. The overlay's
open-state SHALL be owned by a provider mounted **above** the chat message list
(`FilePreviewProvider` at `ChatView` scope), not by the leaf `FileLink`. A
`FileLink` click SHALL dispatch an open request to that provider rather than
holding its own preview state. At most one preview overlay SHALL be rendered at
a time.

#### Scenario: New message does not close an open preview

- **GIVEN** a file link in chat is clicked and the preview overlay is open
- **WHEN** a new chat message arrives in the same chat view
- **THEN** the preview overlay SHALL remain open and unchanged

#### Scenario: Streaming token does not close an open preview

- **GIVEN** the preview overlay is open for a file referenced in the in-flight
  assistant message
- **WHEN** the assistant message streams additional tokens (re-rendering its
  markdown content)
- **THEN** the preview overlay SHALL remain open

#### Scenario: Streaming-to-committed transition does not close an open preview

- **GIVEN** the preview overlay is open while an assistant message is streaming
- **WHEN** that assistant message completes and transitions from the live
  streaming render to its committed (`key=msg.id`) render
- **THEN** the preview overlay SHALL remain open

#### Scenario: Single overlay instance

- **GIVEN** a preview overlay is open for file A
- **WHEN** the user clicks a different file link B
- **THEN** exactly one overlay SHALL be rendered, now showing file B

#### Scenario: Explicit dismissal still closes

- **GIVEN** the preview overlay is open
- **WHEN** the user presses Esc, clicks the backdrop, or clicks the close button
- **THEN** the preview overlay SHALL close
