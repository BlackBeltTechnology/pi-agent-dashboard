## 1. Decide the fix direction

- [ ] 1.1 Confirm Option A (non-blocking inspector) vs Option B (true modal). Default: A — matches `fix-file-preview-survives-message-churn` intent.

## 2. Implement (Option A)

- [ ] 2.1 In `packages/client/src/components/FilePreviewOverlay.tsx`, stop the `fixed inset-0 z-50` backdrop from capturing pointer events over the composer — either scope the backdrop so it does not overlap the composer, or set `pointer-events-none` on the dim layer while keeping the panel interactive, or elevate the composer's stacking context above the overlay.
- [ ] 2.2 Keep Esc / close-button / click-outside dismissal working; keep the panel itself click-isolated.
- [ ] 2.3 If composer elevation is chosen, verify other `z-50` overlays (modals, lightbox) that SHOULD block are unaffected.

## 3. Verify

- [ ] 3.1 `tests/e2e/file-preview-survives-churn.spec.ts` passes (send during open preview no longer times out; overlay survives churn; Esc dismisses).
- [ ] 3.2 Add a client unit/RTL assertion: composer send button is hittable (not pointer-event-obscured) while a preview is open.
- [ ] 3.3 `npm run test:e2e` green on bundled Chromium and `PW_CHANNEL=chrome`.
