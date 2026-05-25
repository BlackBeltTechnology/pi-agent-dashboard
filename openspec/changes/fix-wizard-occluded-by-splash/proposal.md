# Fix first-run wizard occluded by always-on-top splash window

## Why

On Windows (and likely macOS in some workspace setups), the first-run wizard window never becomes visible because the splash window — which is `alwaysOnTop: true`, `frame: false`, `transparent: true`, and centred on screen — sits on top of it. The wizard opens at 640×520 in the same screen region, but Electron's default `show: true` does NOT grab focus over an `alwaysOnTop` window on Windows.

Observed symptom (real user report, CI artifact `electron-win32-x64-afca87a` unzipped):
- Splash card visible with text "Preparing first launch…" indefinitely (minutes).
- No window with `[Launch dashboard]` CTA visible.
- Process Explorer shows the Electron process alive (no Chromium browser threads — main process awaiting wizard close).
- Manual server launch via `start-server.cmd` proves the bundled server boots cleanly in ~5 s, so the hang is purely UI orchestration.

Code locations:
- `packages/electron/src/main.ts:91-100` — splash window with `alwaysOnTop: true`, `skipTaskbar: true`.
- `packages/electron/src/main.ts:418-424` — `wizard-welcome` state: `updateSplashStatus("Preparing first launch…")` followed by `await showWelcomeStep()`. The splash is NEVER hidden or lowered before the wizard opens.
- `packages/electron/src/lib/wizard-window.ts:28-55` — `openWizardWindow` does not call `.show()`, `.focus()`, or `.moveTop()` on the new BrowserWindow.

The state machine in `main.ts` blocks at `await openWizardWindow()` because the resolver fires only on `'closed'`. The user can't close (or interact with) a window they can't see → forever-hang.

## What Changes

- **Close the splash before opening the wizard.** In `main.ts:418-424`, call `closeSplash()` immediately before `await showWelcomeStep()`. The wizard then has the only on-screen window and naturally receives focus.
- **Defence in depth: explicitly focus the wizard window.** In `openWizardWindow()` add `wizardWindow.once("ready-to-show", () => { wizardWindow!.show(); wizardWindow!.focus(); })`, with `show: false` in the constructor options so the window doesn't flash an unstyled frame before content loads. Mirrors the typical "no-flash" Electron pattern.
- **Re-show the splash after the wizard closes** if needed for the next status updates. The `await showWelcomeStep()` completes after the user clicks Launch → main.ts then runs `updateSplashStatus("Launching dashboard server…")` (line 427) which assumes splash is alive. Two options:
  - **A**: re-open the splash with `showSplash()` after `showWelcomeStep()` returns, then continue with status updates. Simpler.
  - **B**: convert the splash status updates BETWEEN wizard-close and main-window-open into wizard-window status updates (mutate the wizard renderer instead of splash). More integrated UX but bigger surface change.
  - **Decision**: go with **A** for this fix. Option B is a UX improvement worth tracking separately.
- **Unit test the pure invariant.** Repo-lint test in `packages/electron/src/__tests__/wizard-launch-ordering.test.ts` reads `main.ts` source and asserts the call order: a line matching `closeSplash()` appears BEFORE `showWelcomeStep()` within the `wizard-welcome` arm. Catches accidental re-ordering.
- **No changes** to the server launch path, the spawn argv, or the health-check logic. Those are independently verified correct (`fix-ci-electron-runnable-bundles` spike PASSED on win32-x64).

## Capabilities

### Modified Capabilities

- `first-run-wizard`: adds two Requirements — one for splash/wizard mutual-exclusivity (no overlap), one for explicit wizard-window focus on `ready-to-show`.

## Impact

- **User-visible**: first-run wizard becomes visible immediately on Windows. The `[Launch dashboard]` CTA is reachable. The dashboard launches end-to-end without manual intervention.
- **Code scope**: ~15 LOC in `main.ts` (1 added `closeSplash()` + 1 added `showSplash()` re-open), ~8 LOC in `wizard-window.ts` (show:false + ready-to-show focus handler), ~30 LOC repo-lint test. Total <60 LOC.
- **Risk**: very low. The change strictly improves window ordering; existing happy-path (where the wizard does show up, e.g. on macOS where focus stealing isn't as restricted) gains explicit focus but no behaviour change.
- **Sequencing**: independent of all other follow-ups. Highest priority — without it, fresh Windows installs of any release hang on first launch.
- **Out of scope**:
  - Replacing splash + wizard with a single unified window (the Option B above — UX improvement, tracked separately).
  - Adding launch-progress logs to the splash (covered by `add-wizard-launch-progress-log`).
  - Doctor false-positives (`fix-doctor-windows-launch-test`, `fix-doctor-bundle-aware-probes`).
- **Sequencing with running spike**: this fix should ride into the next `ci-electron` dispatch after merge so a fresh artifact can validate the end-to-end Windows launch in one click. After spike, the existing `fix-ci-electron-runnable-bundles` change can be archived.
