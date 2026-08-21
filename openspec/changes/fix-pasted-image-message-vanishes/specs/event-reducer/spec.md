## MODIFIED Requirements

### Requirement: User message rendering
A `message_start` event with role `"user"` SHALL create a new `ChatMessage` with `role: "user"`. Text content parts SHALL be concatenated. Image content parts SHALL be extracted into the `images` array.

Image content parts SHALL be recognized through the shared
`inline-image-block-shapes` detector, so BOTH accepted block shapes are extracted
identically: the flat pi shape `{ type: "image", data, mimeType }` and the nested
Anthropic shape `{ type: "image", source: { type: "base64", media_type, data } }`.
A block SHALL be admitted when it carries a non-empty mime AND either inline
base64 bytes or a non-empty two-phase `attachmentId`; the block's `data` and mime
SHALL be read through the shared accessors rather than by reading `data` /
`mimeType` directly. An admitted block's `attachmentId` and `attachmentState`
SHALL be carried onto the `ChatImage` when present, so a later
`attachment_fitted` event can fill the reserved position.

#### Scenario: User sends text message
- **WHEN** a `message_start` event with `role: "user"` and text content arrives
- **THEN** a new user ChatMessage SHALL be added to `messages`

#### Scenario: User sends message with images
- **WHEN** a `message_start` event with image content parts arrives
- **THEN** the ChatMessage SHALL include the images in its `images` array

#### Scenario: Nested-shape image is extracted
- **WHEN** a `message_start` event carries an image block in the nested Anthropic
  `source` shape
- **THEN** the ChatMessage SHALL include that image in its `images` array with the
  bytes from `source.data` and the mime from `source.media_type`

#### Scenario: Two-phase placeholder block reserves its slot
- **WHEN** a `message_start` event carries an image block with blanked bytes, a
  non-empty `attachmentId` and a mime
- **THEN** the block SHALL still be admitted into `images` with its
  `attachmentId` (and `attachmentState` when present), so the attachment position
  is not lost

#### Scenario: A block with no usable source or no mime is not an image
- **WHEN** a `message_start` event carries an `image`-typed block with no inline
  bytes and no `attachmentId`, or one with no mime
- **THEN** it SHALL NOT be added to `images`

#### Scenario: Pending prompt cleared
- **WHEN** a `message_start` with `role: "user"` or `agent_start` arrives
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`
