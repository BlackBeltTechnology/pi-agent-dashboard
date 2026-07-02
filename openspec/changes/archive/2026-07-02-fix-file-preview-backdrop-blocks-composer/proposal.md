## Why

The E2E spec `tests/e2e/file-preview-survives-churn.spec.ts` fails deterministically: when the file-preview overlay is open, its full-viewport backdrop intercepts pointer events on the composer **send button**, so the test's step-2 `sendPrompt(...)` click times out (60 s).

This is a real product-layering bug, not a test artifact: a user who opens a file preview from a tool-output/message link **cannot send a new prompt** (or click any composer control) until they dismiss the preview — even though the composer textarea remains visually present and the preview is explicitly designed to coexist with message churn (see change `fix-file-preview-survives-message-churn`).

### Evidence

- `packages/client/src/components/FilePreviewOverlay.tsx:139` renders the backdrop as `className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"` (`data-testid="file-preview-backdrop"`). `inset-0` covers the entire viewport, including the bottom composer.
- The composer (`CommandInput`, mounted in `App.tsx`) has **no** z-index elevation, so it stacks **below** the `z-50` backdrop. The backdrop is the topmost element at the send-button's coordinates.
- Playwright actionability log: `<div data-testid="file-preview-backdrop" class="fixed inset-0 z-50 ...">…</div> intercepts pointer events` — for the full 60 s retry window.
- Failure screenshot shows the preview open, the composer textarea filled with `[[faux:slow-stream]] go`, and the send click blocked.
- Reproducible on any Chromium (bundled + system `PW_CHANNEL=chrome` share the Blink engine). Backdrop markup is **byte-identical on `develop`** — pre-existing, independent of the `adopt-pi-071-072-073-features` change that surfaced it.

### Scope

Surfaced while enabling the system-browser E2E path (`PW_CHANNEL`). 19/20 specs pass on system Chrome; this is the only failure. Out of scope for `adopt-pi-071-072-073-features` — tracked here as its own fix.

## What Changes

Decide between two fix directions (design task), then implement:

- **Option A — backdrop must not block the composer (preferred).** The preview overlay is a non-modal inspector, not a blocking dialog. Either (a) drop the dimming backdrop's pointer-event capture over the composer region, or (b) elevate the composer's stacking context above the preview backdrop so composer controls stay interactive while a preview is open. Keeps the documented "preview survives churn / user keeps working" UX intact.
- **Option B — treat the preview as a true modal.** If blocking is intended, `sendPrompt` in `tests/e2e/helpers/index.ts` and the spec must dismiss the preview before sending; document the modal semantics. (Contradicts the `fix-file-preview-survives-message-churn` intent, so A is preferred.)

The fix MUST keep the existing invariants green: preview stays open + content intact across new-message / streaming / streaming→committed churn, and Esc still dismisses.

## Impact

- Files (Option A): `packages/client/src/components/FilePreviewOverlay.tsx` (backdrop pointer-events / stacking), possibly `packages/client/src/App.tsx` or `ChatView.tsx` (composer z-index).
- Tests: `tests/e2e/file-preview-survives-churn.spec.ts` returns to green; add a unit/RTL assertion that the composer send button remains hittable while a preview is open.
- Risk: low; isolated to overlay stacking. Verify no regression in other `z-50` overlays (modals, lightbox) that SHOULD block.

## Out of Scope

- Broader overlay/z-index audit across all modals.
- The `PW_CHANNEL` system-browser E2E opt-in (already landed under `adopt-pi-071-072-073-features`).
