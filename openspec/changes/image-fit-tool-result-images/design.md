## Context

`pi-image-fit` (`packages/image-fit-extension/`) currently fits images through one seam: a `pi.on("tool_call")` handler that, for the built-in `read` tool on an image path, resizes the file on disk and rewrites `event.input.path`. Helpers are file-path oriented — `probeDims(srcPath)`, `resizeToFile(srcPath, dstPath, opts)` in `src/resize.ts`; config is `readConfigFromEnv()` in `src/policy.ts` (`maxEdge` 1568, `maxBytes` 4 MiB, `quality` 85); a temp-file cache lives in `src/cache.ts`.

The gap (proposal): images that enter a session as **message content** — `ImageContent = { type: "image", data: <base64>, mimeType }` — never pass through the `read` tool, so they bypass fitting entirely. This includes browser/MCP screenshot `tool_result` blocks, user-pasted images, and images already persisted in a transcript. Session `019f8604` was killed by an 8956×5080 tool-result screenshot (411 KB — **under** the 4 MiB byte threshold but **over** the 1568 px / 8000 px-hard-limit edge threshold), and because the image was already persisted, no creation-time hook could have rescued it on reload.

pi exposes a `context` event: "Fired before each LLM call. `event.messages` — deep copy, safe to modify," returning `{ messages }`. This is the one seam that sees every image feeding every provider call, from any origin, on every turn (including reloads).

## Goals / Non-Goals

**Goals:**
- Fit oversize `ImageContent` blocks in message content of any origin, in every message regardless of role (user, tool result, or custom/injected), before they reach the provider on this session's agent-loop LLM calls, using the existing threshold policy and jimp-only constraint.
- Rescue already-persisted oversize sessions: reloading a "poisoned" transcript must produce a within-limits request on the next call.
- Keep the per-turn cost of an image already within limits to a cheap header-dimension probe (no full decode, no hash); an oversize image costs one hash + one resize, reused across turns via the content-hash cache.
- Preserve the existing fail-open contract: any failure leaves messages unmodified.

**Non-Goals:**
- Rewriting the on-disk transcript. The `context` hook mutates only pi's deep copy; original bytes stay on disk. (The existing `read`-path seam still shrinks persisted `read` images.)
- Removing or changing the existing `tool_call` `read`-path seam.
- Adding a `tool_result` seam. The `context` seam is a strict superset for this purpose (it also catches user-pasted + historical images and reload rescue); a second creation-time seam would duplicate work.
- Guaranteeing fitting inside nested subagent sessions whose LLM calls may not route through this session's extension runner — see Risks/Open Questions; this change covers the main session's agent loop and must be verified for subagents, not assumed.
- Preserving GIF animation. jimp decodes the first frame only; an oversize `image/gif` becomes a static JPEG (same as the existing `read`-path). Accepted trade-off.
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
Key = SHA-256 of `${base64Data}|${mimeType}|${maxEdge}|${maxBytes}|${quality}` → cached `{ data: base64, mimeType }`. `mimeType` is part of the key because the output format is mime-derived (D2): two blocks with identical bytes but different declared mime must not collide and serve the wrong format. Because the same oversize historical image reappears in `event.messages` every turn, an in-memory `Map` keyed by content makes repeat turns a hash + lookup with no re-decode/re-encode. Only images that clear the cheap-probe gate (D4 — i.e. oversize candidates) are ever hashed or cached; within-limit images never reach the hash. The cache is bounded — a fixed byte budget (default constant, e.g. 64 MiB) with LRU eviction by bytes — so long sessions with many distinct oversize images can't grow memory without limit. This is separate from the existing on-disk temp-file cache (which stays dedicated to the `read`-path seam); the `context` path never writes temp files.

**D4 — Cheap-probe gate first; full decode only on the resize path.**
The incident image proves a byte-only short-circuit is unsafe (411 KB < 4 MiB yet 8956 px > threshold), so dimensions must always be checked — but a full `jimp` decode of every image every turn would violate the steady-state cost goal (both reviewers). Resolution: probe dimensions from the image **header bytes** (PNG IHDR / JPEG SOF / WEBP VP8x / GIF logical-screen — a few bytes, microseconds, no pixel decode) and estimate byte size from base64 length. Order per image block:
1. Cheap header-probe dims + byte estimate. If within both thresholds → **skip** (no hash, no decode, no cache). This is the steady-state path for the vast majority of images.
2. Oversize candidate → compute the content hash, look up the cache. Hit → replace `data`/`mimeType` from the cached result (no decode).
3. Miss → full `jimp` decode + `resizeBuffer` → cache-put → replace `data`/`mimeType`.

