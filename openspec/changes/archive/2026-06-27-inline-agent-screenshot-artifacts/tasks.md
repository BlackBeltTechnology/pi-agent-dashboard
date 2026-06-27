## 1. Shared single-path inliner

- [x] 1.1 In `markdown-image-inliner.ts`, expose `inlineLocalImagePath(absPath, opts)` returning the existing `AssetToEmit` / `ReadFileError` shape, reusing `mimeFromExtension`, byte read, base64, `hashBytes`, and the `MAX_PER_IMAGE_BYTES` cap. Refactor `inlineMessageText` to call it if that removes duplication; otherwise add it alongside.
- [x] 1.2 Unit-test: existing image path → asset; missing file → error; over-`MAX_PER_IMAGE_BYTES` → error; non-image ext → skipped.

## 2. Inline path-referenced image results in the bridge

- [x] 2.1 In `bridge.ts` at `tool_execution_end` (implemented here, not `event-forwarder.ts`), scan the result text for absolute paths ending in a recognized image extension that resolve to existing files (via `tool-result-image-inliner.ts`).
- [x] 2.2 Inline each (up to a per-result count cap, e.g. 4) via `inlineLocalImagePath`, accumulating against `MAX_PER_MESSAGE_BYTES`; attach as `type:"image"` content blocks on the forwarded result.
- [x] 2.3 Consume the inlined path so it is NOT also emitted as a text link (D5). Leave over-cap / non-existent paths as text (fall back to Fix A).
- [x] 2.4 Unit-test the extraction: single screenshot path → one image block + no link; two paths, one over cap → one inlined + one link; non-image path → untouched.

## 3. Client renders inlined image blocks for any tool

- [x] 3.1 Verify the generic tool-call renderer (not only `ReadToolRenderer`) displays `type:"image"` blocks from a tool result; extend minimally if non-Read tools ignore them.
- [x] 3.2 Auto-expand a tool call that carries an inlined image (match archived `inline-image-tool-results` behavior).
- [x] 3.3 Component test: a `browser`/bash tool result carrying an image block renders an inline `<img>`, auto-expanded, with no path-link for that image.

## 4. Integration + reload

- [x] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log` green; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` empty.
- [x] 4.2 Automated via Docker E2E `tests/e2e/inline-screenshot.spec.ts` (faux `[[faux:tool-screenshot]]` scenario): real `bash` writes a PNG + echoes its path → real bridge inlines → inline `data:image/png` `<img>` renders, path stripped from result (D5). Verified green 3/3 on a clean container. (Post-merge `npm run reload` still applies to deploy the bridge to the locally-running dashboard.)

## 5. Cross-reference

- [x] 5.1 Note in `serve-agent-artifact-previews` that Fix B (this change) is the primary path and A is the over-cap / legacy fallback.
