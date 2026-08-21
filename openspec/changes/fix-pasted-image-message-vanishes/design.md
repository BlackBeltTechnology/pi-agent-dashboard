## Context

`createTruncator` in `packages/server/src/persistence/memory-event-store.ts` is the single ingest-time bounding point for every forwarded event; both `insertEvent` (persist) and the broadcast path operate on its output. It has exactly three tools today:

1. per-string-field head+tail capping (`truncateStrings`, skipped when `maxStringFieldSize === 0`),
2. the subagent-timeline head+tail reduction (type-scoped, `reduceSubagentEvent`),
3. the whole-event `{ __truncated }` placeholder for everything else.

Tool 3 is lossless-for-memory and total-loss-for-meaning: it discards `data.message`. Every non-subagent over-ceiling event lands there, including a user chat message whose only sin is a pasted screenshot.

## Goals / Non-Goals

**Goals**
- A user chat message with an over-ceiling pasted image survives in history with its text and role intact.
- The per-event byte ceiling and the "never materialize a full `JSON.stringify` on the persist/broadcast path" rule remain exactly as strict.
- One detector for inline image blocks, shared by server and client.

**Non-Goals**
- Preserving the image BYTES in the event store (the fit/attachment pipeline owns durable image delivery; see `attachment-storage`).
- Touching the subagent reduction path, which already caps image `data` with NO preservation and must keep doing so.
- Backfilling events already stored as `{ __truncated }`.

## Decisions

### D1 — Strip bytes, keep the block

The rescue blanks the base64 string and leaves the block in place rather than deleting it. A deleted block would shift positions and destroy the correspondence the fit/attachment resolution relies on to back-fill a thumbnail; the mime is kept for the same reason. `imageTruncated: true` marks the block so a renderer can distinguish "bytes stripped for size" from "two-phase placeholder awaiting fit". It is additive and no consumer is required to read it.

*Alternative rejected:* head+tail-capping the base64 like any other string. A truncated base64 string is not a decodable image — it renders as a broken image rather than a placeholder, and still spends the ceiling on bytes nobody can use. (The same reasoning is why the per-string-field pass exempts base64 outright; that exemption is now shape-structural, so the nested `source.data` is exempt too.)

### D1b — A rescued block must still render, as an explicit unavailable slot

`prepareEventForIngest` blanks the bytes AND stamps an `attachmentId` for every block that enters two-phase. So a block still carrying bytes when it reaches the truncator is precisely one the fit DECLINED (animated GIF, unfittable mime, or no fit worker at all). The rescue therefore always produces a block with no bytes and no `attachmentId` — which `isRenderableImageBlock` rejected, dropping it from `images` entirely. The message survived, but claimed the user had attached nothing.

The client now admits `imageTruncated` blocks and maps them to `attachmentState: "failed"`, which `ChatView` already renders as "image unavailable". No new UI state, and it is honest: the bytes are unrecoverable, so a pending slot would hang forever. An `attachmentState` already on the block wins, so a two-phase pending placeholder is never downgraded.

### D2 — Rescue runs only on the over-ceiling branch, before the generic string pass

`stripInlineImageBytesFromMessage` is gated on `sizePass && exceedsSerializedSize(data, ceiling)`. An under-ceiling message is never touched, so ordinary inline image rendering is completely unaffected. It runs BEFORE `truncateStrings` so the generic pass measures the already-shrunk envelope, and BEFORE the placeholder fallback so the placeholder becomes the fallback rather than the first resort.

### D3 — The placeholder fallback is retained unconditionally

After the rescue and the string pass, the same `exceedsSerializedSize(truncated, ceiling)` check still fires and still returns `truncatedPlaceholder(event, ...)`. A message whose non-image content alone busts the ceiling therefore still collapses — proving the rescue is a targeted reduction and not a ceiling exemption. This is what keeps the OOM guard that motivated the byte-accurate walk intact: nothing can pass the terminal bound proof by virtue of being an image.

### D4 — Copy-on-write, no mutation of the in-flight event

The rescue returns a NEW event with only the touched paths cloned (`{...event, data: {...data, message: {...message, content: nextContent}}}`), matching the existing invariant of the subagent reduction: the bridge/logger may hold the same `data` reference, so the store must not mutate it. When nothing changed, the original reference is returned so the identity comparison downstream (`truncated !== data`) stays meaningful.

### D5 — One shared detector in `packages/shared`, not two private copies

`packages/shared/src/image-block.ts` is imported by both the server truncator and the client reducer. Placing it in `shared` (rather than duplicating a predicate on each side) is what makes "handle both shapes" a single fact. The module distinguishes two questions deliberately:

- `isInlineImageBlock` — "are there bytes here to strip?" (server truncation). A blanked two-phase placeholder and a rescued block both answer **false**: nothing to strip.
- `isRenderableImageBlock` — "can this become a rendered attachment slot?" (client). Requires a non-empty mime AND (inline bytes OR a non-empty `attachmentId` OR the `imageTruncated` marker). Both placeholder kinds answer **true**.
- `isBase64DataCarrier` — "is this node's `data` base64 that capping would corrupt?" (per-string-field pass). Structural (`data` + `mimeType`/`media_type` sibling) rather than `type === "image"`-scoped, because the node holding nested bytes is the `source` wrapper, which carries no `type`. It replaces the store's local `isImageBlock`, which knew only the flat shape.

Conflating them would either make the server rewrite blocks with nothing to gain, or make the client drop the placeholder slot that `attachment_fitted` later fills.

### D6 — Nested shape keeps its wrapper

For `{ source: { type, media_type, data } }` the rescue blanks `source.data` and preserves the `source` wrapper and `media_type`, rather than normalizing the block into the flat shape. Normalizing would rewrite a payload shape the store does not own and could surprise any consumer that round-trips it; the accessors already make shape irrelevant to readers.

## Risks / Trade-offs

- **The image bytes are gone from the event.** Accepted: an over-ceiling inline image was never going to survive the ceiling, and `attachment-storage`'s fit path is the supported route for a rendered image. The message — the thing the user actually wrote — is what the rescue buys back.
- **`imageTruncated` is an untyped additive marker.** Accepted; blocks on this path are already `Record<string, unknown>` on the wire.
- **A renderer that ignores `imageTruncated` shows an empty image slot.** Acceptable and strictly better than the prior behavior (no row at all).

## Migration Plan

No schema migration. Newly rescued events contain an ADDITIVE `imageTruncated` field in their stored and broadcast payloads; older readers simply ignore it (they render the block as an empty image slot, or drop it, exactly as before this change). Already-stored `{ __truncated }` events are unaffected — the behavior change is forward-looking at ingest.

## Open Questions

None.
