## Why

`pi-image-fit` only fits images that enter a session through the built-in `read` tool (a `tool_call` hook that rewrites `event.input.path`). Every other image origin bypasses it: tool-result images (browser/MCP screenshots emitted as inline base64), user-pasted/attached images, and images already persisted in a session transcript. Session `019f8604` was corrupted by an 8956×5080 browser screenshot (a `tool_result` image, over Anthropic's 8000 px per-side limit) — the whole provider request was rejected as "image too large," and because the `read` hook never sees tool-result content, the extension could not prevent it. Worse, once such an image is persisted, no creation-time hook can rescue the session on reload.

## What Changes

- Add a **`context` event** handler to the extension — fired before every LLM call, exposing `event.messages` (a deep copy, safe to mutate, returned via `{ messages }`). Scan all message content blocks for `ImageContent` (`{ type: "image", data, mimeType }`); for each block whose decoded bytes or long-edge pixels exceed the configured thresholds, resize in-memory with jimp and replace `data` + `mimeType`, then return the patched message list.
- This single seam is a **catch-all**: it fits images from any origin (tool_result, user-pasted, historical) and, because it operates on the in-flight deep copy before each provider call, it **rescues already-persisted oversize sessions** on reload — a case no creation-time (`tool_call`/`tool_result`) hook can cover.
- Add **buffer-based** resize/probe helpers (`probeDimsFromBuffer`, `resizeBuffer`) alongside the existing file-path helpers (`probeDims`, `resizeToFile`), reusing the same threshold policy (`maxEdge` 1568, `maxBytes`, `quality`) and the jimp-only, no-native-dependency constraint.
- Add a **content-hash cache** (SHA-256 of `base64|maxEdge|maxBytes|quality` → resized base64) so the `context` hook, which runs every turn, does not re-encode the same historical image on each call. The on-disk transcript is left untouched (the hook mutates only the deep copy); the request sent to the model is always within limits.
- The existing `tool_call` `read`-path seam is **unchanged** — it still shrinks what gets persisted to disk for `read` images; the new `context` seam is the safety net for every other path.

## Capabilities

### New Capabilities

(none — this extends the existing capability)

### Modified Capabilities

- `pi-image-fit`: adds a second interception seam (the `context` event) that fits oversize images in message content of any origin, backed by buffer-based resize helpers and a content-hash cache. The existing `tool_call` read-path requirements are retained unchanged.

## Impact

- **Code:** `packages/image-fit-extension/src/extension.ts` (new `context` handler), `src/resize.ts` (buffer helpers), `src/cache.ts` (content-hash keying for in-memory results), plus `src/__tests__/` coverage.
- **Dependencies:** none added — jimp only; no `sharp`/native binaries (existing constraint preserved).
- **Performance:** the `context` hook runs on every LLM call; the content-hash cache keeps the steady-state cost to a hash + map lookup for unchanged images. Latency-sensitive path — see Discipline Skills.
- **Behavior:** oversize images are silently fitted before reaching the provider; on any failure the handler falls through leaving messages unmodified (matching the existing fail-open contract). No config or API breakage; new thresholds reuse existing `PI_IMAGE_FIT_*` env vars.
- **Docs/QA:** `packages/image-fit-extension/AGENTS.md` row update; `qa/tests/09-image-fit-extension.*` may gain a tool-result/context scenario.

## Discipline Skills

- `performance-optimization`: the `context` hook is a per-turn, large-data (image-byte) path; the content-hash cache and probe short-circuits must be measured, not assumed.
- `review-code`: non-trivial change to a published extension's core interception logic before commit.
