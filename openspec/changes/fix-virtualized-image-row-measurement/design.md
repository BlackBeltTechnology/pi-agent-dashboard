## Context

The chat transcript was virtualized in `virtualize-chat-transcript-tanstack`
(`311de78f4`). Only viewport + overscan rows mount; each row is absolutely
positioned at `translateY(vi.start)` inside a spacer sized to `getTotalSize()`.
Per-row height comes from two sources:

1. `estimateVirtualRowSize(row)` — a synchronous per-type guess used before a row
   mounts (`user` → 96px).
2. `ref={virtualizer.measureElement}` — TanStack's ResizeObserver-backed measure,
   authoritative once the row is in the DOM.

Images render in `ImageAttachments` as `<img src="data:${mime};base64,${data}">`
with `max-w-[300px] max-h-[300px] object-contain` and no width/height attributes.

## The failure mode (Layer B)

A base64 data-URL decodes **asynchronously**. Sequence on first paint:

```
mount row ──▶ <img> intrinsic size 0×0 ──▶ measureElement records ~small height
                                              (padding only, ~96px order)
   … browser decodes base64 …
image paints, grows to ≤300px ──▶ ResizeObserver SHOULD refire ──▶ re-measure
```

The re-measure is not guaranteed to land where it matters:

- `ChatView` is **reused across session switches** (`key={sessionId}` only on the
  inner `FilePreviewProvider`, not the virtualizer). Rows can mount, measure at the
  pre-decode height, then the session view scrolls / the element is recycled before
  the decode-driven ResizeObserver callback re-measures — leaving a stale collapsed
  size in the virtualizer's cache.
- With `overflowAnchor: "none"` and absolute translateY positioning, a stale-small
  row overlaps the next row → the image message is hidden underneath.

## Decision

Make the re-measure explicit and deterministic instead of relying solely on the
ResizeObserver catching async decode:

1. **`onLoad` → request measure.** Each `<img>` in `ImageAttachments` calls a
   handler on load that re-measures its owning virtual row. The row element already
   carries `ref={virtualizer.measureElement}` and `data-index`; the cleanest hook is
   to have `ImageAttachments` receive an `onImageLoad` callback that the row map
   wires to `virtualizer.measureElement(rowEl)` (or `measure()`), keyed by the row's
   `data-index`. This forces TanStack to record the post-decode height.

2. **Reserve intrinsic box while loading.** Set a `min-height` / `min-width` (or
   `width`/`height` attributes when known) on the `<img>` so the pre-decode
   measurement is a bounded box, not ~0px. Bounds first-paint scroll drift.

3. **Estimate parity (optional).** If a row is known to carry images before mount,
   `estimateVirtualRowSize` can return a taller value; measurement remains
   authoritative, this only reduces the initial jump.

### Why not just fix the ResizeObserver?

The observer is TanStack-internal; we cannot change its firing. We CAN give it a
better initial box (item 2) and add a guaranteed post-decode signal (item 1). Item 1
is the load-bearing fix.

### Performance guard

A message can carry multiple images; N `onLoad` events would each request a measure.
Debounce/coalesce to one measure per row per animation frame so a many-image message
does not cause a measure storm (ties to the `performance-optimization` discipline).

## Alternatives considered

- **Decode images to blob URLs with known dimensions before render** — heavier,
  changes the asset pipeline, and does not help remote/markdown-inlined images.
  Rejected: over-engineered for the symptom.
- **Disable virtualization for image-bearing rows** — breaks the uniform windowing
  model and the CPU budget the virtualization exists to protect. Rejected.

## Open questions

- Does the collapse reproduce on `develop` (Layer A already fixed there), or only on
  released builds? Reproduce first (task 1) — if it does not reproduce on `develop`,
  the fix is purely defensive hardening and the test still guards the regression.