The full pixel decode happens only on step 3 (an actual resize). Steady-state cost for a within-limit image is one header parse; for a cached oversize image it is one hash + one map lookup.

**D5 — Role-agnostic traversal; mutate-and-return only on change.**
Iterate **every** message in `event.messages` regardless of role (user, tool result, and custom/injected messages all carry `content: (TextContent | ImageContent)[]` and all reach the provider after `convertToLlm`); for each message whose `content` is an array (guard `Array.isArray` — a `UserMessage.content` may be a plain string, which carries no image and is skipped), walk blocks and fit `type === "image"` blocks in place. Do NOT branch on role — a role-specific traversal (like the existing `read`-path seam) would let custom/injected oversize images bypass fitting and break the any-origin contract. Track whether any block changed. Return `{ messages }` only when at least one image was resized; otherwise return `undefined` so pi keeps the original list and we skip re-emitting. (Note: pi already `structuredClone`s `event.messages` every turn before handlers run, so the deep copy exists regardless; returning `undefined` avoids our re-emit, not the framework clone.)

**D6 — Fail-open, matching the existing contract.**
The whole handler body is wrapped in try/catch. Undecodable/oversized-throw/any error → log one `[pi-image-fit] WARN …` line and return `undefined` (messages unmodified). A single bad image never blocks the turn.

## Risks / Trade-offs

- **Per-turn overhead on the hot path** → the cheap header-probe gate (D4) keeps within-limit images to a header parse (no hash, no decode); only oversize images hash + resize, cached across turns (D3). Perf measured, not assumed (`performance-optimization` discipline) — the steady-state assertion is a test, not a claim.
- **Cache memory in long, image-heavy sessions** → bounded byte-budget LRU (D3, default ~64 MiB), evicting least-recently-used oversize fits.
- **On-disk transcript still holds original oversize bytes** → accepted (Non-Goal); the request to the provider is always within limits, which is what fixes the session. The `read`-path seam continues to shrink persisted `read` images.
- **Double handling of `read`-path images** (shrunk on disk, then re-probed by `context`) → the cheap header-probe finds them under threshold and skips — no hash, no decode.
- **Subagent coverage unproven** → whether a nested subagent's LLM call fires this session's `context` handler is undocumented in pi. Both reviewers flagged this as an assumption. Mitigation: a verification task probes it (see Open Questions); the contract is scoped to the main session's agent loop until proven. If subagents bypass it, that is a follow-up, not a regression (today nothing fits them).
- **A later `context` handler could discard the fit** → handlers chain (`currentMessages = handlerResult.messages`); a subsequent extension that returns a freshly-reconstructed messages array (not derived from the one it received) would drop image-fit's resized blocks. Out of our control; low likelihood (filter/map handlers are safe). Documented so a future integration knows to keep image-fit late in load order or middleware-style.
- **Cold-turn latency on the rescue path** → resuming a poisoned session with many oversize images decodes+resizes them sequentially (`await` loop) before the first LLM call. One-time cost, fail-open per image; acceptable. Parallelizing is a possible later optimization, not required.
- **`blockImages` mode** → if image reading is disabled, `convertToLlm` replaces images with a text placeholder *after* our fit → wasted resize work (bounded by cache), not a correctness bug. Not worth a pre-check in the `context` handler.
- **jimp cannot decode an exotic variant** → fail-open (D6): that block passes through unchanged, exactly as today.
- **GIF animation loss** → oversize `image/gif` → static JPEG first frame (Non-Goal). Same as the existing `read`-path; tool-result/user GIFs are the newly-affected surface.

## Migration Plan

Additive, no breaking changes, no new env vars (reuses `PI_IMAGE_FIT_*`; `PI_IMAGE_FIT_DISABLE` also disables the new handler). Deploy = publish the extension via the existing workspace release pipeline. Rollback = remove the `context` handler registration; the `read`-path seam and all existing behaviour are untouched.

## Open Questions

- **Subagent seam coverage (verify during build):** does a nested subagent (`Agent` tool) LLM call fire this session's `context` handler? A build task must probe this empirically (spawn a subagent that surfaces an oversize image, assert the request is fitted or confirm it bypasses). Result decides whether the any-origin contract extends to subagents or is explicitly scoped out.
- **Cheap header-probe coverage:** header dimension parsing must cover PNG/JPEG/WEBP/GIF (the `isImagePath`/mime allowlist). Confirm each format's header is parseable without a full decode; fall back to a bounded jimp decode only for a format whose header can't be cheaply read.
- **Cache byte budget default:** start at a conservative constant (~64 MiB); revisit if measurement shows pressure or thrash.
