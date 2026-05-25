## 1. Protocol field additions

- [ ] 1.1 Add optional `images?: ImageContent[]` to `PromptResponse` interface in `packages/extension/src/prompt-bus.ts`
- [ ] 1.2 Add optional `images?: ImageContent[]` to `PromptResponseBrowserMessage` in `packages/shared/src/browser-protocol.ts`
- [ ] 1.3 Update any existing tests under `packages/extension/src/__tests__/prompt-bus*.test.ts` to confirm the new field is optional and ignored by existing adapters
- [ ] 1.4 Verify the browser→bridge plumbing in `packages/server/src/browser-handlers/` (the `prompt_response` handler) forwards `images` through verbatim — read `packages/shared/src/browser-protocol.ts` consumer sites to confirm no message-level allowlist needs widening

## 2. Renderer — multiline + paste UX

- [ ] 2.1 Rewrite `packages/client/src/components/interactive-renderers/InputRenderer.tsx`:
  - Replace `<input type="text">` with an autosizing `<textarea>` (lift the autosize pattern from `CommandInput.tsx`)
  - Add `Cmd/Ctrl+Enter`-to-submit keyboard handler; bare `Enter` inserts newline
  - Wire `useImagePaste` in controlled mode (`{images, onImagesChange}`)
  - Render `<ImagePreviewStrip>` above the textarea
  - On submit: call `onRespond({value, images: pendingImages.length > 0 ? pendingImages : undefined})`
  - On Esc / Cancel: clear `pendingImages` then call `onCancel`
  - Preserve the existing post-resolve "answered" summary view; extend it to show "(+N image)" pill when `result.attachments?.length > 0`
- [ ] 2.2 Confirm `InputRenderer` placeholder text is unchanged (no "Paste images supported" hint added)
- [ ] 2.3 Update `packages/client/src/components/__tests__/InputRenderer.test.tsx` to cover: Enter-newline, Cmd+Enter-submit, paste-image, cancel-clears-images, multiline-text round-trip
- [ ] 2.4 Visually verify in dev mode: standalone `ask_user{method:"input"}` dialog now shows textarea, paste a screenshot, confirm thumbnail appears in `ImagePreviewStrip`

## 3. Bridge attachment writer

- [ ] 3.1 Create new module `packages/extension/src/ask-user-attachments.ts` exporting:
  - `attachmentDirForSession(sessionId: string): string` returning `path.join(os.homedir(), ".pi", "dashboard", "attachments", sessionId)`
  - `extensionForMime(mime: string): string | null` covering the existing allowlist (image/jpeg → .jpg, image/png → .png, image/gif → .gif, image/webp → .webp)
  - `persistAttachment(opts: {sessionId, image: ImageContent}): {path, mimeType, bytes} | null` — sha256-truncate-16 hash, derive ext from MIME, mkdir -p, write iff missing, return path metadata; null on failure (with log)
  - `cleanupAttachmentsForSession(sessionId: string): void` — best-effort `fs.rmSync(dir, { recursive: true, force: true })`
  - Constants `MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024` and `MAX_PER_MESSAGE_BYTES = 20 * 1024 * 1024` (alias to the `markdown-image-inliner` constants or re-export to keep them in sync)
- [ ] 3.2 Add `packages/extension/src/__tests__/ask-user-attachments.test.ts` covering: hash determinism, MIME→ext mapping, dedup-by-existing-file, mkdir lazy creation, missing-dir cleanup no-op, EACCES cleanup tolerated, per-image cap rejection, per-message cap cumulative drop

## 4. ask-user-tool bypass for method:"input"

- [ ] 4.1 In `packages/extension/src/ask-user-tool.ts`, add a helper `runInputViaPromptBus(ctx, title, message, placeholder, sessionId, tcid) → {value, images?}` that:
  - Reads `bridgeContext.promptBus` from `ctx` (verify available; if not, fall back to `ctx.ui.input` with a logged warning)
  - Calls `promptBus.request({type: "input", question: title, defaultValue: placeholder ?? "", metadata: {message, tcid}})`
  - Returns the resolved `{answer, images, cancelled}` mapped to `{value: answer ?? "", images}` (cancelled → undefined to keep the existing cancel-as-undefined contract)
