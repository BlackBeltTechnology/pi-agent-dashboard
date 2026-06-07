## Why

The dashboard's main prompt composer (`CommandInput`) has been multiline-with-image-paste for ages: `<textarea>` + `useImagePaste` + `ImagePreviewStrip`, with images riding to the agent as a mixed content block via `pi.sendUserMessage([{type:"text"}, {type:"image"}, …])`.

The `ask_user{method:"input"}` interactive dialog has not kept up. It still renders a single-line `<input type="text">` with no paste affordance. This asymmetry is jarring — when an agent asks "paste the screenshot here," the user has to abandon the dialog, switch to the main prompt, and re-explain themselves.

We close the gap. The standalone `method:"input"` dialog and the per-sub-question `input` step inside `method:"batch"` both gain the same multiline-textarea + image-paste UX the main composer already has, with pasted images persisted to disk so the LLM can `Read` them on demand.

## What Changes

- **Shared input composer** — extract a small `<InputComposer>` (autosizing `<textarea>` + `useImagePaste` in controlled mode + `<ImagePreviewStrip>` above it). `Enter` inserts a newline; `Cmd/Ctrl+Enter` (or the Submit button) sends; `Esc` cancels. Used by two renderers so the paste UX is identical and DRY:
  - **InputRenderer** (`packages/client/src/components/interactive-renderers/InputRenderer.tsx`) — standalone `method:"input"`. Replaces its single-line `<input type="text">` with `<InputComposer>`. `onRespond` carries `{value, images?}`. Keeps the post-resolve read-only "answered"/`(left blank)` summary (#76), extended to show a `(+N image)` pill when attachments present.
  - **BatchRenderer** (`packages/client/src/components/interactive-renderers/BatchRenderer.tsx`) — the `input` sub-question step inside `method:"batch"`. `StepBody`'s `input` arm swaps its `<input type="text">` for `<InputComposer>`; the step's `onChange` now carries `{value, images?}`.
- **Prompt protocol** — two transports, because standalone-input and batch use different bus message types:
  - Standalone `method:"input"` rides `PromptResponse` (extension side, `packages/extension/src/prompt-bus.ts`), which gains optional `images?: ImageContent[]`. The mirror browser message `PromptResponseBrowserMessage` (`packages/shared/src/browser-protocol.ts`) gains the same optional field.
  - Batch rides `ctx.ui.batch`, whose `{answers}` payload is JSON-encoded into the bus `answer` string. The `BatchAnswer` input variant (`packages/shared/src/protocol.ts`) gains `images?: ImageContent[]`, so pasted images ride inside the answers array — no per-sub-question `PromptResponse.images` channel and no per-question promptBus bypass.
- **ask-user tool** (`packages/extension/src/ask-user-tool.ts`) — two attachment-processing sites; only the standalone one bypasses `ctx.ui.*`:
  1. **Standalone `method:"input"`** — bypasses `ctx.ui.input`, calls `bridgeContext.promptBus.request({type:"input", …})` directly so the resolved `PromptResponse.images` survives.
  2. **Batch branch** — keeps the single `ctx.ui.batch(…)` dispatch (no per-question loop). After it resolves to `BatchAnswer[]`, the branch processes each `input` answer's `images`.
  In both sites, when an answer carries images the tool writes each to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` (hash = sha256 truncated to 16 hex chars; ext from MIME via the existing allowlist) and emits one `asset_register` message per new hash so the dashboard card shows a thumbnail.
- **Tool result shape (standalone)** — instead of `User responded: "<text>"`, inputs with attachments return `User responded: ${JSON.stringify({value, attachments: [{path, mimeType, bytes}]})}`. The LLM sees the absolute paths and may invoke its `Read` tool. Without attachments, the existing `User responded: "<text>"` shape is preserved (no migration cost).
- **Batch result shape** — unchanged framing: the numbered summary line `${i+1}. ${title}: ${JSON.stringify(ans)}` and the index-aligned `details.results` array (#76). For an `input` answer that carried images, that answer maps to `{value, attachments?}` instead of a bare string; all other sub-question shapes (`confirm`→boolean, `select`→string, `multiselect`→string[]) are untouched.
- **Cleanup** — best-effort `rmdir -r ~/.pi/dashboard/attachments/<sessionId>` on `session_end`. Orphans tolerable. No prune CLI in v1.
- **Caps** — match the existing `markdown-image-inliner` budget: 5 MB per image, 20 MB cumulative per `ask_user` response. Oversize images are dropped with the same transient-banner UX `useImagePaste` already provides.
- **No schema-description change** — the `method:"input"` description does NOT advertise image paste. The LLM discovers attachments naturally when they appear in a tool result. Likewise the textarea shows no "Paste images supported" hint; the affordance is silent, matching the main composer.
- **TUI fallback** — when no dashboard adapter claims the prompt, the existing `ctx.ui.input` terminal path remains the fallback, text-only.

## Capabilities

### New Capabilities

None. This is a modification of existing behavior, not a new conceptual surface.

### Modified Capabilities

- `ask-user-tool`: `method:"input"` (standalone) and the `input` step of the `method:"batch"` wizard gain an optional image-attachment side channel. Standalone rides `PromptResponse.images`; batch rides `BatchAnswer.images` inside the `ctx.ui.batch` answers payload. Pasted images persist to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`; absolute paths appear in the tool result so the LLM's `Read` tool can view them. Existing text-only behavior is preserved when no images are pasted.

## Impact

**Affected code:**

- `packages/client/src/components/interactive-renderers/InputComposer.tsx` (new) — shared textarea + `useImagePaste` + `ImagePreviewStrip` composer; consumed by InputRenderer and BatchRenderer.
- `packages/client/src/components/interactive-renderers/InputRenderer.tsx` — swap single-line input for `<InputComposer>`; preserve the #76 read-only resolved view, extend with `(+N image)` pill.
- `packages/client/src/components/interactive-renderers/BatchRenderer.tsx` — `StepBody` `input` arm swaps `<input>` for `<InputComposer>`; per-step `onChange` carries `{value, images?}`.
- `packages/extension/src/prompt-bus.ts` — `PromptResponse.images?` field (standalone-input transport).
- `packages/shared/src/browser-protocol.ts` — `PromptResponseBrowserMessage.images?` field.
- `packages/shared/src/protocol.ts` — `BatchAnswer` input variant gains `images?: ImageContent[]` (batch transport).
- `packages/extension/src/ask-user-tool.ts` — one bypass site (standalone input) + batch-branch answer processing; attachment-writer helper + `asset_register` emission for both.
- New helper module: `packages/extension/src/ask-user-attachments.ts` — write-bytes-to-disk, hash-and-extension resolution, per-session directory management, session-end cleanup.
- `packages/extension/src/bridge.ts` — hook attachment-store cleanup into the `session_end` handler.

**Affected APIs:**

- `PromptResponse` / `PromptResponseBrowserMessage` add an optional field. Backward compatible; existing adapters/renderers ignoring the field continue to work.
- `ask_user` tool result text JSON shape evolves for `method:"input"` calls that received images. The schema itself is unchanged.

**Affected dependencies:** none new — `useImagePaste`, `ImagePreviewStrip`, `ImageContent`, the sha256 hash + MIME allowlist primitives already exist.

**Affected filesystem:** new directory `~/.pi/dashboard/attachments/<sessionId>/`. Best-effort cleanup on session end. Worst case: orphans accumulate at the rate users paste images into `ask_user`. Negligible at expected volumes.

**Affected providers:** none. Tool result remains a single `{type:"text"}` block. The LLM sees the paths as plain JSON-in-text; only its subsequent `Read` calls fetch image bytes, using the same vision path it would use for any local image file. No tool_result content-block multiplexing required.

**Risks:**

- Disk leaks if `session_end` cleanup misses (e.g. crashed dashboard). Documented; acceptable for v1; revisit with a prune CLI later if telemetry warrants.
- The standalone `method:"input"` bypass site in `ask-user-tool.ts` forks from the otherwise-uniform `ctx.ui.*` dispatch — a comment must explain why. The batch branch keeps its `ctx.ui.batch` dispatch and only post-processes `images`, so no second fork.
- Pasted-image bytes flow through `asset_register` for the dashboard card AND to disk for the LLM — duplicated I/O. Tolerable; each path is a single write per image.
