## Why

The dashboard's main prompt composer (`CommandInput`) has been multiline-with-image-paste for ages: `<textarea>` + `useImagePaste` + `ImagePreviewStrip`, with images riding to the agent as a mixed content block via `pi.sendUserMessage([{type:"text"}, {type:"image"}, …])`.

The `ask_user{method:"input"}` interactive dialog has not kept up. It still renders a single-line `<input type="text">` with no paste affordance. This asymmetry is jarring — when an agent asks "paste the screenshot here," the user has to abandon the dialog, switch to the main prompt, and re-explain themselves.

We close the gap. The standalone `method:"input"` dialog and the per-sub-question `input` step inside `method:"batch"` both gain the same multiline-textarea + image-paste UX the main composer already has, with pasted images persisted to disk so the LLM can `Read` them on demand.

## What Changes

- **InputRenderer** (`packages/client/src/components/interactive-renderers/InputRenderer.tsx`) — `<input>` becomes an autosizing `<textarea>`. `Enter` inserts a newline; `Cmd/Ctrl+Enter` (or the Submit button) sends. `Esc` cancels. Wires `useImagePaste` in controlled mode and renders `<ImagePreviewStrip>` above the textarea. `onRespond` carries `{value, images?}`.
- **Prompt protocol** — `PromptResponse` (extension side, `packages/extension/src/prompt-bus.ts`) gains optional `images?: ImageContent[]`. The mirror browser-protocol message `PromptResponseBrowserMessage` gains the same optional field.
- **ask-user tool** (`packages/extension/src/ask-user-tool.ts`) — two sites bypass `ctx.ui.input` and call `bridgeContext.promptBus.request(...)` directly so the richer response shape survives:
  1. Standalone `method:"input"` branch.
  2. The `for…of params.questions` loop's `case "input"` arm (batch sub-questions).
  When the resolved response carries images, the tool writes each image to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` (hash = sha256 truncated to 16 hex chars; ext from MIME via the existing allowlist) and emits one `asset_register` message per new hash so the dashboard's `AskUserToolRenderer` card can show a thumbnail.
- **Tool result shape** — instead of returning `User responded: "<text>"` for inputs with attachments, the tool returns `User responded: ${JSON.stringify({value, attachments: [{path, mimeType, bytes}]})}`. The LLM sees the absolute paths and may invoke its `Read` tool to view the images. For inputs without attachments, the existing `User responded: "<text>"` shape is preserved (no migration cost).
- **Batch result shape** — the per-sub-question entry in the numbered summary (`${i}. ${title}: ${JSON}`) carries the same `{value, attachments?}` shape naturally; no separate code path.
- **Cleanup** — best-effort `rmdir -r ~/.pi/dashboard/attachments/<sessionId>` on `session_end`. Orphans tolerable. No prune CLI in v1.
- **Caps** — match the existing `markdown-image-inliner` budget: 5 MB per image, 20 MB cumulative per `ask_user` response. Oversize images are dropped with the same transient-banner UX `useImagePaste` already provides.
- **No schema-description change** — the `method:"input"` description does NOT advertise image paste. The LLM discovers attachments naturally when they appear in a tool result. Likewise the textarea shows no "Paste images supported" hint; the affordance is silent, matching the main composer.
- **TUI fallback** — when no dashboard adapter claims the prompt, the existing `ctx.ui.input` terminal path remains the fallback, text-only.

## Capabilities

### New Capabilities

None. This is a modification of existing behavior, not a new conceptual surface.

### Modified Capabilities

- `ask-user-tool`: `method:"input"` (standalone and inside `method:"batch"` sub-questions) gains an optional image-attachment side channel. Pasted images persist to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`; absolute paths appear in the tool result so the LLM's `Read` tool can view them. Existing text-only behavior is preserved when no images are pasted.

## Impact

**Affected code:**

- `packages/client/src/components/interactive-renderers/InputRenderer.tsx` — full rewrite of the form body (single-line input → textarea + paste strip).
- `packages/extension/src/prompt-bus.ts` — `PromptResponse.images?` field.
- `packages/shared/src/browser-protocol.ts` — `PromptResponseBrowserMessage.images?` field.
- `packages/extension/src/ask-user-tool.ts` — two bypass sites (standalone input + batch sub-question input), plus attachment-writer helper and `asset_register` emission.
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
- Two bypass sites in `ask-user-tool.ts` create a fork from the otherwise-uniform `ctx.ui.*` dispatch — comments must explain why `method:"input"` is special.
- Pasted-image bytes flow through `asset_register` for the dashboard card AND to disk for the LLM — duplicated I/O. Tolerable; each path is a single write per image.
