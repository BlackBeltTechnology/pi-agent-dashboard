> Retro-specified: the implementation landed in PR #528 before these artifacts
> existed. Every task below is checked against the code actually on the branch.

## 1. Shared — canonical image-block module (D5)

- [x] 1.1 Add `packages/shared/src/image-block.ts` exporting `isImageTypeBlock`, `imageBlockData`, `imageBlockMime`, `isInlineImageBlock`, `isRenderableImageBlock`, handling the flat pi shape and the nested Anthropic `source` shape.
- [x] 1.2 Make every accessor total over unknown input (`null`, arrays, primitives, non-image blocks) via a single `asBlock` guard.
- [x] 1.3 Keep `isInlineImageBlock` ("bytes to strip", server) and `isRenderableImageBlock` ("renderable attachment slot", client) distinct; a blanked `attachmentId` placeholder is false / true respectively.
- [x] 1.4 Add `isTruncatedImageBlock` (strict `imageTruncated === true`) and admit it as a third source in `isRenderableImageBlock`, so a rescued block still occupies a slot.
- [x] 1.5 Add the structural `isBase64DataCarrier` (`data` string + `mimeType`/`media_type` sibling) for the server's per-string-field base64 exemption — the exempt node is often the `source` wrapper, which carries no `type: "image"`.

## 2. Server — image-bytes rescue at ingest (D1–D4)

- [x] 2.1 In `packages/server/src/persistence/memory-event-store.ts`, add `stripInlineImageBytesFromMessage(event)`: map `data.message.content`, blank the bytes of every `isInlineImageBlock` block, mark it `imageTruncated: true`, preserve block position + mime (flat `mimeType`; nested `source` wrapper + `source.media_type`).
- [x] 2.2 Return a NEW event with only the touched paths cloned; return the original reference when nothing changed (no mutation of the in-flight event).
- [x] 2.3 Wire it into `createTruncator` gated on `sizePass && exceedsSerializedSize(data, maxEventDataSize)`, BEFORE the generic string pass, and feed the rescued data into `truncateStrings`.
- [x] 2.4 Keep the terminal `exceedsSerializedSize(truncated, ...)` → `truncatedPlaceholder(event, ...)` fallback unconditional, so non-image overflow still collapses and the ceiling/OOM guard is unchanged.
- [x] 2.5 Delegate ALL image-shape detection to the shared module: remove the local `isImageBlock` predicate (flat-only, accepted non-image objects) and route both of its call sites — `summarizeAtDepthLimit` and the `truncateStrings` `data`-key exemption — through `isBase64DataCarrier`, which also fixes the nested `source.data` being capped into undecodable base64.

## 3. Client — nested-shape tolerance (D5)

- [x] 3.1 In `packages/client/src/lib/chat/event-reducer.ts`, replace the `message_start` filter `c.type === "image" && c.mimeType && (c.data || c.attachmentId)` with `isRenderableImageBlock(c)`.
- [x] 3.2 Read bytes/mime via `imageBlockData` / `imageBlockMime`; keep carrying `attachmentId` / `attachmentState` onto the `ChatImage` so the two-phase fit position survives.
- [x] 3.3 Derive `attachmentState: "failed"` for a rescued (`imageTruncated`) block with no explicit state, so it renders `ChatView`'s existing "image unavailable" slot instead of hanging pending or vanishing; an explicit `attachmentState` on the block always wins.

## 4. Tests — L1 unit (vitest)

- [x] 4.1 `packages/shared/src/__tests__/image-block.test.ts` — both shapes, blanked placeholder, empty `attachmentId`, empty mime, malformed input; rescued block renderable-but-not-inline, non-boolean `imageTruncated` rejected.
- [x] 4.2 `memory-event-store.test.ts` — over-ceiling flat-shape pasted image keeps role + text verbatim, keeps block position + mime, `data === ""`, `imageTruncated === true`, byte size ≤ ceiling. Replaces the test that codified the vanishing behavior.
- [x] 4.3 `memory-event-store.test.ts` — same for the nested `source` shape (`source.media_type` preserved, `source.data === ""`).
- [x] 4.4 `memory-event-store.test.ts` — with `maxStringFieldSize = 0`, a message whose TEXT alone busts the ceiling still yields `{ __truncated }` (proves the rescue is not a ceiling exemption).
- [x] 4.5 `memory-event-store.test.ts` E11 — image-bearing NON-subagent event now keeps the message and strips the bytes; bound assertion retained.
- [x] 4.6 `memory-event-store.test.ts` — an under-ceiling NESTED-shape image's `source.data` survives the per-string-field pass verbatim (was capped into undecodable base64).
- [x] 4.7 `packages/client/src/lib/__tests__/event-reducer-image-truncated.test.ts` — rescued flat + nested blocks render as `failed` slots; a pending two-phase placeholder is not downgraded; a rescued block with no mime is still rejected.

## 5. Verification

- [x] 5.1 Unit suites green across `memory-event-store`, `attachment-ingest`, `attachment-resolver`, `image-block`.
- [x] 5.2 Manual: paste a screenshot into a chat message in a running dashboard, send, confirm the message + image remain in the transcript and survive a reload.
- [x] 5.3 CodeRabbit round 1 addressed: rescued-image client slot (code), nested-shape base64 exemption (code), ceiling default 20 000 → 256 KiB, exemption scoped away from the subagent reduction, `imageTruncated` documented as an additive persisted field, task 2.5 restated to match the code.
- [ ] 5.4 Not covered by an automated regression: the full reload/replay path for a rescued message end-to-end in a browser (unit-level reducer coverage exists). Tracked as a follow-up rather than blocking this fix.
