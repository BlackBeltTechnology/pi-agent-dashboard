## Why

**91 % of every image ever pasted into this dashboard is silently deleted** — together
with the message that carried it.

Base64 attachments ride inside dashboard events. `memory-event-store.ts` bounds each
event at `DEFAULT_MAX_EVENT_DATA_SIZE = 20_000` bytes; an over-ceiling event becomes
`truncatedPlaceholder` → `{__truncated: true}`, which carries no `data.message`. The
client reducer keys on `data.message`, so **no row renders and no error surfaces**.

Why it hits images specifically: `truncateStrings` caps ordinary text fields (default
4000) but **exempts** anything shaped `data` + `mimeType` (line 224). Text is capped and
survives; an image is exempted, reaches the ceiling check full-size, and takes the whole
message down. The exemption written to protect images is what destroys them.

Verified end-to-end through `createMemoryEventStore()` at production defaults: 8/8
over-ceiling assistant messages survive; 3/3 image-bearing user messages collapse.
Delivery is fine — the model receives and describes the image. Only the dashboard loses it.

### Two measurements decided the design

Every image ever pasted is already on disk in the pi transcripts. Across **3137
transcripts, n = 1587 images**: `p50 125.7 KB · p90 757.3 KB · p99 2233.3 KB · max 10.5 MB`.

**(1) Raising the ceiling alone fails** — the tail is unbounded. 19.5 KB renders 8.9 % of
images; even 256 KB renders only 74.9 %, while inflating the theoretical heap envelope
from 37 GB to 488 GB and pushing p99 payloads to 56 % of a single 4 MB WebSocket frame
budget (`browser-gateway` drops **whole frames** past `MAX_WS_BUFFER`).

**(2) Resizing bounds the tail** — which is the property that was missing. Measured on 40
real images (jimp, 768 px long edge, q75):

| | max | 256 KB ceiling covers |
|---|---|---|
| raw | 10478 KB | 74.9 % |
| **768 px / q75** | **212 KB** | **100 %** |

Resize barely moves the median (184 → 42 KB) but it **caps the maximum**. A bounded
maximum makes a modest ceiling raise deterministic, and removes the need for an
authenticated endpoint, a cache lifecycle, and recovery-on-miss to be load-bearing for
basic display.

## What Changes

A **display derivative inline, the original on demand.**

- **Fit for display at ingest.** Each image content block is resized to 768 px long edge
  at q75 and stored **inline** in the event. Measured max 212 KB.
- **Raise the ceiling to 256 KB**, which covers 100 % of fitted output rather than the
  74.9 % raw payloads would reach.
- **Two-phase render.** Resize costs 174–874 ms, so the message row appears
  **immediately** with a placeholder and the fitted image swaps in when resize completes.
  The user never waits on an image to see their own message.
- **Resize off the event loop.** jimp is pure JS and single-threaded; resize runs in a
  worker so event-loop lag stays bounded even for a 10 MB paste.
- **The original stays available.** A session-scoped endpoint serves full-resolution
  bytes for click/zoom. This path is **not load-bearing**: if it fails, the inline fitted
  image still renders.
- **The original needs no new durable store.** pi already writes full-resolution bytes
  into the session transcript, so the blob cache is an optimisation and a miss is
  recovered by streaming the transcript.

**Direct jimp, not the `pi-image-fit` extension.** Its resize logic is sound and pure-JS,
but its caches are unusable here — `ContentCache` is in-memory (dies with the session)
and the temp-file cache is deleted on `session_shutdown` with a 24 h orphan sweep, both
in the **pi session process**, not the dashboard server. The dashboard must render
six-month-old transcripts. Its policy also targets model input (4 MiB / 1568 px), two
orders of magnitude off a display budget. Coupling the server to a pi-extension package
for one function is not worth the shared-policy risk.

## Impact

- `packages/server/src/persistence/memory-event-store.ts` — ingest seam; ceiling constant.
- New: display-fit worker (jimp), invoked at ingest.
- New: session-scoped attachment endpoint for originals + a transcript-backed resolver.
- `packages/server/src/server.ts:684` — the boot assert is passed `?? 0` while the store
  gets the raw value (→ default 4000), so its `× 6` check **skips**. It must be armed;
  note `4000 × 6 = 24_000`, so the new ceiling must exceed that — 256 KB does.
- `packages/server/src/terminal/terminal-manager.ts:32` — derives
  `DEFAULT_TRANSCRIPT_CAP_BYTES = 0.75 ×` the ceiling; a raise moves it.
- `packages/client/src/components/chat/ChatView.tsx` — placeholder → image swap; click to
  open the original.
- Unchanged: delivery, `state-replay`, and the reducer's image extraction. Because the
  display image stays **inline base64**, decode timing is as today and the virtualized
  row-measure path needs no change.

**Risks**

- **Lossy by default.** 768 px may render UI text unreadable — and screenshots of UI are
  the main use case. Mitigated by click-to-original, which is why the hybrid was chosen
  over inline-only.
- **Two-phase visible state.** A placeholder that never resolves (worker crash) must
  degrade to something honest rather than an empty box.
- **Worker/CPU cost.** Resize is real work; a burst of pastes queues.
- **New authenticated binary surface** for originals — authorisation scope, content-type
  allow-list, and header hardening need explicit treatment.
- **Ceiling raise is global** — it governs every event type, not just image-bearing ones.

## Superseded approaches (recorded so they are not re-proposed)

- **Raise the ceiling alone** — falsified by the size distribution (74.9 % at 256 KB, tail
  to 10.5 MB).
- **Degrade-with-a-marker at the current ceiling** — would strip ~91 % of images.
- **Full out-of-band for the primary display path** — correct while the tail was
  unbounded; unnecessary once resize bounds it, and it made basic display depend on an
  endpoint, auth, cache eviction, and recovery.

Three errors during this investigation are worth recording, all with the same cause —
asserting where a cheap measurement was available:

- A ~60 KB ceiling floor was extrapolated from **one 59 KB sample**; the real p50 is
  126 KB, so it would have left 77 % broken while appearing to fix the bug.
- Scope was widened to audio/file blocks citing `types.ts:519-523`. **No such types
  exist**, and only `type: "image"` appears in 3137 transcripts.
- `pi-image-fit` was reported **not installed** from a `grep image` that could not match a
  scoped package. It is installed.

## Discipline Skills

- `security-hardening` — a new authenticated endpoint serving user-supplied binary
  content: authorisation scope, content-type constraints, path safety.
- `performance-optimization` — resize is measured work on the ingest path; the worker
  offload and event-loop bound must be verified, not assumed.
- `systematic-debugging` — this bug's first two hypotheses were both wrong and both were
  caught only by checking real data.
- `review-code` — event-store hot path plus a cross-package change.
