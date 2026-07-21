## 1. Buffer-based resize helpers (implementation)

- [ ] 1.1 Add `probeDimsFromBuffer(buf: Buffer): Promise<ImageDims | null>` to `src/resize.ts` (jimp decode; null on undecodable).
- [ ] 1.2 Add `outputFormatForMime(mime: string): { format: "png" | "jpeg"; mime: string }` to `src/resize.ts` (`image/png`→PNG; else JPEG). Do not reuse the file-extension `outputFormatFor` on the buffer path.
- [ ] 1.3 Add `resizeBuffer(buf, opts, outFormat): Promise<{ data: Buffer; dims }>` to `src/resize.ts`, mirroring `resizeToFile`'s long-edge jimp scale/encode (no temp file).
- [ ] 1.4 Add a cheap image-header dimension probe (`probeDimsFromHeader(buf)` for PNG IHDR / JPEG SOF / WEBP VP8x / GIF logical-screen) + a byte estimate from base64 length; jimp-decode fallback only when the header can't be parsed (design D4).

## 2. Content-hash cache (implementation)

- [ ] 2.1 Implement a bounded in-memory LRU (in `src/` or extending `src/cache.ts`) keyed by SHA-256 of `${base64}|${mimeType}|${maxEdge}|${maxBytes}|${quality}` → `{ data, mimeType }`, evicting by a fixed byte budget (default constant ~64 MiB, injectable for tests). Leave the existing temp-file cache untouched.
- [ ] 2.2 Wire the cheap-probe gate → hash → cache lookup → `resizeBuffer` ordering so within-limit images are never hashed or cached (design D4/D3).

## 3. context-event seam (implementation)

- [ ] 3.1 Register `pi.on("context", ...)` in `src/extension.ts`, guarded behind `!config.disabled`.
- [ ] 3.2 Role-agnostic traversal: iterate every message, guard `Array.isArray(content)`, fit `type==="image"` blocks in place; do not branch on role.
- [ ] 3.3 Return `{ messages }` only when at least one block changed, else `undefined`; wrap the whole handler in try/catch with fail-open + single-WARN per failed block, isolating each block so one failure never blocks siblings.

## 4. Docs

- [ ] 4.1 Update `packages/image-fit-extension/AGENTS.md` `README.md` row: second seam — `context` event fits oversize `ImageContent` of any origin (role-agnostic, reload-safe) via jimp buffer resize + mime-keyed bounded LRU; cheap-probe gate; no temp file, no native deps.
- [ ] 4.2 Update `packages/image-fit-extension/README.md`: document the `context` seam (covers tool_result + user-pasted + historical, rescues already-saved sessions, reuses `PI_IMAGE_FIT_*` + `PI_IMAGE_FIT_DISABLE`; GIF→JPEG loses animation).

## 5. Tests — folded from test-plan.md (TDD: author test first, watch it fail, then implement to green)

### 5.A L1 unit — automated (vitest, `packages/image-fit-extension/src/__tests__/`)

