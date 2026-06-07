## 1. Protocol field additions

- [x] 1.1 Add optional `images?: ImageContent[]` to `PromptResponse` interface in `packages/extension/src/prompt-bus.ts` (standalone-input transport)
- [x] 1.2 Add optional `images?: ImageContent[]` to `PromptResponseBrowserMessage` in `packages/shared/src/browser-protocol.ts`
- [x] 1.1b Add optional `images?: ImageContent[]` to the `{ value: string }` variant of `BatchAnswer` in `packages/shared/src/protocol.ts` (batch transport — pasted images ride inside the `ctx.ui.batch` answers payload, JSON-encoded into the bus `answer` string)
- [x] 1.3 Update any existing tests under `packages/extension/src/__tests__/prompt-bus*.test.ts` to confirm the new field is optional and ignored by existing adapters
- [x] 1.4 Verify the browser→bridge plumbing in `packages/server/src/browser-handlers/` (the `prompt_response` handler) forwards `images` through verbatim — read `packages/shared/src/browser-protocol.ts` consumer sites to confirm no message-level allowlist needs widening

## 2. Renderer — multiline + paste UX

- [x] 2.0 Create shared `packages/client/src/components/interactive-renderers/InputComposer.tsx`:
  - Controlled props `{ value, images, onChange({value, images}), onSubmit, onCancel, placeholder }`
  - Autosizing `<textarea>` (lift the autosize pattern from `CommandInput.tsx`); `Cmd/Ctrl+Enter` (or Submit button) → `onSubmit`; bare `Enter` inserts newline; `Esc` → `onCancel`
  - Wire `useImagePaste` in controlled mode (`{images, onImagesChange}`); render `<ImagePreviewStrip>` above the textarea
  - No "Paste images supported" hint (silent affordance, matching the main composer)
- [x] 2.1 Rewrite the pending-state body of `packages/client/src/components/interactive-renderers/InputRenderer.tsx` to consume `<InputComposer>`:
  - On submit: `onRespond({value, images: images.length > 0 ? images : undefined})`; on cancel: clear images then `onCancel`
  - **Preserve** the #76 post-resolve read-only "answered"/`(left blank)` summary view; extend it to show a `(+N image)` pill when `result.attachments?.length > 0`
- [x] 2.1b Wire `<InputComposer>` into `BatchRenderer.tsx` `StepBody`'s `input` arm (replace the `<input type="text">`); the step's `onChange` now carries `{value, images}` into the `answers[]` state. Extend `answerToText`/`ReviewRow` to show a `(+N image)` affordance for `input` answers that carried images.
- [x] 2.2 Confirm placeholder text is unchanged in both renderers (no "Paste images supported" hint added)
- [x] 2.3 Update `packages/client/src/components/__tests__/InputRenderer.test.tsx` and `BatchRenderer.test.tsx` to cover: Enter-newline, Cmd+Enter-submit, paste-image, cancel-clears-images, multiline-text round-trip; for batch, an `input` step that pastes an image and survives Next → Review → Submit into `answers[]`
- [ ] 2.4 Visually verify in dev mode: (a) standalone `ask_user{method:"input"}` shows textarea + paste; (b) a `method:"batch"` wizard's `input` step shows textarea + paste, thumbnail persists across step navigation

## 3. Bridge attachment writer

- [x] 3.1 Create new module `packages/extension/src/ask-user-attachments.ts` exporting:
  - `attachmentDirForSession(sessionId: string): string` returning `path.join(os.homedir(), ".pi", "dashboard", "attachments", sessionId)`
  - `extensionForMime(mime: string): string | null` covering the existing allowlist (image/jpeg → .jpg, image/png → .png, image/gif → .gif, image/webp → .webp)
  - `persistAttachment(opts: {sessionId, image: ImageContent}): {path, mimeType, bytes} | null` — sha256-truncate-16 hash, derive ext from MIME, mkdir -p, write iff missing, return path metadata; null on failure (with log)
  - `cleanupAttachmentsForSession(sessionId: string): void` — best-effort `fs.rmSync(dir, { recursive: true, force: true })`
  - Constants `MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024` and `MAX_PER_MESSAGE_BYTES = 20 * 1024 * 1024` (alias to the `markdown-image-inliner` constants or re-export to keep them in sync)
- [x] 3.2 Add `packages/extension/src/__tests__/ask-user-attachments.test.ts` covering: hash determinism, MIME→ext mapping, dedup-by-existing-file, mkdir lazy creation, missing-dir cleanup no-op, EACCES cleanup tolerated, per-image cap rejection, per-message cap cumulative drop

## 4. Bridge-side image wiring (ctx.ui.inputWithImages + ctx.ui.batch)

