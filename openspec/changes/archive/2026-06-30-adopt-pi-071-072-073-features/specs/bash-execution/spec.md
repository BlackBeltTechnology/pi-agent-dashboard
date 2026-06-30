## ADDED Requirements

### Requirement: Show full output affordance for truncated tool results

When the chat view renders a `toolResult` whose text starts with the truncation marker (`«` U+00AB followed by `<N> earlier lines hidden»`), the UI SHALL render a "Show full output" affordance below the truncated text. Clicking it SHALL fetch the full result via `GET /api/sessions/:sessionId/tool-result/:toolCallId` and replace the rendered text with the full result in-place. Subsequent collapse SHALL re-show the truncated form.

When the endpoint returns 404 (tool call still in flight or evicted from the memory buffer), the UI SHALL render an inline message "result evicted" instead of the full text. The truncated text SHALL remain visible.

This affordance SHALL appear in both `ToolCallStep` and `BashOutputCard` renderers — they are the two places truncated results render today.

#### Scenario: Truncated bash result has Show full output
- **WHEN** a `BashOutputCard` renders text starting with `«300 earlier lines hidden»`
- **THEN** a "Show full output" button SHALL appear below the text

#### Scenario: Click fetches and replaces
- **WHEN** the user clicks "Show full output" and the endpoint returns the full result
- **THEN** the rendered text SHALL update to the full untruncated result

#### Scenario: Evicted result shows inline notice
- **WHEN** the endpoint returns 404 (evicted)
- **THEN** the rendered area SHALL show an inline "result evicted" notice
- **AND** the truncated text SHALL remain visible

#### Scenario: Non-truncated results have no affordance
- **WHEN** the rendered text does not start with the truncation marker (output was ≤ 200 lines)
- **THEN** no "Show full output" button SHALL render
