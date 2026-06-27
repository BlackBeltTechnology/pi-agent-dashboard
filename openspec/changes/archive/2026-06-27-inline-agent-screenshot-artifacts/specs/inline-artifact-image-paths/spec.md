# inline-artifact-image-paths — delta

## ADDED Requirements

### Requirement: the bridge SHALL inline path-referenced image results at capture time

At `tool_execution_end`, the bridge SHALL detect tool-result text that references an existing local image file by absolute path (recognized image extension) and SHALL attach the image as a `type:"image"` content block on the forwarded result, reusing the existing image-inlining helpers and byte caps. An inlined path SHALL NOT also be emitted as a text path-link for the same image. A referenced path that does not exist, is not a recognized image extension, exceeds `MAX_PER_IMAGE_BYTES`, or would push the result past `MAX_PER_MESSAGE_BYTES` SHALL be left as text (so it falls back to the artifact-serving route).

#### Scenario: screenshot path is inlined as an image block

- **GIVEN** a tool result whose text contains `Screenshot saved: <abs>/shot.png` and `shot.png` exists and is under `MAX_PER_IMAGE_BYTES`
- **WHEN** the bridge extracts the result at `tool_execution_end`
- **THEN** the forwarded result SHALL carry a `type:"image"` content block for `shot.png`
- **AND** no path-link SHALL be emitted for that image

#### Scenario: over-cap image is left as a link

- **GIVEN** a referenced image file larger than `MAX_PER_IMAGE_BYTES`
- **WHEN** the bridge extracts the result
- **THEN** the path SHALL remain as text (no image block)
- **AND** it SHALL be served by the artifact-serving fallback route instead

#### Scenario: non-existent or non-image path is untouched

- **WHEN** a tool result references an absolute path that does not exist, or whose extension is not a recognized image type
- **THEN** the bridge SHALL NOT attach an image block and SHALL leave the text unchanged

### Requirement: the dashboard SHALL render inlined image blocks for any tool, auto-expanded

The dashboard tool-call renderer SHALL display `type:"image"` content blocks from any tool result (not only the `Read` tool) as inline images, and SHALL auto-expand a tool call that carries an inlined image.

#### Scenario: browser screenshot renders inline

- **GIVEN** a `browser` (or bash) tool result carrying an inlined `type:"image"` block
- **WHEN** the dashboard renders the tool call
- **THEN** it SHALL show an inline image, auto-expanded
- **AND** it SHALL NOT show a "Failed to load image" error or a dead path-link for that image
