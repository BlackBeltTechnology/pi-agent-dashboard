## 1. Shared single-path inliner

- [ ] 1.1 In `markdown-image-inliner.ts`, expose `inlineLocalImagePath(absPath, opts)` returning the existing `AssetToEmit` / `ReadFileError` shape, reusing `mimeFromExtension`, byte read, base64, `hashBytes`, and the `MAX_PER_IMAGE_BYTES` cap. Refactor `inlineMessageText` to call it if that removes duplication; otherwise add it alongside.
- [ ] 1.2 Unit-test: existing image path → asset; missing file → error; over-`MAX_PER_IMAGE_BYTES` → error; non-image ext → skipped.

## 2. Inline path-referenced image results in the bridge

- [ ] 2.1 In `event-forwarder.ts` at `tool_execution_end`, scan the result text for absolute paths ending in a recognized image extension that resolve to existing files.
- [ ] 2.2 Inline each (up to a per-result count cap, e.g. 4) via `inlineLocalImagePath`, accumulating against `MAX_PER_MESSAGE_BYTES`; attach as `type:"image"` content blocks on the forwarded result.
- [ ] 2.3 Consume the inlined path so it is NOT also emitted as a text link (D5). Leave over-cap / non-existent paths as text (fall back to Fix A).
- [ ] 2.4 Unit-test the extraction: single screenshot path → one image block + no link; two paths, one over cap → one inlined + one link; non-image path → untouched.

## 3. Client renders inlined image blocks for any tool

- [ ] 3.1 Verify the generic tool-call renderer (not only `ReadToolRenderer`) displays `type:"image"` blocks from a tool result; extend minimally if non-Read tools ignore them.
- [ ] 3.2 Auto-expand a tool call that carries an inlined image (match archived `inline-image-tool-results` behavior).
- [ ] 3.3 Component test: a `browser`/bash tool result carrying an image block renders an inline `<img>`, auto-expanded, with no path-link for that image.

## 4. Integration + reload

- [ ] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log` green; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` empty.
- [ ] 4.2 After merge, `npm run reload` to load the new bridge into connected sessions; manually verify a `screenshot --full` result renders inline (no "Failed to load image").

## 5. Cross-reference

- [ ] 5.1 Note in `serve-agent-artifact-previews` that Fix B (this change) is the primary path and A is the over-cap / legacy fallback.
