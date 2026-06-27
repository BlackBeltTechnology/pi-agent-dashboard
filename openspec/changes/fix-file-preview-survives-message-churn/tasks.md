# Tasks — fix-file-preview-survives-message-churn

## 1. Provider + context

- [ ] 1.1 Add `packages/client/src/components/FilePreviewContext.tsx`:
  `FilePreviewTarget` type, `FilePreviewContext`, `FilePreviewProvider`
  (owns `useState<FilePreviewTarget|null>`), `useFilePreview()` hook (throws
  outside provider). → verify: type-checks, hook guard test passes.
- [ ] 1.2 Add `FilePreviewHost` (in same file or sibling) that reads `target`
  and renders a single `target && <FilePreviewOverlay {...target} onClose={close}/>`.
  → verify: renders nothing when target null; one overlay when set.

## 2. Hoist into ChatView

- [ ] 2.1 Wrap the message list (around `groupedMessages.map`) in
  `<FilePreviewProvider>` and render `<FilePreviewHost/>` once.
  → verify: provider mounts above the list; `ChatView` still renders.

## 3. Make FileLink stateless for preview

- [ ] 3.1 `useFileOpenRouting.ts`: remove `preview`/`setPreview`/`closePreview`
  state and `PreviewTarget`; preview branch of `openFile` calls
  `useFilePreview().open({ cwd, path, line })`. Editor branch untouched.
  → verify: hook returns no UI state; editor POST path unchanged.
- [ ] 3.2 `FileLink.tsx`: remove inline `<FilePreviewOverlay>` JSX and the
  `preview &&` block; `onClick` routes through the (now stateless) hook.
  → verify: no `useState` for preview remains in FileLink.

## 4. Tests (TDD — write first, watch fail, then implement 1–3)

- [ ] 4.1 RTL: open a preview, push a new message → overlay still present
  (`data-testid="file-preview-overlay"`). → verify: red before, green after.
- [ ] 4.2 RTL: open a preview on the streaming message, advance streaming text
  → overlay still present.
- [ ] 4.3 RTL: streaming→committed transition → overlay still present.
- [ ] 4.4 RTL: open file A then file B → exactly one overlay, shows B.
- [ ] 4.5 Regression: Esc / backdrop / close button still dismiss.
- [ ] 4.6 Regression: localhost+editor click calls `/api/open-editor`, renders
  no overlay.

## 5. Verify + gates

- [ ] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` → grep clean.
- [ ] 5.2 `npm run quality:changed` → passes (biome + tsc + tests).
- [ ] 5.3 Manual: in remote/no-editor mode, open a file link, trigger an agent
  reply, confirm overlay stays open through streaming + completion.
- [ ] 5.4 `npx tsx .pi/skills/implement/scripts/review-changes.ts` → triage.
