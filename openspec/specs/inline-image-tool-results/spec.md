# inline-image-tool-results Specification

## Purpose

Makes images produced by tools visible in the chat rather than reduced to opaque tool output. Requires the event reducer to extract image blocks from live tool results and the replay path to extract them from persisted sessions, so a reloaded session shows the same images as a live one.

## Requirements

### Requirement: Event reducer extracts images from tool results
The client event reducer SHALL extract `type: "image"` content blocks from `tool_execution_end` event data (from `data.result.content`) and store them as `images` on the corresponding `ChatMessage`. The existing `ChatImage` type (`{data: string, mimeType: string}`) SHALL be reused.

#### Scenario: Tool result with image populates ChatMessage.images
- **WHEN** a `tool_execution_end` event arrives with `result.content` containing `{type: "image", data: "abc", mimeType: "image/png"}`
- **THEN** the corresponding ChatMessage SHALL have `images: [{data: "abc", mimeType: "image/png"}]`

#### Scenario: Tool result without images leaves field undefined
- **WHEN** a `tool_execution_end` event arrives with `result.content` containing only `{type: "text"}` blocks
- **THEN** the corresponding ChatMessage SHALL NOT have an `images` field

#### Scenario: Multiple image blocks are all extracted
- **WHEN** a `tool_execution_end` event has two `type: "image"` content blocks
- **THEN** the ChatMessage SHALL include both images in the `images` array

### Requirement: State replay extracts image blocks from persisted sessions
The `state-replay` module SHALL extract `type: "image"` content blocks from persisted `toolResult` messages alongside existing text extraction. Extracted images SHALL be emitted as an `images` field on the synthesized `tool_execution_end` event data.

#### Scenario: Replayed session with image tool result
- **WHEN** a persisted toolResult message contains `content: [{type: "image", data: "<base64>", mimeType: "image/png"}, {type: "text", text: "Read image file"}]`
- **THEN** the synthesized `tool_execution_end` event SHALL include `data.images: [{data: "<base64>", mimeType: "image/png"}]` and `data.result: "Read image file"`

#### Scenario: Replayed session with text-only tool result
- **WHEN** a persisted toolResult message contains only `type: "text"` content blocks
- **THEN** the synthesized `tool_execution_end` event SHALL NOT include an `images` field
