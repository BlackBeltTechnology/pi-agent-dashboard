## Context

```
  paste -> bridge -> pi.sendUserMessage -> pi writes FULL-RES to session JSONL
                                                |
                              bridge forwards message_start (base64 INLINE)
                                                |
                                       memory-event-store
                         truncateStrings: line 224 EXEMPTS data+mimeType
                                                |
                            exceedsSerializedSize vs 20_000 -> OVER
                                                |
                                  truncatedPlaceholder {__truncated}
                                                |
                       event-wiring:575 broadcasts getEvent(seq)  (store == broadcast)
                       browser-gateway: ws.send(JSON.stringify(stored))  (no 2nd bound)
                                                |
                             reducer: data.message undefined -> NO ROW, silent
```

### Measurements that decided the design

**Distribution** (n=1587, 3137 transcripts): `p50 125.7 KB · p90 757.3 KB · p99 2233.3 KB
· max 10.5 MB`. Ceiling coverage raw: 19.5 KB → 8.9 % · 128 KB → 50.2 % · 256 KB → 74.9 %.

**Resize** (n=40 stratified, jimp):

| policy | p50 | p90 | max |
|---|---|---|---|
| raw | 184 KB | 1655 KB | 10478 KB |
| 1568/q85 | 116 KB | 237 KB | 985 KB |
| **768/q75** | **42 KB** | **101 KB** | **212 KB** |
| 320/q70 | 11 KB | 22 KB | 38 KB |

**Cost** (jimp, single-threaded, 768/q75): 184 KB → 203 ms · 1655 KB → 174 ms ·
10478 KB → **874 ms**.

The decisive property is not the median but the **bounded maximum**: 212 KB. Raising the
ceiling failed because the raw tail is unbounded; resize removes the tail.

## Goals / Non-Goals

**Goals**
- Every pasted image renders — live and on replay — regardless of original size.
- No message is ever deleted because of its attachment.
- Full resolution remains reachable.
- The event loop is not blocked by resize.

**Non-Goals**
- Reusing `pi-image-fit`'s caches (wrong process, wrong lifetime — see D5).
- A "dropped attachment" marker (nothing is dropped once fitting works).
- The mid-turn `bridgeFollowUp` buffer image loss — separate delivery bug.
- Changing delivery (`command-handler`), `state-replay`, or the reducer's image
  extraction.

## Decisions

### D1 — Display derivative inline; original out-of-band (settled)

The event carries a **fitted** image (768 px, q75, measured max 212 KB) as inline base64.
The full-resolution original is reachable through a separate endpoint on click/zoom.

Why inline for display rather than a reference: it keeps the out-of-band path off the
critical path. Basic display then depends on no endpoint, no auth, no cache eviction, and
no recovery — a failure there costs the zoom, not the message. It also preserves current
decode timing, so the virtualized transcript's row-measure behaviour is unchanged.

### D2 — Ceiling raised to 256 KB (settled)

Covers 100 % of fitted output (max 212 KB) with headroom, versus 74.9 % for raw payloads.

Two independent floors must both be cleared, and 256 KB clears both:
- **Fitted max** 212 KB.
- **Boot assert** `maxStringFieldSize × 6 = 24_000` (see D6).

### D3 — Two-phase render (settled)

Resize costs up to 874 ms; a user must never wait on it to see their own message.

1. The message row renders **immediately** with a placeholder occupying the attachment's
   position.
2. The fitted image replaces the placeholder when resize completes.

A placeholder that never resolves (worker crash, unsupported format) must degrade to an
honest failed-attachment state — never an empty box and never a missing row.

### D4 — Resize runs off the event loop (settled)

jimp is pure JS and single-threaded; 874 ms of synchronous work on the ingest path would
stall the server for every connected session. Resize runs in a worker; the assertion is
on **event-loop lag**, not on resize latency, which is inherently unbounded for a 10 MB
input.

### D5 — Direct jimp, not the `pi-image-fit` extension (settled)

Its resize logic is sound and pure-JS, but it cannot serve this purpose:

| | `pi-image-fit` | needed here |
|---|---|---|
| `ContentCache` | in-memory, dies with the session | must survive months |
| temp-file cache | `os.tmpdir()`, deleted on `session_shutdown`, 24 h sweep | must survive months |
| process | pi session | dashboard server |
| policy | 4 MiB / 1568 px (model input limits) | ~200 KB / 768 px (display) |

