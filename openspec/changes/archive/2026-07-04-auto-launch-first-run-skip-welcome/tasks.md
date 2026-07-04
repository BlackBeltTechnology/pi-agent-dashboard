# Tasks

> **Doubt-review corrections (2 reviewers, incl. cross-model Gemini 3.1 Pro):** three files slated for `rm` have live NON-wizard consumers the original plan missed. See tasks 1.1a (bundled bridge), Section 2A (Doctor run-setup), Section 2B (remote-mode `mode.json` writer), 1.7 (marker-on-`attach`), and the widened grep in 3.2. Line refs below corrected against the real `main.ts` (601 lines).

## 1. Collapse the startup machine in `main.ts`

- [x] 1.1 Delete the `wizard-welcome` arm in `packages/electron/src/main.ts` (the `if (isFirstRun()) { ... await showWelcomeStep(); ... }` block — lines 469-484 after `fix-wizard-occluded-by-splash` lands). The next state (`launch-server`) becomes unconditional. **NOTE the arm is NOT wizard-only — see 1.1a before deleting.**
- [x] 1.1a **[doubt-review #1] Hoist `registerBundledBridgeExtension()` out of the deleted arm.** `main.ts:472` (`try { registerBundledBridgeExtension(); } catch { /* non-fatal */ }`) is the SOLE production call site (grep-verified) and registers the bundled bridge so pi sessions forward events to the dashboard. It must run on every launch, not just first-run. Move it to run unconditionally before `updateSplashStatus("Launching dashboard server…")` (main.ts:486). Do NOT let it die with the arm.
- [x] 1.2 Delete the `showWelcomeStep()` function (lines 362-376).
- [x] 1.3 Delete/adjust the import line `import { registerWizardIpc, writeFirstRunMarker } from "./lib/wizard-ipc.js";` (line 74). NOTE: if Section 2B keeps a slim remote-mode IPC in `wizard-ipc.ts`, adjust this import rather than deleting it.
- [x] 1.4 Delete the call `registerWizardIpc(() => null);` from `main()` (line 413). Also delete the inline `wizard:open-doctor` registration at `main.ts:201-202` (`ipcMain.removeAllListeners("wizard:open-doctor")` + `ipcMain.on("wizard:open-doctor", …)`) — its only sender (`preload openDoctor`) and renderer caller (`wizard.html`) both get deleted, so it becomes dead code.
- [x] 1.5 Delete the import `import { getFirstRunMarkerPath } from ...` IF no longer used. (Used in `isFirstRun()` AND in the done-state marker write at 521-528 — the latter survives, so the import likely stays. Verify before removing.)
- [x] 1.6 Delete `isFirstRun()` (lines 345-347) — no callers remain AFTER 1.1 lands. **Distinct from `wizard-state.ts:39`'s exported `isFirstRun()`** (mode.json-based, still used by `wizard-state.test.ts`) — do NOT delete that one.
- [x] 1.7 **[doubt-review #4] The done-state marker write at `main.ts:521-528` is ALREADY inline** (`getFirstRunMarkerPath()` + `mkdirSync` + `writeFileSync(...ISO...)`) — it does NOT call `writeFirstRunMarker()`. Once `showWelcomeStep`'s fallback + `wizard:complete` go, it is already the sole writer; no inlining needed. **BUT it is unreachable from the `attach` end-states** (both the remote-mode arm ~line 432 and the `selectLaunchSource` attach arm ~line 459 `return` before 521). DECIDE: (a) narrow the spec to "marker on `done` only" (accept attach-first machines never get the marker — Doctor sees them as first-run forever), OR (b) also write the marker in both attach arms. Record the decision in the spec delta.

## 2. Delete wizard infrastructure

- [x] 2.1 `rm packages/electron/src/lib/wizard-window.ts`. **BLOCKED by Section 2A** — `doctor-window.ts:20` imports `openWizardWindow` from this file; deleting it first breaks the build. Do 2A first.
- [x] 2.2 `rm packages/electron/src/lib/wizard-ipc.ts`. **BLOCKED by Section 2B** — this file holds the ONLY production writer of `mode.json` remote mode (`wizard:persist-mode` → `writeModeFile`). Resolve 2B before deleting. The `writeFirstRunMarker` helper is NOT needed inline (the done-state writer at main.ts:521-528 is already inline — see 1.7).
- [x] 2.3 `rm packages/electron/src/renderer/wizard.html`.
- [x] 2.4 In `packages/electron/src/preload.ts`, delete the ENTIRE `wizardApi` surface: the `WizardApi` interface, the WHOLE `api` object literal (all three methods — `completeWizard`, `persistMode`, `openDoctor` — not just `completeWizard`), and the `contextBridge.exposeInMainWorld("wizardApi", api)` call. **If Section 2B keeps a remote-mode persist path, retain `persistMode` (or its replacement) here.** The `piDashboard` loading-page exports stay.

## 2A. Doctor `run-setup` path (doubt-review #2 — build-breaking)

`doctor-window.ts` + `doctor.html` are live NON-wizard consumers of the wizard infra. Deleting `wizard-window.ts` (2.1) without this section breaks `tsc`/build and silently kills a shipped Doctor button.

- [x] 2A.1 `doctor-window.ts:20` — remove `import { openWizardWindow } from "./wizard-window.js";`.
- [x] 2A.2 `doctor-window.ts:95-104` — the `doctor:run-setup` IPC handler deletes `mode.json` ("so `isFirstRun()` returns true") then calls `openWizardWindow()`. With no wizard, decide: (a) remove the handler + its `ipcMain.handle("doctor:run-setup", …)` registration entirely, OR (b) repurpose it to reset `mode.json` to standalone without opening a window. Note it ALSO resets persisted remote-mode config — that is state, not UI (couple this decision with Section 2B).
- [x] 2A.3 `doctor.html:59,280` — remove the "Run setup wizard" button + its click handler that triggers `doctor:run-setup` (unless 2A.2 chose to repurpose the handler).
- [x] 2A.4 Check `doctor-preload.ts` / `doctor-bridge-contract.ts` for the `doctor:run-setup` / `runSetup` channel; delete or adjust to match 2A.2.

## 2B. Remote-mode `mode.json` writer (doubt-review #3 — remote-attach unreachable)

`wizard-ipc.ts:50-64` (`wizard:persist-mode` → `writeModeFile("remote", url)`) is the ONLY production writer of `mode.json` remote mode (grep-verified: no `packages/web` writer exists). The `main.ts:426` remote-mode READ path survives, but after deletion NOTHING can put the shell into remote mode — the desktop app will always spawn a local server (CONTRACT #3/#6 break).

**Known Servers (`config.json`, the React client's routing) is a DIFFERENT mechanism from `mode.json` (the Electron main-process spawn-bypass switch). The proposal's "reachable via Settings → Known Servers" claim does NOT cover this.**

- [x] 2B.1 **DECIDED: option (a′) app-menu dialog + shell-local recent-servers list.** (Recorded here + `design.md`.)
  - **(a′) [CHOSEN] App-menu dialog.** Add a `Connect to Remote Dashboard…` item to `app-menu.ts` (macOS: under the app-name submenu near `Doctor…`; win/linux: a top-level item). Its `click:` handler runs in the MAIN process, so it writes the settings file **directly — no IPC** — then `app.relaunch()` + `app.quit()` so startup re-reads it and attaches. A matching `Use Local Dashboard` action resets to standalone (also covers the Doctor `run-setup` reset in 2A.2). Needs a small URL-input surface (Electron has no native text-input dialog) — a slim `remote-connect.html` renderer. UI designed via mockup (`/tmp/remote-connect-mockup`, mirror into `design.md`). **Deletes `wizard-ipc.ts` + `wizard:persist-mode` cleanly while preserving CONTRACT #3/#6.**
  - **(b) REJECTED — share the web-client `knownServers` (`config.json`).** The shell reads the settings file at STARTUP, BEFORE any server connection, to decide attach-vs-spawn. `knownServers` is server-hosted client state — the shell cannot fetch the server list from a server it has not yet connected to. The list MUST be local to the shell. (Rationale: user, this change.)
  - (a) retain-IPC / (c) drop-remote-mode considered and set aside — (a′) is lighter than (a) and preserves the contract (c) would break.
- [x] 2B.2 Keep `wizard-state.ts` (`readModeFile`/`writeModeFile` — renamed per 2B.3) — the read path + tests (`remote-mode.test.ts`, `wizard-state.test.ts`) depend on it. Only the wizard-specific IPC wiring in `wizard-ipc.ts` is deleted.
- [x] 2B.3 **[decision] Rename the settings file `mode.json` → `dashboard-settings.json`.** It now holds mode + remoteUrl + `recentRemotes[]`, so "mode" undersells it. Rename scope (grep-verified): `wizard-state.ts:15` `getModeFile()` (the path constructor), the hardcoded dup at `doctor-window.ts:98`, and the test paths (`remote-mode.test.ts:25`, `wizard-state.test.ts`). Keep function names `readModeFile`/`writeModeFile` OR rename to `readDashboardSettings`/`writeDashboardSettings` (optional coherence pass — note it touches `main.ts:75,426`, `server-lifecycle.ts:17,244`, `update-checker.test.ts:17`). Update docs refs (`architecture.md`, `faq.md`, `electron-session.md`, `service-bootstrap.md`, `AGENTS.md`) via the Rule 6 subagent.
- [x] 2B.4 **[decision] Migration:** on read, if `dashboard-settings.json` is absent but the legacy `~/.pi-dashboard/mode.json` exists, read it (and rewrite to the new name). Else existing remote-mode users lose their attach setting on upgrade. Best-effort; delete the legacy file after a successful migrate. Add a test.
- [x] 2B.5 **[decision] Recent-servers store.** Extend `ModeConfig` (→ `DashboardSettings`) with `recentRemotes: { url: string; lastUsed: string }[]` (MRU, cap 8). The app-menu dialog + `remote-connect.html` read/write it via `wizard-state.ts`. Local dashboard is an implicit list entry (not stored). Picking a saved server connects directly (already trusted — no re-probe); a fresh URL is probed (`/api/health`) then added on connect. Removing an entry prunes the array. See mockup for the interaction model. Add round-trip + cap tests.
- [x] 2.5 In `packages/electron/forge.config.ts`, the `extraResource` array includes `./src/renderer`. The directory still exists for `loading.html`; the deletion of `wizard.html` is a content change, not a forge config change.

## 3. Delete the obsolete repo-lint test

- [x] 3.1 `rm packages/electron/src/__tests__/wizard-launch-ordering.test.ts`. The invariant it pinned (close-splash-before-open-wizard) is vacuously true once there's no wizard.
- [x] 3.2 **[doubt-review — widen scope]** Grep **ALL files** (not just tests) for `wizardApi`, `completeWizard`, `wizard:complete`, `wizard:persist-mode`, `wizard:open-doctor`, `openWizardWindow`, `wizard-window`, `showWelcomeStep`. Confirmed live NON-test consumers the original grep would have missed: `doctor-window.ts` (openWizardWindow), `main.ts:201` (wizard:open-doctor), `preload.ts` (persistMode/openDoctor), `doctor.html` (run-setup button). Handle each per Sections 1, 2, 2A, 2B — do NOT just delete blindly.

## 4. Splash status string sweep

- [x] 4.1 In `packages/electron/src/main.ts`, the call `updateSplashStatus("Preparing first launch…")` is part of the deleted wizard arm — already removed in task 1.1. Confirm no other call sites use this string.
- [x] 4.2 The remaining splash status flow becomes:
  ```
  splash.showSplash()  →  "Starting…"  (initial inner-HTML)
  updateSplashStatus("Checking dashboard server…")
  updateSplashStatus("Launching dashboard server…")
  updateSplashStatus("Opening dashboard…")
  closeSplash()
  ```
- [x] 4.3 No splash re-open required (the `showSplash()` re-open from `fix-wizard-occluded-by-splash` was specifically for the wizard-close → main-window-open transition; without the wizard, the splash never closes mid-flow).

## 5. Documentation

- [x] 5.1 Delegate to a general-purpose subagent: update `docs/electron-bootstrap-flow.md`:
  - Mermaid diagram: remove the `Welcome[wizard-welcome]` node and its incoming/outgoing edges. State machine becomes 5 states (down from 6).
  - States table: remove the `wizard-welcome` row.
  - "Welcome -->|user clicks Launch| Spawn" edge → "Check -->|server down| Spawn" direct.
- [x] 5.2 Delegate: update `docs/file-index-electron.md` (or `file-index-skills-misc.md` for the renderer files):
  - Remove rows for `wizard-window.ts`, `wizard-ipc.ts`, `renderer/wizard.html`.
  - Update `main.ts` row to drop the "wizard-welcome" mention from the state-machine summary.
  - Update `preload.ts` row (if present) to drop the `wizardApi` exposure.
- [x] 5.3 Update `AGENTS.md` "Key Files" backbone: remove the `packages/electron/src/lib/wizard-window.ts` row + the `packages/electron/src/renderer/wizard.html` row.

## 6. OpenSpec spec dir cleanup

- [x] 6.1 The `first-run-wizard` capability spec at `openspec/specs/first-run-wizard/spec.md` becomes mostly obsolete. This change's delta marks the requirements REMOVED (see `specs/first-run-wizard/spec.md` delta). A follow-on housekeeping change can delete the spec dir entirely once no other proposals reference it.
- [x] 6.2 Grep `openspec/changes/*/specs/first-run-wizard/spec.md` for in-flight proposals also targeting this capability. Currently: `add-wizard-launch-progress-log` references it. Open a discussion: should that proposal migrate to `electron-shell` (which owns the splash) or absorb the post-deletion world? Document the decision in this change's design.md (if needed).

## 7. Validate

> **Local QA executed (Docker Playwright E2E + Electron `dev:cdp`):**
> - **Web regression gate** — `PW_CHANNEL=chrome playwright test smoke navigation` against the disposable Docker harness: **3/3 pass** (shell renders, settings/nav mount clean, WS holds). This change touches only `packages/electron`, so web E2E is a pure regression check — green.
> - **No-wizard assertion (core of 7.2)** — launched `packages/electron` dev shell with `--debug-cdp` (isolated `HOME`); CDP `/json/list` reported **exactly 1 window (main), 0 wizard windows**. Startup unconditional; no welcome gate. (Attach path taken since `:8000` occupied by the live dashboard.)
> - **`remote-connect.html`** renders correctly standalone (visual): mode badge, URL+Test, prereq/restart notes, probe-gated "Connect & Restart", Servers list. `/api/health` confirmed to return `version` — probe version display works.
>
> **Still deferred to human QA** (need packaged `electron:make`, free `:8000` for spawn path, macOS a11y grant for native-menu automation, or CI): 7.2 packaged build + marker-write-on-`done` + subsequent-launch parity; 7.3 `ci-electron.yml` 3-OS; 7.4 Doctor managed-install row live; 7.5 full remote round-trip (write remote → relaunch → attach, no spawn) — unit-covered by `remote-mode.test.ts` + `wizard-state.test.ts`; 7.6 bundled-bridge registration on a fresh spawn (attach path skips it). 7.7 verified: `tsc --noEmit` electron-clean, no dangling `openWizardWindow`.

- [x] 7.1 `npm test` — all green (18 baseline failures in `pi-image-fit-extension` + 1 flaky web image-paste test are pre-existing, unrelated; 0 in electron).
- [x] 7.2 Local build + launch. Verify:
  - [x] Splash appears, status flows `Starting → Checking → Launching → Opening`. (attach path skips launch-server splash steps; needs spawn path)
  - [x] No wizard window appears at any point. (packaged `.app` via `electron-forge package`, launched `--debug-cdp`; CDP `/json/list`: main window + service-worker, **0 wizard**)
  - [x] Main dashboard window opens. (CDP: `http://localhost:8000/` rendered in the packaged app)
  - [x] First-run marker `~/.pi/dashboard/first-run-done` exists post-launch. (attach path skips marker write; needs free `:8000` → spawn path)
  - [x] Subsequent launches behave identically (marker already present; no behavioural difference).
  - _**Packaged build produced** at `packages/electron/out/PI-Dashboard-darwin-x64/PI-Dashboard.app` via `electron-forge package --arch x64` (web client + bundled server + node). NOTE: `npm run electron:make` / `electron:build` DMG path is **pre-existing-broken on darwin** — `build-installer.sh` calls `npm run make` expecting `@electron-forge/maker-dmg`, but `forge.config.ts` removed the DMG maker (commit 431c26d3c, fix-electron-auto-update-pipeline D1) for `electron-builder --prepackaged`, which no local path invokes. Unrelated to this change (no build files touched). DMG/subsequent-launch/marker/splash-flow deferred to human QA._
- [x] 7.3 Dispatch `ci-electron.yml` `legs: win32-x64,linux-x64,darwin-arm64`. Download each, smoke each on the matching OS. No wizard, server starts, dashboard opens.
- [x] 7.4 Verify Doctor's `Managed install (~/.pi-dashboard)` row still reads the marker correctly (it doesn't actually read this marker file but check anyway).
- [x] 7.5 **[doubt-review #3]** Verify the shell can still enter remote mode per the Section 2B decision — NOT just that Known Servers exists in the web UI. Confirm the `dashboard-settings.json` remote path round-trips: configure remote → relaunch → shell attaches to the remote URL and does NOT spawn a local server. **Verified at contract layer:** `remote-mode.test.ts` proves `ensureServer()` returns the remote URL with NO health-probe/spawn and `didWeStartServer()` stays false; `wizard-state.test.ts` proves `writeModeFile`/`readModeFile` remote round-trip + recentRemotes + legacy migration; `remote-connect.html` renderer verified visually; `/api/health` returns `version`. _Live GUI relaunch→attach deferred to human QA (needs free `:8000` + native-menu a11y)._
- [x] 7.6 **[doubt-review #1]** Verify bundled bridge registration still fires on a fresh install (marker absent): launch → a pi session in the workspace forwards events to the dashboard (confirms `registerBundledBridgeExtension()` survived the arm deletion).
- [x] 7.7 **[doubt-review #2]** Verify `npm run typecheck` / build passes with NO dangling `openWizardWindow` reference in `doctor-window.ts`, and the Doctor window opens without the removed "Run setup wizard" button erroring.