- [ ] 4.2 In the standalone-`case "input"` arm (around line 450 in current source), replace the `ctx.ui.input(title, params.placeholder, msgOpts)` call with `runInputViaPromptBus(...)`; add an inline comment pointing to `design.md` Decision 1
- [ ] 4.3 In the batch `for (const sq of params.questions)` loop's `case "input"` arm (around line 372 in current source), replace `ctx.ui.input(subTitle, sq.placeholder, subMsg)` with `runInputViaPromptBus(...)`; mirror the comment
- [ ] 4.4 When the response carries `images`, for each image call `persistAttachment(...)` and collect successful `{path, mimeType, bytes}` entries; assemble the final per-input result as either bare string (no attachments) or `{value, attachments: [...]}` (one or more)
- [ ] 4.5 For each new image hash, emit `connection.send({type: "asset_register", sessionId, hash, mimeType, data})` so the dashboard card renders a thumbnail — reuse the per-session `alreadyEmitted: Set<string>` already maintained in `bridge.ts` (extract it via a small accessor on `bridgeContext` if needed)
- [ ] 4.6 Update the tool's final `JSON.stringify(result)` call so it works correctly with the new union return shape (bare string vs `{value, attachments}` object); the existing `JSON.stringify` handles both cases natively — verify with a unit test
- [ ] 4.7 Confirm the batch numbered summary line `${i}. ${title}: ${JSON.stringify(ans)}` produces sensible output for both the bare-string and the `{value, attachments}` cases

## 5. session_end cleanup wiring

- [ ] 5.1 In `packages/extension/src/bridge.ts`, locate the existing `session_end` event handler
- [ ] 5.2 After existing cleanup, invoke `cleanupAttachmentsForSession(sessionId)` from `ask-user-attachments.ts`
- [ ] 5.3 Confirm via test or manual run that ending a session removes `~/.pi/dashboard/attachments/<sid>/`

## 6. Tests for the ask-user-tool changes

- [ ] 6.1 Extend `packages/extension/src/__tests__/ask-user-tool.test.ts` with cases:
  - `method:"input"` with no images → bare-string result (regression guard)
  - `method:"input"` with one image → writes file, emits asset_register, result is `{value, attachments:[1]}`
  - `method:"input"` with three images of mixed MIMEs → three files, three asset_registers, three attachment entries in order
  - `method:"input"` cancelled → undefined return (same as today), no files written
  - `method:"batch"` with one input sub-question carrying an image → batch summary line shows `{value, attachments}` JSON
  - `method:"batch"` with mixed sub-questions (confirm + input-with-image + select) → only the input entry uses the attachment shape; confirm/select unchanged
  - Per-image cap enforcement: 6 MB image is dropped server-side, response succeeds with empty `attachments`
  - Per-message cap enforcement: three 8 MB images → first two accepted, third dropped
- [ ] 6.2 Mock the `persistAttachment` and `asset_register` emission paths cleanly so the test does not actually write to `~/`

## 7. End-to-end verification

- [ ] 7.1 `npm test` passes
- [ ] 7.2 Manual smoke: spawn a session, have the agent call `ask_user{method:"input", title:"Paste a screenshot"}`, paste an image, submit. Verify:
  - Dashboard `AskUserToolRenderer` card shows the thumbnail
  - The agent's next turn references the image (via Read) or echoes its understanding
  - `~/.pi/dashboard/attachments/<sid>/<hash>.png` exists on disk
- [ ] 7.3 Manual smoke: end the session, confirm the attachment directory is removed
- [ ] 7.4 Manual smoke: trigger `ask_user{method:"batch", questions:[{method:"confirm",...},{method:"input",...},{method:"select",...}]}`, paste image into the input sub-question, verify the batch summary in chat carries the attachment paths
- [ ] 7.5 Manual smoke: trigger `ask_user{method:"input"}` and submit without pasting — verify the tool result is the existing `User responded: "<text>"` shape (regression guard for downstream consumers)

## 8. Build & restart

- [ ] 8.1 `npm run build` (rebuilds the client)
- [ ] 8.2 `curl -X POST http://localhost:8000/api/restart` (restarts server)
- [ ] 8.3 `npm run reload` (reloads all connected pi sessions to pick up the new bridge code)