- [x] 4.0 In `packages/extension/src/bridge.ts`, add a private helper `persistAnswerImages(images: ImageContent[]) → {path, mimeType, bytes}[]` (closes over the in-scope `sessionId`, `connection`, and the per-session `alreadyEmitted: Set<string>`). For each image: enforce caps, call `persistAttachment({sessionId, image})` from `ask-user-attachments.ts`, emit `connection.send({type:"asset_register", sessionId, hash, mimeType, data})` for new hashes, and return successful attachment metadata. Single attachment-processing path used by both sites below.
- [x] 4.1 In `bridge.ts`, next to the existing `(ctx.ui as any).input` patch (~line 1692), add `(ctx.ui as any).inputWithImages = (title, placeholder, opts) => bus.request({pipeline:"command", type:"input", question:title, defaultValue:placeholder, metadata: buildMeta(opts)}).then(r => { if (r.cancelled) return undefined; const atts = r.images?.length ? persistAnswerImages(r.images) : []; return atts.length ? {value: r.answer ?? "", attachments: atts} : (r.answer ?? ""); })`. Comment: references `design.md` Decision 1.
- [x] 4.2 In `bridge.ts`, extend the existing `(ctx.ui as any).batch` `.then(...)` (~line 1736): after `JSON.parse`-ing the answers array, for each answer carrying `images`, call `persistAnswerImages(...)` and replace that answer with `{value: answer.value ?? "", attachments}` (drop the raw `images` field). Return the rewritten answers array.
- [x] 4.3 In `packages/extension/src/ask-user-tool.ts` standalone `case "input"` arm (~line 437), dispatch through `inputWithImages` when present: `result = (ctx.ui as any).inputWithImages ? await (ctx.ui as any).inputWithImages(title, params.placeholder, msgOpts) : await ctx.ui.input(title, params.placeholder, msgOpts)`. The existing `User responded: ${JSON.stringify(result)}` line handles bare-string and `{value, attachments}` natively — no further change.
- [x] 4.4 In `ask-user-tool.ts` batch branch (~line 336), the answers returned by `ctx.ui.batch` already carry `{value, attachments?}` for image-bearing input steps (rewritten in 4.2). Widen the answer→result mapping's `if ("value" in a)` arm to return the whole `{value, attachments}` object when `attachments` present (else the bare `a.value`).
- [x] 4.5 Verify `inputWithImages`/`batch` are only patched in dashboard sessions; the tool's `inputWithImages`-present guard and the pre-existing `ctx.ui.batch` call preserve TUI behavior (text-only / unchanged).
- [x] 4.6 Confirm the batch numbered summary line `${i+1}. ${sq.title}: ${JSON.stringify(ans)}` and the `details.results` index-aligned array (#76) produce sensible output for both the bare-string and the `{value, attachments}` cases.

## 5. session_end cleanup wiring

- [x] 5.1 In `packages/extension/src/bridge.ts`, locate the existing `session_end` event handler
- [x] 5.2 After existing cleanup, invoke `cleanupAttachmentsForSession(sessionId)` from `ask-user-attachments.ts`
- [x] 5.3 Confirm via test or manual run that ending a session removes `~/.pi/dashboard/attachments/<sid>/`

## 6. Tests for the ask-user-tool changes

- [x] 6.1 Extend `packages/extension/src/__tests__/ask-user-tool.test.ts` with cases:
  - `method:"input"` with no images → bare-string result (regression guard)
  - `method:"input"` with one image → writes file, emits asset_register, result is `{value, attachments:[1]}`
  - `method:"input"` with three images of mixed MIMEs → three files, three asset_registers, three attachment entries in order
  - `method:"input"` cancelled → undefined return (same as today), no files written
  - `method:"batch"` with one input sub-question carrying an image (via `BatchAnswer.images`) → `results[i]` and the summary line show `{value, attachments}`; `details.results` stays index-aligned
  - `method:"batch"` with mixed sub-questions (confirm + input-with-image + select) → only the input entry uses the attachment shape; confirm→boolean / select→string unchanged
  - `method:"batch"` cancelled (answers === undefined) → no files written, existing cancel summary preserved
  - Per-image cap enforcement: 6 MB image is dropped server-side, response succeeds with empty `attachments`
  - Per-message cap enforcement: three 8 MB images → first two accepted, third dropped
- [x] 6.2 Mock the `persistAttachment` and `asset_register` emission paths cleanly so the test does not actually write to `~/`

## 7. End-to-end verification

- [x] 7.1 `npm test` passes
- [ ] 7.2 Manual smoke: spawn a session, have the agent call `ask_user{method:"input", title:"Paste a screenshot"}`, paste an image, submit. Verify:
  - Dashboard `AskUserToolRenderer` card shows the thumbnail
  - The agent's next turn references the image (via Read) or echoes its understanding
  - `~/.pi/dashboard/attachments/<sid>/<hash>.png` exists on disk
- [ ] 7.3 Manual smoke: end the session, confirm the attachment directory is removed
- [ ] 7.4 Manual smoke: trigger `ask_user{method:"batch", questions:[{method:"confirm",...},{method:"input",...},{method:"select",...}]}`, paste image into the input sub-question, verify the batch summary in chat carries the attachment paths
- [ ] 7.5 Manual smoke: trigger `ask_user{method:"input"}` and submit without pasting — verify the tool result is the existing `User responded: "<text>"` shape (regression guard for downstream consumers)

## 8. Build & restart

- [x] 8.1 `npm run build` (rebuilds the client)
- [x] 8.2 `curl -X POST http://localhost:8000/api/restart` (restarts server)
- [x] 8.3 `npm run reload` (reloads all connected pi sessions to pick up the new bridge code)
