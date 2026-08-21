## ADDED Requirements

### Requirement: Canonical inline image-block detection is shared across packages

Inline image content blocks SHALL be recognized and read through ONE canonical
module in `packages/shared` (`image-block.ts`), consumed by every site that
inspects image blocks — currently the server event-store truncator and the client
chat event reducer. A site SHALL NOT reimplement the shape predicate locally, so
the accepted shapes cannot drift between server and client.

Two block shapes SHALL be accepted and treated identically by every accessor:

- flat pi shape — `{ type: "image", data, mimeType }` (pi SDK `ImageContent`)
- nested Anthropic shape — `{ type: "image", source: { type: "base64", media_type, data } }`

The module SHALL expose:

- `isImageTypeBlock(block)` — true when `block` is a non-array object whose
  `type` is `"image"`, in either shape.
- `imageBlockData(block)` — the non-empty inline base64 bytes of an image block
  across both shapes (flat `data`, else `source.data`), otherwise `undefined`.
  An empty string SHALL yield `undefined`, so a blanked two-phase placeholder is
  reported as carrying no bytes.
- `imageBlockMime(block)` — the mime of an image block across both shapes (flat
  `mimeType`, else `source.media_type`), otherwise `undefined`.
- `isInlineImageBlock(block)` — true exactly when `imageBlockData(block)` is
  defined. This is the "are there bytes here to strip?" question the server's
  over-ceiling image rescue keys off.
- `isRenderableImageBlock(block)` — true when the block is `image`-typed, has a
  NON-EMPTY mime, AND has either inline bytes or a NON-EMPTY `attachmentId`.
  This is the "can this become a rendered attachment?" question the client keys
  off.

The two predicates SHALL remain distinct: a blanked two-phase attachment
placeholder SHALL be `isInlineImageBlock === false` (nothing to strip) and
`isRenderableImageBlock === true` (its position must be reserved for the later
fit resolution).

Every accessor SHALL be total over unknown input: `null`, `undefined`, arrays,
primitives and non-image blocks SHALL yield `false` / `undefined` rather than
throwing.

#### Scenario: Both shapes are recognized as image blocks
- **WHEN** `isImageTypeBlock` is given the flat shape or the nested `source` shape
- **THEN** it SHALL return true for both

#### Scenario: Bytes and mime are read across both shapes
- **WHEN** `imageBlockData` / `imageBlockMime` are given the nested shape
- **THEN** they SHALL return `source.data` and `source.media_type`
- **AND** given the flat shape they SHALL return `data` and `mimeType`

#### Scenario: A blanked placeholder carries no inline bytes
- **WHEN** a block has `data: ""` with an `attachmentId` and a mime
- **THEN** `imageBlockData` SHALL be `undefined` and `isInlineImageBlock` SHALL be
  false
- **AND** `isRenderableImageBlock` SHALL be true

#### Scenario: Renderability requires a usable source AND a mime
- **WHEN** a block has an `attachmentId` but no mime, or a mime but neither bytes
  nor an `attachmentId`, or an EMPTY `attachmentId`, or an EMPTY mime
- **THEN** `isRenderableImageBlock` SHALL be false

#### Scenario: Non-image and malformed input is rejected, not thrown on
- **WHEN** any accessor is given a text block, `null`, or an array
- **THEN** it SHALL return false / `undefined` without throwing

#### Scenario: Server and client agree by construction
- **WHEN** a new image block shape is accepted
- **THEN** it SHALL be accepted by adding it to the shared module, so the server
  truncator and the client reducer change together — a local predicate at either
  call site SHALL NOT be reintroduced
