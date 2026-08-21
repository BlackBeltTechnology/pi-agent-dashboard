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
- `isTruncatedImageBlock(block)` — true when the block is `image`-typed and
  carries `imageTruncated === true` (strictly the boolean, not any truthy
  value): a block the server's rescue emptied, whose bytes are gone for good.
- `isRenderableImageBlock(block)` — true when the block is `image`-typed, has a
  NON-EMPTY mime, AND has at least one usable source: inline bytes, a NON-EMPTY
  `attachmentId`, or the `imageTruncated` marker. This is the "can this become a
  rendered attachment slot?" question the client keys off.
- `isBase64DataCarrier(obj)` — true when `obj` has a `data` string alongside a
  sibling mime key (`mimeType` or `media_type`). Deliberately STRUCTURAL rather
  than `type === "image"`-scoped, because the node carrying the nested bytes is
  the `source` wrapper, which has no `type: "image"`. This is the predicate the
  server's per-string-field truncation uses to exempt base64 from capping.

The predicates SHALL remain distinct:

- a blanked two-phase attachment placeholder SHALL be
  `isInlineImageBlock === false` (nothing to strip) and
  `isRenderableImageBlock === true` (its position must be reserved for the later
  fit resolution);
- a rescued block SHALL be `isInlineImageBlock === false` (already emptied) and
  `isRenderableImageBlock === true` (it must still be shown as an explicit
  unavailable slot, never silently dropped).

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

#### Scenario: A rescued block is renderable but not inline
- **WHEN** a block is `image`-typed with a mime, empty bytes and
  `imageTruncated: true`, in either shape
- **THEN** `isTruncatedImageBlock` SHALL be true, `isInlineImageBlock` SHALL be
  false, and `isRenderableImageBlock` SHALL be true
- **AND** the marker SHALL NOT excuse a missing mime: with no mime,
  `isRenderableImageBlock` SHALL be false
- **AND** a non-boolean `imageTruncated` value SHALL NOT count as the marker

#### Scenario: The base64 exemption is structural, not image-typed
- **WHEN** `isBase64DataCarrier` is given the nested `source` object
  `{ type: "base64", media_type, data }`, which carries no `type: "image"`
- **THEN** it SHALL return true, so the per-string-field pass does not cap the
  nested base64 into an undecodable string
- **AND** given `{ data: "<string>" }` with no sibling mime key it SHALL return
  false

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
