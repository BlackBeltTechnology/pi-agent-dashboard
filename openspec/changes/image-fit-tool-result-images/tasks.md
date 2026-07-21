## 1. Buffer-based resize helpers (TDD)

- [ ] 1.1 In `src/__tests__/resize.test.ts`, add failing tests for `probeDimsFromBuffer(buf)`: returns correct `{width,height}` for a PNG buffer and a JPEG buffer; returns `null` for undecodable bytes.
- [ ] 1.2 In `src/resize.ts`, implement `probeDimsFromBuffer(buf: Buffer): Promise<ImageDims | null>` (jimp decode, null on failure). Make 1.1 pass.
- [ ] 1.3 Add failing tests for `outputFormatForMime(mime)`: `image/png` → `{format:"png", mime:"image/png"}`; `image/webp`/`image/gif`/`image/jpeg` → `{format:"jpeg", mime:"image/jpeg"}`.
- [ ] 1.4 Implement `outputFormatForMime` in `src/resize.ts`. Make 1.3 pass.
- [ ] 1.5 Add failing tests for `resizeBuffer(buf, opts, outFormat)`: 4032×3024 PNG → long edge ≤ 1568 preserving aspect (1568×1176 ±1); returns `{data: Buffer, dims}`; JPEG output honors `quality`.
- [ ] 1.6 Implement `resizeBuffer` in `src/resize.ts` mirroring `resizeToFile`'s jimp scale/encode logic (no temp file). Make 1.5 pass.

## 2. Content-hash cache (TDD)

- [ ] 2.1 Add failing tests for an in-memory content cache: same key returns cached result without re-encode; different `maxEdge` yields a different key (miss); LRU eviction drops the least-recently-used entry once the cap is exceeded.
- [ ] 2.2 Implement a bounded LRU cache (module in `src/` or an addition to `src/cache.ts`) keyed by SHA-256 of `${base64}|${maxEdge}|${maxBytes}|${quality}` → `{ data, mimeType }`, with a fixed entry/byte cap constant. Make 2.1 pass. Do not touch the existing temp-file cache behavior.

## 3. context-event seam (TDD)

- [ ] 3.1 Add failing handler tests (mock `event.messages`) in `src/__tests__/`: oversize tool-result image block is resized and `{messages}` returned; oversize user-message image block is resized; all-small messages → handler returns `undefined`; non-image blocks untouched; `mimeType` updated on format change (png stays png, webp→jpeg).
- [ ] 3.2 Add failing test for the incident case: an 8956×5080 PNG block at ~411 KB (under 4 MiB) IS resized (dimension check, not byte-only short-circuit).
- [ ] 3.3 Add failing fail-open tests: undecodable block passes through with one WARN and no throw; a turn with one bad + one valid oversize block still resizes the valid one.
- [ ] 3.4 Add failing test that `PI_IMAGE_FIT_DISABLE` truthy → `context` handler not registered.
- [ ] 3.5 In `src/extension.ts`, register `pi.on("context", ...)`: iterate `event.messages`, walk array-content blocks, fit `type==="image"` blocks via cache → decode → `probeDimsFromBuffer` + byte size → `needsResize` → `resizeBuffer` + cache-put + replace `data`/`mimeType`; cache no-op verdicts; return `{messages}` only when something changed; wrap in try/catch (fail-open, one WARN). Guard registration behind `!config.disabled`. Make 3.1–3.4 pass.
- [ ] 3.6 Verify the existing `tool_call` read-path seam and its tests are unchanged (no regressions).

## 4. Full suite + docs

- [ ] 4.1 Run the package suite: `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — all green.
- [ ] 4.2 Update `packages/image-fit-extension/AGENTS.md` `README.md` row to note the second seam: `context` event fits oversize `ImageContent` blocks (any origin, reload-safe) via jimp buffer resize + in-memory content-hash cache; no temp file, no native deps.
- [ ] 4.3 Update `packages/image-fit-extension/README.md` to document the `context` seam (what it covers, that it rescues already-saved sessions, that it reuses `PI_IMAGE_FIT_*` and `PI_IMAGE_FIT_DISABLE`).

## 5. Performance validation (Discipline: performance-optimization)

- [ ] 5.1 Add a test/benchmark asserting steady-state cost: a second turn over the same oversize image performs zero additional jimp re-encodes (cache hit assertion) — proves the per-turn hot-path stays cheap.
- [ ] 5.2 Confirm no full jimp decode happens for already-small images beyond the first probe per distinct content (verdict caching), and record the measured cache-hit behavior in the PR description.

## 6. Review (Discipline: review-code)

- [ ] 6.1 Run `review-code` over the diff (design→correctness→complexity→tests→naming→security); resolve findings before commit.
- [ ] 6.2 QA (manual, tested later): reproduce the original failure — resume a session containing an oversize image block and confirm the next LLM call succeeds (within-limits request) with the on-disk transcript unchanged.
