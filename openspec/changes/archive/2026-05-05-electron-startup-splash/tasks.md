## 1. Implementation

- [x] 1.1 ~~Create `packages/electron/src/splash.html`~~ — NOT NEEDED; splash already exists inline as a data: URL in `main.ts showSplash()`. Updated the inline HTML to add a CSS spinner + persistent status `<div id="status">` replacing the static 3-blinking-dots.
- [x] 1.2 ~~Create `packages/electron/src/splash-window.ts`~~ — NOT NEEDED; `showSplash`/`closeSplash` already in main.ts. Added `updateSplashStatus(text)` next to them, uses `webContents.executeJavaScript()` to update the status `<div>` (simpler than IPC, no preload script, no forge.config.ts changes).
- [x] 1.3 Modified `packages/electron/src/main.ts` — wired `updateSplashStatus()` at 6 phases: checking server, detecting pi, checking bridge, opening wizard, launching server (with retry), opening dashboard.
- [x] 1.4 ~~Verify forge.config.ts packages splash.html~~ — NOT APPLICABLE; splash is an inline data: URL, nothing to package.

## 2. Validation

- [x] 2.1 `npm run lint` (tsc --noEmit) green
- [x] 2.2 `npm test` green — 2526/2526
- [x] 2.3 Manual: `cd packages/electron && npm start` — splash appears immediately, status progresses, closes when main window ready _(operator gate)_
- [x] 2.4 Manual Windows smoke: launch packaged .exe cold, confirm splash visible within 1s with progressing status text _(operator gate)_

## 3. Spec sync

- [x] 3.1 Update `openspec/specs/electron-shell/spec.md` with splash lifecycle requirements (after validation passes)
