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

### D4 — Resize runs off the event loop (settled; rationale CORRECTED)

Resize runs in a `worker_threads` pool (`fit-worker-pool.ts`, size 2).

**The original rationale was wrong.** It assumed jimp is pure-JS + single-threaded, so an
inline resize would stall the event loop for its 174–874 ms. Measured, that does not
happen: jimp v1's async API yields, so in-process fitting blocks the loop for ~0 ms.

Measured on a 5 x 1.84 MB base64 burst (1600x1200 PNG), 3 consecutive runs, 16-CPU host,
outside the test runner:

| path | wall time | max event-loop lag |
|---|---|---|
| in-process | ~1710 ms | 0 ms |
| worker pool (2 slots) | ~1030 ms | 1 ms |
| `structuredClone` only | ~6 ms | 0 ms |

**The decision stands, for different reasons:** the pool is ~1.7x faster on a burst
(parallelism across slots) and keeps CPU-heavy decode/encode off the main thread's CPU
share, at negligible lag cost. Payload transfer is NOT a bottleneck — cloning the base64
across the boundary costs ~6 ms, disproving the concern that `postMessage` serialization
would dominate.

Caveats: measured on 16 CPUs; on a 2-core host the parallelism gain shrinks and each
worker's decoded bitmap costs RSS, which is why `size` is a conservative 2.

Measurement pitfall recorded for whoever revisits this: an earlier reading inside vitest
reported ~1030 ms of "worker lag". That number was the burst's WALL TIME leaking into the
sample (runner CPU contention + worker startup), not loop blocking. Measure this outside
the test runner.


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

### D9 — Terminal transcript coupling (settled)

`terminal-manager.ts:32` derives `DEFAULT_TRANSCRIPT_CAP_BYTES = 0.75 ×` the ceiling.
Raising 20 KB → 256 KB moves the terminal cap 15 KB → 192 KB.

**Decision: accept the shift and document it.** The derivation stays coupled — one
constant, one rule. Inline terminal transcripts may now carry ~12× more bytes before the
tail-keeping cap trims them. The boot assert continues to validate the pair.

### D10 — Fitted derivatives are NOT cached (reversed; originally "cached")

Originally settled as "cache the fitted derivative on disk, keyed by content hash", to
avoid re-fitting on every replay. **Reversed after implementation, on evidence.**

Two facts, both verified in code and by measurement, removed the justification:

1. **Warm replay never re-fits.** `prepareEventForIngest` is called only in the COLD
   `directoryService` branch of `subscription-handler.ts`. An ordinary reload takes the
   warm branch, which replays stored events already containing the placeholder rows AND
   their `attachment_fitted` events. Re-fitting happens only when the session's buffer has
   been evicted entirely.
2. **The two-phase render already hides the cold-open cost.** Rows render immediately;
   fitting runs off the loop across the pool; images fill in progressively. Hiding that
   latency is precisely what D3/D12 exist to do, so a cache would optimise a path whose
   latency is not user-visible.

`DISPLAY_MAX_BYTES` also bounds each derivative at 240 KB, so a cold re-fit is bounded
work, not an unbounded tail.

**D7 knock-on: the 2 GB LRU originals blob cache is dropped too.** Originals are recovered
by streaming the session transcript, measured at <50 MB RSS for a ~40 MB transcript (P4).
The transcript is authoritative (D7), so the cache was always an optimisation — and the
click-to-original path is explicitly NOT load-bearing. Adding 2 GB of disk-cache
machinery (eviction, cap accounting, cleanup, staleness) to accelerate it fails the
simplicity bar.

Revisit only if cold-open latency for image-heavy sessions is MEASURED as a problem; the
scenarios that would have covered the caches (X4/X5) are dropped with them.


### D11 — Animated GIFs are exempt from fitting (settled)

jimp resize flattens animation. **Decision: detect animated GIFs and exempt them from
fitting; they remain subject to the existing ceiling and truncate as they do today.**
Animation is preserved when the payload is small; a large animated GIF still collapses,
which is no worse than current behaviour. Never emit a corrupt frame (scenario X10).

### D12 — Phase 2 ships as its own resolution event (settled)

The fitted bytes reach the client as a SEPARATE stored+broadcast event carrying
`{attachmentId, data, mimeType, state}` (`buildFittedEvent`); the block is addressed by
the sha256 of the ORIGINAL BASE64 TEXT, NOT by `{targetSeq, blockIndex}` — the live fold is
append-only and never sees a seq, and `state` lets a FAILED fit resolve the placeholder
honestly instead of leaving it pending. The client reducer gains one additive case
that patches the already-folded message. Rejected: re-broadcasting the row at the same
`seq` — the client fold (`useSessionState.ts`, `foldLiveEvents`) is append-only, so a
second fold of `message_start` duplicates the row; making it safe needs replace-by-seq
semantics inside the reducer SHARED with replay and the virtualized row-height invariant
(F8). Rejected: synchronous fit before first store — violates "row renders before image".

Side benefit: the row event stays small and the ≤212 KB fitted payload rides its own
event, so each is independently well under the 256 KiB ceiling.

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

- Does the click-to-original overlay need progressive loading for a 10 MB original, or is
  a spinner sufficient?

Resolved: D9 (accept the 15 KB → 192 KB shift), D10 (do NOT cache fitted derivatives —
reversed on evidence after implementation; the D7 originals blob cache is dropped with
it), D11 (exempt animated GIFs from fitting, keep them under the ceiling).

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
