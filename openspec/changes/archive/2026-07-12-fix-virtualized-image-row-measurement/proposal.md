## Why

Issue #267: in the newly virtualized chat transcript, user messages with pasted
images can disappear. Two independent layers can drop an image message:

- **Layer A (server ingest, already fixed on `develop`)** — `memory-event-store.ts`
  enforces a 20 KB per-event size ceiling. A pasted image's base64 blob exceeds
  it, so the whole event `data` collapsed to `{__truncated}`. Commit `05239e9c7`
  exempts base64 image blocks from the ceiling. It is on `develop` but NOT in any
  tag (latest release v0.5.4), so released builds still hit it. Out of scope here.

- **Layer B (client virtualizer, unaddressed) — THIS CHANGE.** The transcript is
  windowed via TanStack Virtual (`virtualize-chat-transcript-tanstack`). Row
  height is corrected only by `ref={virtualizer.measureElement}` (a ResizeObserver).
  The `<img>` in `ImageAttachments` carries `max-w-[300px] max-h-[300px]` but **no
  explicit dimensions and no `onLoad`**. A base64 data-URL decodes asynchronously,
  so at mount the img is ~0px and the row is measured tiny; `estimateVirtualRowSize`
  guesses only 96px for a user row. If the post-decode ResizeObserver re-measure is
  missed (e.g. across a session switch where `ChatView` is reused, not remounted),
  the row height stays collapsed and the message overlaps its neighbour — visually
  "disappears".

## What Changes

- `ImageAttachments` (in `ChatView.tsx`) SHALL trigger a virtual-row re-measure
  when each `<img>` finishes decoding (`onLoad`), so the row's true height is
  recorded after the async image paints — not frozen at the pre-decode estimate.
- Give the image element intrinsic layout up front (reserve a min box while
  loading) so the first measurement is not ~0px and scroll drift before decode is
  bounded.
- Add a regression test asserting an image-bearing user row reports a full
  (non-collapsed) measured height in the virtualized transcript, and that an image
  `onLoad` requests a re-measure.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chat-view`: the virtualized transcript SHALL keep image-bearing message rows at
  their true height by re-measuring on async image decode, so messages with
  attachments never collapse or disappear.

## Impact

- `packages/client/src/components/ChatView.tsx` — `ImageAttachments`: add `onLoad`
  re-measure hook + reserved min dimensions on the `<img>`.
- `packages/client/src/lib/chat-virtual-rows.ts` — optionally raise the `user`
  estimate or add an image-aware estimate to reduce pre-decode drift (measurement
  still authoritative).
- Tests: `packages/client/src/components/__tests__/ChatView.*.test.tsx` (new
  image-row measurement case).
- No server / protocol change. Layer A (`memory-event-store.ts`) is untouched.

## Discipline Skills

- `systematic-debugging` — confirm the collapse is a missed post-decode re-measure
  (not the server ceiling) before changing code; reproduce first.
- `performance-optimization` — the transcript is virtualized for CPU; verify the
  `onLoad` re-measure does not trigger a measure storm on many-image messages.
