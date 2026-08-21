> Retro-specified: the implementation landed in PR #528 before these artifacts
> existed. Every task below is checked against the code actually on the branch.

## 1. Shared — canonical image-block module (D5)

- [x] 1.1 Add `packages/shared/src/image-block.ts` exporting `isImageTypeBlock`, `imageBlockData`, `imageBlockMime`, `isInlineImageBlock`, `isRenderableImageBlock`, handling the flat pi shape and the nested Anthropic `source` shape.
- [x] 1.2 Make every accessor total over unknown input (`null`, arrays, primitives, non-image blocks) via a single `asBlock` guard.
- [x] 1.3 Keep `isInlineImageBlock` ("bytes to strip", server) and `isRenderableImageBlock` ("renderable attachment", client) distinct; a blanked `attachmentId` placeholder is false / true respectively.

## 2. Server — image-bytes rescue at ingest (D1–D4)

- [x] 2.1 In `packages/server/src/persistence/memory-event-store.ts`, add `stripInlineImageBytesFromMessage(event)`: map `data.message.content`, blank the bytes of every `isInlineImageBlock` block, mark it `imageTruncated: true`, preserve block position + mime (flat `mimeType`; nested `source` wrapper + `source.media_type`).
- [x] 2.2 Return a NEW event with only the touched paths cloned; return the original reference when nothing changed (no mutation of the in-flight event).
- [x] 2.3 Wire it into `createTruncator` gated on `sizePass && exceedsSerializedSize(data, maxEventDataSize)`, BEFORE the generic string pass, and feed the rescued data into `truncateStrings`.
- [x] 2.4 Keep the terminal `exceedsSerializedSize(truncated, ...)` → `truncatedPlaceholder(event, ...)` fallback unconditional, so non-image overflow still collapses and the ceiling/OOM guard is unchanged.
- [x] 2.5 Delegate inline-image detection to the shared module (no second local predicate); leave the pre-existing `isImageBlock` per-field-pass helper alone.

## 3. Client — nested-shape tolerance (D5)

- [x] 3.1 In `packages/client/src/lib/chat/event-reducer.ts`, replace the `message_start` filter `c.type === "image" && c.mimeType && (c.data || c.attachmentId)` with `isRenderableImageBlock(c)`.
- [x] 3.2 Read bytes/mime via `imageBlockData` / `imageBlockMime`; keep carrying `attachmentId` / `attachmentState` onto the `ChatImage` so the two-phase fit position survives.

## 4. Tests — L1 unit (vitest)

- [x] 4.1 `packages/shared/src/__tests__/image-block.test.ts` — both shapes, blanked placeholder, empty `attachmentId`, empty mime, malformed input.
- [x] 4.2 `memory-event-store.test.ts` — over-ceiling flat-shape pasted image keeps role + text verbatim, keeps block position + mime, `data === ""`, `imageTruncated === true`, byte size ≤ ceiling. Replaces the test that codified the vanishing behavior.
- [x] 4.3 `memory-event-store.test.ts` — same for the nested `source` shape (`source.media_type` preserved, `source.data === ""`).
- [x] 4.4 `memory-event-store.test.ts` — with `maxStringFieldSize = 0`, a message whose TEXT alone busts the ceiling still yields `{ __truncated }` (proves the rescue is not a ceiling exemption).
- [x] 4.5 `memory-event-store.test.ts` E11 — image-bearing NON-subagent event now keeps the message and strips the bytes; bound assertion retained.

## 5. Verification

- [x] 5.1 Unit suites green across `memory-event-store`, `attachment-ingest`, `attachment-resolver`, `image-block`.
- [x] 5.2 Manual: paste a screenshot into a chat message in a running dashboard, send, confirm the message + image remain in the transcript and survive a reload.
- [ ] 5.3 Not covered by an automated regression: the reload/replay path for a rescued (bytes-stripped) message — the row renders from the preserved envelope, with the thumbnail supplied by the attachment resolution when one exists. Tracked as a follow-up rather than blocking this fix.
