## Context

`pi-image-fit` (`packages/image-fit-extension/`) currently fits images through one seam: a `pi.on("tool_call")` handler that, for the built-in `read` tool on an image path, resizes the file on disk and rewrites `event.input.path`. Helpers are file-path oriented — `probeDims(srcPath)`, `resizeToFile(srcPath, dstPath, opts)` in `src/resize.ts`; config is `readConfigFromEnv()` in `src/policy.ts` (`maxEdge` 1568, `maxBytes` 4 MiB, `quality` 85); a temp-file cache lives in `src/cache.ts`.

The gap (proposal): images that enter a session as **message content** — `ImageContent = { type: "image", data: <base64>, mimeType }` — never pass through the `read` tool, so they bypass fitting entirely. This includes browser/MCP screenshot `tool_result` blocks, user-pasted images, and images already persisted in a transcript. Session `019f8604` was killed by an 8956×5080 tool-result screenshot (411 KB — **under** the 4 MiB byte threshold but **over** the 1568 px / 8000 px-hard-limit edge threshold), and because the image was already persisted, no creation-time hook could have rescued it on reload.

pi exposes a `context` event: "Fired before each LLM call. `event.messages` — deep copy, safe to modify," returning `{ messages }`. This is the one seam that sees every image feeding every provider call, from any origin, on every turn (including reloads).

## Goals / Non-Goals

**Goals:**
- Fit oversize `ImageContent` blocks in message content of any origin before they reach the provider, using the existing threshold policy and jimp-only constraint.
- Rescue already-persisted oversize sessions: reloading a "poisoned" transcript must produce a within-limits request.
- Keep the per-turn cost near-zero for the steady state (unchanged images) via a content-hash cache.
- Preserve the existing fail-open contract: any failure leaves messages unmodified.

**Non-Goals:**
- Rewriting the on-disk transcript. The `context` hook mutates only pi's deep copy; original bytes stay on disk. (The existing `read`-path seam still shrinks persisted `read` images.)
- Removing or changing the existing `tool_call` `read`-path seam.
- Adding a `tool_result` seam. The `context` seam is a strict superset for this purpose (it also catches user-pasted + historical images and reload rescue); a second creation-time seam would duplicate work.
- New dependencies. jimp only; no `sharp`/native binaries.

## Decisions

**D1 — Single `context` seam over `tool_result`-only or `before_provider_request`.**
`tool_result` fires once at tool-execution time: it cannot see user-pasted images and cannot rescue an already-saved session on reload. `before_provider_request` exposes a provider-specific serialized payload ("mainly useful for debugging"), so image mutation there would be provider-coupled and fragile. `context` operates on pi's provider-agnostic `AgentMessage[]` deep copy before every call — one handler, all origins, reload-safe. Chosen. (Confirmed with the user.)

**D2 — Buffer-based resize/probe helpers alongside the file-path ones.**
Add to `src/resize.ts`:
- `probeDimsFromBuffer(buf: Buffer): ImageDims | null` — dimensions from image bytes (returns null on undecodable).
- `resizeBuffer(buf: Buffer, opts: ResizeOptions, outFormat: "png" | "jpeg"): Promise<{ data: Buffer; dims: ImageDims }>` — long-edge scale to `maxEdge` preserving aspect ratio, re-encode to the chosen format (mirrors `resizeToFile`'s jimp logic).
- `outputFormatForMime(mime: string): { format: "png" | "jpeg"; mime: string }` — `image/png` → PNG (lossless); everything else (`image/jpeg`, `image/webp`, `image/gif`) → JPEG@quality. Mirrors the existing extension-based `outputFormatFor`.

The existing `needsResize({ bytes, maxBytes, dims, maxEdge })` predicate is reused unchanged; `bytes` = decoded buffer length.

**D3 — Content-hash cache, in-memory, bounded.**
Key = SHA-256 of `${base64Data}|${maxEdge}|${maxBytes}|${quality}` → cached `{ data: base64, mimeType }`. Because the same historical image reappears in `event.messages` every turn, an in-memory `Map` keyed by content makes repeat turns a hash + lookup with no re-decode. The cache is bounded (cap on entry count / total cached bytes, LRU eviction) so long sessions with many distinct images can't grow memory without limit. This is separate from the existing on-disk temp-file cache (which stays dedicated to the `read`-path seam); the `context` path never writes temp files.

**D4 — Probe-then-fit gate; dimensions are mandatory.**
The incident image proves a byte-only short-circuit is unsafe (411 KB < 4 MiB yet 8956 px > threshold). Every candidate image must have its dimensions checked. To keep this cheap, probe dimensions from the image header (cheap parse) rather than a full jimp decode when possible; full jimp decode happens only when `needsResize` is true and we actually re-encode. Order per image block: cache-lookup → (miss) decode base64 → probe dims + bytes → `needsResize`? → resize + cache-put + replace `data`/`mimeType`; else cache the "no-op" verdict to skip re-probing next turn.

**D5 — Mutate-and-return only on change.**
Iterate `event.messages`; for each message whose `content` is an array, walk blocks and fit `type === "image"` blocks in place. Track whether any block changed. Return `{ messages }` only when at least one image was resized; otherwise return `undefined` (no-op) so pi keeps the original list and we add zero allocation on clean turns.

**D6 — Fail-open, matching the existing contract.**
The whole handler body is wrapped in try/catch. Undecodable/oversized-throw/any error → log one `[pi-image-fit] WARN …` line and return `undefined` (messages unmodified). A single bad image never blocks the turn.

## Risks / Trade-offs

- **Per-turn overhead on the hot path** → content-hash cache (D3) + no-op verdict caching (D4) reduce steady state to a hash per image; header-only dimension probe avoids full decode on already-small images. Perf to be measured, not assumed (`performance-optimization` discipline).
- **Unbounded cache memory in long, image-heavy sessions** → bounded LRU cache with an entry/byte cap (D3).
- **On-disk transcript still holds original oversize bytes** → accepted (Non-Goal); the request to the provider is always within limits, which is what fixes the session. The `read`-path seam continues to shrink persisted `read` images.
- **Double handling of `read`-path images** (shrunk on disk, then re-probed by `context`) → the probe hits the cache after the first turn and finds them under threshold; cost is one cached lookup.
- **jimp cannot decode an exotic variant** → fail-open (D6): that block passes through unchanged, exactly as today.

## Migration Plan

Additive, no breaking changes, no new env vars (reuses `PI_IMAGE_FIT_*`; `PI_IMAGE_FIT_DISABLE` also disables the new handler). Deploy = publish the extension via the existing workspace release pipeline. Rollback = remove the `context` handler registration; the `read`-path seam and all existing behaviour are untouched.

## Open Questions

- Cache bound sizing: default cap (e.g. N entries or M MiB) — pick a conservative default, make it a constant, revisit if measurement shows pressure.
- Header-only dimension probe (PNG IHDR / JPEG SOF parse) vs. always jimp-decode for dims: implement the cheap path if profiling shows decode dominates; otherwise start with jimp `probeDimsFromBuffer` for simplicity and let the cache absorb repeats.
