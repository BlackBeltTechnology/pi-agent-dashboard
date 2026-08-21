## MODIFIED Requirements

### Requirement: User message rendering
A `message_start` event with role `"user"` SHALL create a new `ChatMessage` with `role: "user"`. Text content parts SHALL be concatenated. Image content parts SHALL be extracted into the `images` array.

Image content parts SHALL be recognized through the shared
`inline-image-block-shapes` detector, so BOTH accepted block shapes are extracted
identically: the flat pi shape `{ type: "image", data, mimeType }` and the nested
Anthropic shape `{ type: "image", source: { type: "base64", media_type, data } }`.
A block SHALL be admitted when it carries a non-empty mime AND at least one
usable source: inline base64 bytes, a non-empty two-phase `attachmentId`, or the
server's `imageTruncated` rescue marker. The block's `data` and mime SHALL be
read through the shared accessors rather than by reading `data` / `mimeType`
directly. An admitted block's `attachmentId` and `attachmentState` SHALL be
carried onto the `ChatImage` when present, so a later `attachment_fitted` event
can fill the reserved position.

A RESCUED block (`imageTruncated: true`, no bytes, no `attachmentId` — the server
stripped over-ceiling image bytes) SHALL resolve to `attachmentState: "failed"`,
the state that already renders as an explicit "image unavailable" slot. Nothing
will ever fill it, so it SHALL NOT be left pending indefinitely and SHALL NOT be
dropped from `images`. An `attachmentState` already present on the block SHALL
win over the derived value, so a two-phase pending placeholder is never
downgraded.

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

#### Scenario: A rescued block renders as an unavailable slot
- **WHEN** a `message_start` event carries an image block with a mime, empty
  bytes and `imageTruncated: true` — in either shape
- **THEN** it SHALL be added to `images` with `attachmentState: "failed"`, so the
  row shows an explicit unavailable slot rather than pretending nothing was
  attached
- **AND** the message's text SHALL be unaffected

#### Scenario: A pending placeholder is not downgraded by the rescue rule
- **WHEN** a block carries `attachmentState: "pending"` and an `attachmentId`
- **THEN** its state SHALL remain `"pending"`

#### Scenario: A block with no usable source or no mime is not an image
- **WHEN** a `message_start` event carries an `image`-typed block with no inline
  bytes, no `attachmentId` and no `imageTruncated` marker, or one with no mime
  (including a rescued block whose mime is absent)
- **THEN** it SHALL NOT be added to `images`

#### Scenario: Pending prompt cleared
- **WHEN** a `message_start` with `role: "user"` or `agent_start` arrives
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`
