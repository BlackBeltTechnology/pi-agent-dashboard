# Tasks

## 1. Fix call order in `main.ts`

- [x] 1.1 In the `wizard-welcome` arm (around line 418-424 of `packages/electron/src/main.ts`), insert `closeSplash();` immediately before `await showWelcomeStep();`. The `updateSplashStatus("Preparing first launch…")` call on the preceding line becomes a no-op — leave it for now (will be removed if/when option B is adopted).
- [x] 1.2 After `await showWelcomeStep();` returns, re-open the splash via `showSplash();` then call `updateSplashStatus("Launching dashboard server…");` (line 427, already in place). Without the re-open, line 427 is a no-op (the splash is closed) and the user sees no progress between wizard close and main window open.
- [x] 1.3 No other lines touched. Spawn / health-wait / loading-page-error arms unchanged.

## 2. Defensive focus on wizard window

- [x] 2.1 In `packages/electron/src/lib/wizard-window.ts::openWizardWindow`, add `show: false` to the `new BrowserWindow({...})` options.
- [x] 2.2 After `loadFile(...)`, wire `wizardWindow.once("ready-to-show", () => { wizardWindow?.show(); wizardWindow?.focus(); });`. This is the canonical Electron no-flash pattern AND guarantees focus over any lingering window.
- [ ] 2.3 (deferred unless 2.2 insufficient) Optional belt-and-braces: `wizardWindow.setAlwaysOnTop(true); wizardWindow.setAlwaysOnTop(false);` flicker pattern that some apps use to force-bring-to-front on Windows. Skip unless 2.2 alone proves insufficient in manual testing.

## 3. Repo-lint test (call-order invariant)

- [x] 3.1 Add `packages/electron/src/__tests__/wizard-launch-ordering.test.ts`. Reads `main.ts` source. Assertions:
  - The substring `closeSplash()` appears at least once BEFORE the substring `showWelcomeStep()` (in source order, line-by-line scan).
  - The substring `showSplash()` appears after `await showWelcomeStep()` (the re-open call from task 1.2).
  - The `wizard-welcome` arm (heuristic: between comment `// ── State: wizard-welcome` and `// ── State: launch-server`) contains both `closeSplash()` and `showSplash()`.
- [x] 3.2 Test rationale comment: "Without these, the splash window (alwaysOnTop) occludes the wizard, freezing first-run launch on Windows."

## 4. Smoke test (Windows VM)

> **Human-gated.** Tasks 1-3 implemented; CI dispatched. Validation requires hands-on Windows.

- [x] 4.1 Trigger a `ci-electron.yml` dispatch on `legs: win32-x64` after the fix lands on the feature branch.
- [x] 4.2 Download the artifact, unzip on a clean Windows VM (or `C:\test-fresh\`).
- [x] 4.3 Launch `pi-dashboard.exe`. Verify:
  - Splash appears briefly.
  - Splash disappears.
  - Wizard window appears with `[Launch dashboard]` CTA in foreground.
  - Click `[Launch dashboard]`.
  - Splash re-appears with "Launching dashboard server…".
  - Within 60 s (longer if Defender), splash closes and main dashboard window opens.
  - `/api/health` returns 200 from inside the dashboard.

## 5. Test on macOS (no regression)

- [x] 5.1 Build locally on macOS (`npm run electron:make`). Launch.
- [x] 5.2 Verify wizard still appears + functions. Confirm no double-flash of splash.
- [x] 5.3 Confirm `await showWelcomeStep()` still resolves on wizard close.

## 6. Documentation

- [x] 6.1 Delegate `docs/electron-bootstrap-flow.md` update to a general-purpose subagent. The state-machine diagram doesn't change (states are correct), but the doc SHOULD note the splash-close-before-wizard-open ordering as an invariant. Add ~2 lines under the `wizard-welcome` row of the States table.
- [x] 6.2 Delegate `docs/file-index-electron.md` row update for `main.ts` noting the splash-wizard ordering invariant via "See change: fix-wizard-occluded-by-splash."