Reusing its *code* would couple the server to a pi-extension package whose policy targets
model limits; a shared policy constant would drift into one of the two use cases being
wrong. Call jimp directly.

### D6 — Arm the boot assert atomically with the raise (settled)

`server.ts:673` passes raw `config.maxStringFieldSize` to the store (undefined → default
4000); `:684` passes `?? 0` to `deriveTranscriptCapBytes`, so `maxStringFieldSize !== 0`
is false and the `× 6` check **skips**. The guard a ceiling raise depends on is unarmed.

Fix by passing the store's effective cap. `DEFAULT_MAX_STRING_SIZE` is currently a bare
`const` (line 122) and must be exported. Arming and raising must land **together**:
armed at today's 20 KB ceiling the assert throws (`24_000 ≥ 20_000`); at 256 KB it passes.

### D7 — Originals: transcript is the record, cache is an optimisation (settled)

pi already writes full-resolution bytes to the session JSONL, so no new durable store is
required. The blob cache (2 GB LRU on disk) is a speed optimisation; a miss is recovered
by **streaming** the transcript for the matching content hash — bounded memory, unbounded
time, per the resolved gate.

Consequence: eviction is always safe and there is no orphan-blob correctness problem.

### D8 — Session-scoped, authenticated endpoint (settled)

`GET /api/sessions/:sessionId/attachments/:hash`. Session scoping makes authorisation
natural at the cost of cross-session dedup — acceptable, since dedup was never the point.
A content hash is an identifier, **not** a capability. Responses declare a content type
from the existing `useImagePaste.SUPPORTED_IMAGE_TYPES` allow-list
(`jpeg`/`png`/`gif`/`webp`) and are served with headers preventing interpretation as
active content.

### D9 — Terminal transcript coupling (OPEN)

`terminal-manager.ts:32` derives `DEFAULT_TRANSCRIPT_CAP_BYTES = 0.75 ×` the ceiling.
Raising 20 KB → 256 KB moves the terminal cap 15 KB → 192 KB. Decouple, or accept and
document the shift. Must be settled before the raise lands, since the assert validates
the pair.

## Risks / Trade-offs

- **Lossy default.** 768 px may make UI text unreadable — and UI screenshots are the main
  use case. Click-to-original is the mitigation; if that path is weak the change
  under-delivers.
- **A placeholder is a new failure surface.** "Image never arrives" becomes possible where
  it previously was not.
- **Burst load.** Several large pastes queue behind one worker.
- **Ceiling raise is global**, affecting all event types and moving the heap envelope
  (37 GB → ~478 GB theoretical worst case, unreachable in practice but it is the envelope
  the constant defines).
- **New authenticated binary surface** for originals.
- **Format coverage.** jimp must handle every format the client accepts; an unsupported
  input must fail to the honest placeholder, not a crash.

## Open Questions

- **D9** — decouple the terminal cap derivation, or accept the 15 KB → 192 KB shift?
- Should the fitted derivative be cached so replay does not re-resize every load, or is
  re-fitting on ingest-from-replay acceptable?
- Does the click-to-original overlay need progressive loading for a 10 MB original, or is
  a spinner sufficient?
- Should animated GIFs be exempt from fitting (resize would flatten them), and if so do
  they bypass the ceiling?

## Established facts (verified; do not re-derive)

- Delivery works — the model receives and describes the image. The bug is display-only.
- Store and broadcast are the same object (`event-wiring.ts:575`); `browser-gateway` does
  `ws.send(JSON.stringify(stored))` with **no second bound**.
- 8/8 over-ceiling assistant messages survive; 3/3 image-bearing user messages collapse.
- Only `type: "image"` carries `data` + `mimeType` in real data (1587 occurrences; zero
  audio/file/untyped across 3137 transcripts).
- `isImageBlock` (134) is used only on the depth-limit path (195), not by the line-224
  exemption.
- `?? msg.event` (`event-wiring.ts:575`) is dead code today.
- `walkObjectSize` contains no image logic; its "exempt" comment is stale text.
- `pi-image-fit` IS installed
  (`~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-image-fit-extension`).