- [ ] 5.1 E1: 1569×800 `image/png` block (~200 KB) · context handler runs · block resized long edge ≤1568, `{messages}` returned. (see `src/__tests__/extension.test.ts`) (test-plan #E1)
- [ ] 5.2 E2: exactly 1568×800 `image/png` block, <4 MiB · handler runs · NOT resized, returns `undefined`. (see `src/__tests__/extension.test.ts`) (test-plan #E2)
- [ ] 5.3 E3 (incident): 8956×5080 `image/png` block ~411 KB (<4 MiB) · handler runs · resized (long edge ≤1568) — proves dims checked, not byte-only. (see `src/__tests__/extension.test.ts`) (test-plan #E3)
- [ ] 5.4 E4: block ≤1568 px but decoded bytes >4 MiB · handler runs · resized/re-encoded smaller. (see `src/__tests__/extension.test.ts`) (test-plan #E4)
- [ ] 5.5 E5: three oversize blocks png/webp/gif · handler runs · png→image/png out, webp→image/jpeg, gif→image/jpeg (first frame). (see `src/__tests__/resize.test.ts`) (test-plan #E5)
- [ ] 5.6 E6: oversize `image/png` 4032×3024 · resizeBuffer · output 1568×1176 (±1 px). (see `src/__tests__/resize.test.ts`) (test-plan #E6)
- [ ] 5.7 E7: oversize image in a custom/non-user/non-tool role message · handler runs · block resized (role-agnostic). (see `src/__tests__/extension.test.ts`) (test-plan #E7)
- [ ] 5.8 E8: message whose `content` is a plain string · handler runs · skipped, no throw, no WARN. (see `src/__tests__/extension.test.ts`) (test-plan #E8)
- [ ] 5.9 E9: one message, 2 oversize + 1 within-limit block · handler runs · both oversize resized, small untouched, single `{messages}`. (see `src/__tests__/extension.test.ts`) (test-plan #E9)
- [ ] 5.10 E10: all image blocks within limits · handler runs · returns `undefined`, no allocation. (see `src/__tests__/extension.test.ts`) (test-plan #E10)
- [ ] 5.11 E11: text + tool-call blocks, no image · handler runs · all blocks byte-identical, returns `undefined`. (see `src/__tests__/extension.test.ts`) (test-plan #E11)
- [ ] 5.12 E12: `PI_IMAGE_FIT_DISABLE=1` at load · extension loads · `context` handler not registered, content never inspected. (see `src/__tests__/extension.test.ts`) (test-plan #E12)
- [ ] 5.13 E13: two oversize blocks, identical base64, mimes image/png vs image/webp · handler runs · two distinct cache keys, each re-encoded to its own format. (see `src/__tests__/cache.test.ts`) (test-plan #E13)
- [ ] 5.14 E14: same oversize block on turn 1 and turn 2 · handler runs twice · `resizeBuffer` invoked exactly once (turn 2 from cache). (see `src/__tests__/cache.test.ts`) (test-plan #E14)
- [ ] 5.15 E15: oversize image cached, then `PI_IMAGE_FIT_MAX_EDGE` changed · handler runs again · new key → fresh resize. (see `src/__tests__/cache.test.ts`) (test-plan #E15)
- [ ] 5.16 E16: injected small byte budget, distinct oversize fits exceed it · Nth fit added · LRU entry evicted, re-access re-resizes. (see `src/__tests__/cache.test.ts`) (test-plan #E16)
- [ ] 5.17 E17: one within-limit image block · handler runs · hash + cache-put spies NOT invoked for that block. (see `src/__tests__/extension.test.ts`) (test-plan #E17)
- [ ] 5.18 E18: messages loaded from a transcript file with an oversize block · handler runs · returned deep-copy block fitted AND source transcript file bytes unchanged. (see `src/__tests__/extension.test.ts`) (test-plan #E18)
- [ ] 5.19 P1: one within-limit image over one turn · handler runs · full jimp pixel-decode invocations = 0 (header probe only). (see `src/__tests__/extension.test.ts`) (test-plan #P1)
- [ ] 5.20 P2: one oversize block across 3 consecutive turns · handler runs · `resizeBuffer` invocations = 1 total (cached after first). (see `src/__tests__/extension.test.ts`) (test-plan #P2)
- [ ] 5.21 X1: image block with non-decodable base64 flagged oversize by byte estimate · handler runs · block unchanged, exactly one WARN, no throw, turn proceeds. (see `src/__tests__/extension.test.ts`) (test-plan #X1)
- [ ] 5.22 X2: turn with one undecodable oversize + one valid oversize block · handler runs · valid resized, bad passes through. (see `src/__tests__/extension.test.ts`) (test-plan #X2)
- [ ] 5.23 X3: jimp encode made to throw for one block · handler runs · that block unchanged + one WARN, sibling blocks still processed. (see `src/__tests__/extension.test.ts`) (test-plan #X3)
- [ ] 5.24 X4: valid oversize image whose header the cheap probe cannot parse · handler runs · falls back to bounded jimp decode and still fits it. (see `src/__tests__/resize.test.ts`) (test-plan #X4)

### 5.B Manual — deferred to post-merge verification

- [ ] 5.25 M1: spawn a subagent (`Agent` tool) whose tool result surfaces an oversize image · subagent LLM call fires · record whether the parent session's `context` handler fits it or the image bypasses — resolves design Open Question #1. (test-plan: manual-only)
- [ ] 5.26 M2: resume a real transcript with an oversize image block (the `019f8604` failure mode) · next LLM call fires · provider request succeeds (within limits) with on-disk transcript unchanged. (test-plan: manual-only)

## 6. Suite + review

- [ ] 6.1 Run the package suite: `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — all green; confirm the existing `tool_call` read-path seam tests still pass (no regression).
- [ ] 6.2 Run `review-code` over the diff (design→correctness→complexity→tests→naming→security); resolve findings before commit. (Discipline: review-code)
