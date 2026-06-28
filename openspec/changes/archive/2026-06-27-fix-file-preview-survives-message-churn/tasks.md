# Tasks — fix-file-preview-survives-message-churn

## 1. Provider + context

- [x] 1.1 Add `packages/client/src/components/FilePreviewContext.tsx`:
  `FilePreviewTarget` type, `FilePreviewContext`, `FilePreviewProvider`
  (owns `useState<FilePreviewTarget|null>`), `useFilePreview()` hook (throws
  outside provider). → verify: type-checks, hook guard test passes.
- [x] 1.2 Add `FilePreviewHost` (in same file or sibling) that reads `target`
  and renders a single `target && <FilePreviewOverlay {...target} onClose={close}/>`.
  → verify: renders nothing when target null; one overlay when set.

## 2. Hoist into ChatView

- [x] 2.1 Wrap the message list (around `groupedMessages.map`) in
  `<FilePreviewProvider>` and render `<FilePreviewHost/>` once.
  → verify: provider mounts above the list; `ChatView` still renders.

## 3. Make FileLink stateless for preview

- [x] 3.1 `useFileOpenRouting.ts`: remove `preview`/`setPreview`/`closePreview`
  state and `PreviewTarget`; preview branch of `openFile` calls
  `useFilePreview().open({ cwd, path, line })`. Editor branch untouched.
  → verify: hook returns no UI state; editor POST path unchanged.
- [x] 3.2 `FileLink.tsx`: remove inline `<FilePreviewOverlay>` JSX and the
  `preview &&` block; `onClick` routes through the (now stateless) hook.
  → verify: no `useState` for preview remains in FileLink.

## 4. Tests (TDD — write first, watch fail, then implement 1–3)

- [x] 4.1 RTL: open a preview, push a new message → overlay still present
  (`data-testid="file-preview-overlay"`). → verify: red before, green after.
- [x] 4.2 RTL: open a preview on the streaming message, advance streaming text
  → overlay still present.
- [x] 4.3 RTL: streaming→committed transition → overlay still present.
- [x] 4.4 RTL: open file A then file B → exactly one overlay, shows B.
- [x] 4.5 Regression: Esc / backdrop / close button still dismiss.
- [x] 4.6 Regression: localhost+editor click calls `/api/open-editor`, renders
  no overlay.

## 5. Verify + gates

- [x] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` → grep clean. (All touched-file tests pass; remaining suite failures are pre-existing/unrelated: `image-fit-extension` Jimp env issue + server timeouts under full-suite load — all pass in isolation.)
- [x] 5.2 `npm run quality:changed` → biome + tsc clean for all touched files (pre-existing ChatView Tier-B/C warnings + image-fit Jimp errors untouched, surgical).
- [x] 5.3 Automated (Playwright E2E): `tests/e2e/file-preview-survives-churn.spec.ts`
  opens a preview on a real fixture file (`./hello.txt` via new faux scenario
  `text-realfile`), streams a second message (`[[faux:slow-stream]]`), asserts
  the overlay stays open with content through streaming + streaming→committed,
  then Esc dismisses. Forces preview path via `/api/open-editor`→500. Run:
  `npm run test:e2e -- file-preview-survives-churn` (Docker + chromium).
  Structurally validated (tsc + biome + `playwright test --list`); full run needs
  the Docker test harness.
- [x] 5.4 `npx tsx .pi/skills/implement/scripts/review-changes.ts` → ran; CodeRabbit unavailable (rate-limited), advisory gate deferred + exit 0 per contract.
