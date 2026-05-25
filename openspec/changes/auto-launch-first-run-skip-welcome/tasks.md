# Tasks

## 1. Collapse the startup machine in `main.ts`

- [ ] 1.1 Delete the `wizard-welcome` arm in `packages/electron/src/main.ts` (the `if (isFirstRun()) { ... await showWelcomeStep(); ... }` block — should be at lines 418-431 after `fix-wizard-occluded-by-splash` lands). The next state (`launch-server`) becomes unconditional.
- [ ] 1.2 Delete the `showWelcomeStep()` function (currently lines 343-358).
- [ ] 1.3 Delete the import line `import { registerWizardIpc, writeFirstRunMarker } from "./lib/wizard-ipc.js";` (line 60).
- [ ] 1.4 Delete the call `registerWizardIpc(() => null);` from `main()` (line 383).
- [ ] 1.5 Delete the import `import { getFirstRunMarkerPath } from ...` IF no longer used. (It's used in `isFirstRun()` which itself becomes obsolete — see 1.6.)
- [ ] 1.6 Delete `isFirstRun()` (lines 323-328) — no callers remain.
- [ ] 1.7 The existing first-run-marker write in the success path (around line 469-477) becomes the SOLE writer. Inline the call to `writeFirstRunMarker()` (or its body) directly there to avoid a stale import. Keep the marker path `~/.pi/dashboard/first-run-done`.

## 2. Delete wizard infrastructure

- [ ] 2.1 `rm packages/electron/src/lib/wizard-window.ts`.
- [ ] 2.2 `rm packages/electron/src/lib/wizard-ipc.ts` (move its `writeFirstRunMarker` helper inline to `main.ts` per task 1.7, OR move it to `packages/electron/src/lib/first-run-marker.ts` as a 5-line module if reuse is anticipated — preference: inline, fewer files).
- [ ] 2.3 `rm packages/electron/src/renderer/wizard.html`.
- [ ] 2.4 In `packages/electron/src/preload.ts`, delete the `wizardApi` block: its `WizardApi` interface, the `api` object literal with `completeWizard: () => ipcRenderer.invoke("wizard:complete")`, and the `contextBridge.exposeInMainWorld("wizardApi", api)` call. The remaining preload exports (`piDashboard` for the loading page) stay.
- [ ] 2.5 In `packages/electron/forge.config.ts`, the `extraResource` array includes `./src/renderer`. The directory still exists for `loading.html`; the deletion of `wizard.html` is a content change, not a forge config change.

## 3. Delete the obsolete repo-lint test

- [ ] 3.1 `rm packages/electron/src/__tests__/wizard-launch-ordering.test.ts`. The invariant it pinned (close-splash-before-open-wizard) is vacuously true once there's no wizard.
- [ ] 3.2 Grep for any other test file referencing `wizardApi`, `completeWizard`, `wizard:complete`, `openWizardWindow`, or `wizard-window`. Delete or update each. Expected: no other references, but verify.

## 4. Splash status string sweep

- [ ] 4.1 In `packages/electron/src/main.ts`, the call `updateSplashStatus("Preparing first launch…")` is part of the deleted wizard arm — already removed in task 1.1. Confirm no other call sites use this string.
- [ ] 4.2 The remaining splash status flow becomes:
  ```
  splash.showSplash()  →  "Starting…"  (initial inner-HTML)
  updateSplashStatus("Checking dashboard server…")
  updateSplashStatus("Launching dashboard server…")
  updateSplashStatus("Opening dashboard…")
  closeSplash()
  ```
- [ ] 4.3 No splash re-open required (the `showSplash()` re-open from `fix-wizard-occluded-by-splash` was specifically for the wizard-close → main-window-open transition; without the wizard, the splash never closes mid-flow).

## 5. Documentation

- [ ] 5.1 Delegate to a general-purpose subagent: update `docs/electron-bootstrap-flow.md`:
  - Mermaid diagram: remove the `Welcome[wizard-welcome]` node and its incoming/outgoing edges. State machine becomes 5 states (down from 6).
  - States table: remove the `wizard-welcome` row.
  - "Welcome -->|user clicks Launch| Spawn" edge → "Check -->|server down| Spawn" direct.
- [ ] 5.2 Delegate: update `docs/file-index-electron.md` (or `file-index-skills-misc.md` for the renderer files):
  - Remove rows for `wizard-window.ts`, `wizard-ipc.ts`, `renderer/wizard.html`.
  - Update `main.ts` row to drop the "wizard-welcome" mention from the state-machine summary.
  - Update `preload.ts` row (if present) to drop the `wizardApi` exposure.
- [ ] 5.3 Update `AGENTS.md` "Key Files" backbone: remove the `packages/electron/src/lib/wizard-window.ts` row + the `packages/electron/src/renderer/wizard.html` row.

## 6. OpenSpec spec dir cleanup

- [ ] 6.1 The `first-run-wizard` capability spec at `openspec/specs/first-run-wizard/spec.md` becomes mostly obsolete. This change's delta marks the requirements REMOVED (see `specs/first-run-wizard/spec.md` delta). A follow-on housekeeping change can delete the spec dir entirely once no other proposals reference it.
- [ ] 6.2 Grep `openspec/changes/*/specs/first-run-wizard/spec.md` for in-flight proposals also targeting this capability. Currently: `add-wizard-launch-progress-log` references it. Open a discussion: should that proposal migrate to `electron-shell` (which owns the splash) or absorb the post-deletion world? Document the decision in this change's design.md (if needed).

## 7. Validate

- [ ] 7.1 `npm test` — all green.
- [ ] 7.2 Local build: `npm run electron:make`. Launch the produced app on macOS. Verify:
  - Splash appears, status flows `Starting → Checking → Launching → Opening`.
  - No wizard window appears at any point.
  - Main dashboard window opens.
  - First-run marker `~/.pi/dashboard/first-run-done` exists post-launch.
  - Subsequent launches behave identically (marker already present; no behavioural difference).
- [ ] 7.3 Dispatch `ci-electron.yml` `legs: win32-x64,linux-x64,darwin-arm64`. Download each, smoke each on the matching OS. No wizard, server starts, dashboard opens.
- [ ] 7.4 Verify Doctor's `Managed install (~/.pi-dashboard)` row still reads the marker correctly (it doesn't actually read this marker file but check anyway).
- [ ] 7.5 Verify remote-attach is still reachable via Settings → Network → Known Servers post-launch.
