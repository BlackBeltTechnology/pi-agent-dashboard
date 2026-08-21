## Why

Sending a chat message with a **pasted screenshot** made the whole message disappear from chat history — the user's text vanished along with the image.

The in-memory event store bounds every event's serialized `data` to `MAX_EVENT_DATA_SIZE` (production default `DEFAULT_MAX_EVENT_DATA_SIZE`, 256 KiB). For a non-subagent event the only bounding tool it has is the whole-event `{ __truncated: true, reason, approxBytes, eventType }` placeholder, which replaces `data` **entirely**. A pasted screenshot's base64 easily exceeds the ceiling, so a `message_start` whose `data.message` carried `role` + a text block + an image block was reduced to the placeholder: `data.message` gone. The client reducer's `message_start` handler then saw no `message.role`, created no user row, and the message vanished silently — no error, no placeholder row, nothing in the transcript.

The shipped `in-memory-event-buffer` spec **blesses** this outcome: the scenario "Image-bearing NON-subagent event is bounded (byte-accurate detection)" asserts the placeholder is the correct result. It was written to close a real OOM hole — the earlier size walk counted a base64 `data` string at a fixed 8 bytes, letting a multi-megabyte image escape the ceiling and then OOM the broadcast `JSON.stringify`. The byte-accurate walk fixed the OOM and reintroduced the vanishing message as a side effect. Both properties are required; the placeholder is simply too blunt an instrument to deliver them together.

A second, narrower defect rides along: two inline image block shapes reach the dashboard —

- flat pi shape — `{ type: "image", data, mimeType }` (pi SDK `ImageContent`)
- nested Anthropic shape — `{ type: "image", source: { type: "base64", media_type, data } }`

The server truncator and the client reducer each recognized only the flat shape, at two independent call sites with no shared detector, so a nested-shape image was invisible to both (never bounded server-side, never rendered client-side) and the two sites were free to drift further.

## What Changes

- **Image-bytes rescue before the whole-event placeholder.** When an over-ceiling event carries a chat message with inline image blocks, the store SHALL strip **only the base64 bytes** out of those blocks while preserving the message envelope — `role`, text blocks, and each image block's **position** and mime — and mark each stripped block `imageTruncated: true`. The message survives in history; a downstream fit/attachment resolution still back-fills the rendered thumbnail where one is available. **BREAKING** relative to the current `in-memory-event-buffer` spec, which asserts the placeholder for exactly this case.
- **The placeholder remains the fallback, not the first resort.** A message whose **non-image** content alone busts the ceiling still falls through to `{ __truncated }`. The rescue is a targeted reduction, never a blanket ceiling exemption: the byte-accurate size walk, the no-full-`JSON.stringify` rule, and the terminal bound proof are all unchanged, so the OOM hole stays closed.
- **One canonical inline-image-block detector, shared.** `packages/shared/src/image-block.ts` becomes the single source of truth for recognizing and reading image blocks across both shapes (`isImageTypeBlock`, `imageBlockData`, `imageBlockMime`, `isInlineImageBlock`, `isRenderableImageBlock`). Server truncation and the client reducer both consume it, so the two sites cannot drift.
- **The client reducer tolerates the nested shape.** `message_start` image extraction admits a block via `isRenderableImageBlock` (mime present AND either inline bytes or a two-phase `attachmentId`) and reads bytes/mime through the shared accessors, so replayed and persisted nested-shape images render.

Not in scope: changing the ceiling value, the subagent head+tail reduction path, the attachment fit/ingest boundary (`attachment-storage`), or any wire/protocol type. `imageTruncated` is an additive marker on an already-loosely-typed content block; no client is required to read it.

## Capabilities

### New Capabilities

- `inline-image-block-shapes`: the canonical cross-package contract for inline image content blocks — the two accepted shapes, the byte/mime accessors, and the inline-vs-renderable distinction that server truncation and client rendering each key off.

### Modified Capabilities

- `in-memory-event-buffer`: the "Per-event total-serialized-size ceiling" requirement gains the chat-message image-bytes rescue ahead of the whole-event placeholder, and its "Image-bearing NON-subagent event is bounded (byte-accurate detection)" scenario is **replaced** — the byte-accurate DETECTION it asserts is retained, but the asserted OUTCOME changes from `{ __truncated }` to a preserved message with stripped image bytes.
- `event-reducer`: "User message rendering" states that image content parts are recognized across both block shapes and that a block is admitted when it has a mime AND either inline bytes or an `attachmentId`.

## Impact

- `packages/shared/src/image-block.ts` (new) — canonical detector + accessors.
- `packages/server/src/persistence/memory-event-store.ts` — `stripInlineImageBytesFromMessage`, wired into `createTruncator` ahead of the generic string pass and the placeholder fallback; inline-image detection delegated to the shared module.
- `packages/client/src/lib/chat/event-reducer.ts` — `message_start` image extraction via the shared detector/accessors.
- Tests: `packages/shared/src/__tests__/image-block.test.ts` (new), `packages/server/src/__tests__/memory-event-store.test.ts` (two tests that codified the vanishing behavior replaced; nested-shape and non-image-overflow coverage added).
- No migration, no persisted-format change, no new endpoint. Events already stored as `{ __truncated }` stay as they are — the fix is forward-looking.

## Discipline Skills

- `doubt-driven-review` — the change inverts a scenario the shipped `in-memory-event-buffer` spec explicitly blesses, and that scenario exists to hold an OOM guard. The rescue must be shown to preserve the guard, not weaken it.
- `review-code` — non-trivial change spanning shared/server/client on the hot persist+broadcast path.
- `security-hardening` is deliberately NOT triggered: no auth, secret, or untrusted-input boundary moves; the rescue only ever REMOVES bytes from an event.
- `performance-optimization` is deliberately NOT triggered: the rescue runs only on the already-over-ceiling branch and adds no full-payload serialization.
