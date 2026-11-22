# Test Plan — electron-menu-submenus

Stage: design   Generated: 2026-11-20

Scope: Win/Linux app menu regrouped Dashboard/Edit/View/Help via exported pure `buildWinLinuxMenuTemplate(opts?: {isDev?})` in `packages/electron/src/lib/app-menu.ts`; darwin unchanged. Handler internals (`serversMenuItem`, `runtimeSubmenu`, `buildBrowserRelayMenuItem`) are out of scope (proposal non-goal); handler-outcome rows S19–S31 pin existing spec scenarios of the MODIFIED "Application Menu" requirement, reached through the menu `click`.

Level note: L1 = package-local vitest (`cd packages/electron && npx vitest run src/lib/__tests__/app-menu.test.ts`); root `vitest.config.ts` excludes `packages/electron`, so L1 rows are NOT CI-gated (accepted in proposal). `electron` = `tests/e2e-electron/*.electron.spec.ts` (Playwright `_electron`, `npm run test:e2e:electron`; CI-runnable on Linux).

Common L1 harness: `vi.mock("electron")` (app{name,getVersion}, BrowserWindow{getFocusedWindow}, dialog{showMessageBox,showOpenDialog}, Menu{buildFromTemplate,setApplicationMenu}, shell{showItemInFolder,openPath}) + mocks of `./app-updater.js`, `./doctor-window.js`, `./remote-connect-window.js`, `./runtime-overlay.js`, `./runtime-overlay-main.js`, shared `runtime-overlay/state.js`. NOT mocked: `./servers-menu.js`, `./browser-host/consent.js`. Platform via `Object.defineProperty(process,"platform",…)`; `vi.resetModules()` + dynamic import where module state (`serversMenuWired`) matters.

Exemplars: zombie-adoption.test.ts (electron mock factory), servers-menu.test.ts (Servers hooks), tray-menu.test.ts (pure template assertions), doctor-window.test.ts (BrowserWindow mock), quit-guard.test.ts (before-quit fake), preload-bridge.electron.spec.ts + electron-lifecycle.ts (real app launch).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | electron-native-chrome / Win-Linux menu structure | spec-based equivalence | L1 | automated | `buildWinLinuxMenuTemplate({isDev:false})` | call | top-level `label`s deep-equal `["Dashboard","Edit","View","Help"]` (length 4, order exact) |
| S2 | same (Dashboard group) | spec-based (ordered list) | L1 | automated | `{isDev:false}`, Servers hooks set | call | Dashboard submenu entries in order: Servers (submenu), "Connect to Remote Dashboard…", "Use Local Dashboard", Runtime (submenu), "Browser relay" (submenu), `{type:"separator"}`, `{role:"quit"}`; last item is quit, no item after |
| S3 | same (Help group) | spec-based | L1 | automated | `{isDev:false}` | call | Help = "Doctor","Check for Updates…","View Update Log",separator,"About" in that order; Doctor label is exactly "Doctor" (not "Doctor...", D4) |
| S4 | Update-check hidden in dev | BVA (isDev true/false) | L1 | automated | `{isDev:true}` | call | Help = "Doctor","View Update Log",separator,"About"; no label "Check for Updates…" anywhere in tree |
| S5 | same (Edit group, D3) | spec-based | L1 | automated | any opts | call | Edit submenu = roles undo, redo, separator, cut, copy, paste, selectAll (exact, no `click`) |
| S6 | same (View group, unchanged items) | spec-based | L1 | automated | any opts | call | View = Reload `CmdOrCtrl+R`, Force Reload `CmdOrCtrl+Shift+R`, role toggleDevTools, separator, resetZoom, zoomIn, zoomOut, separator, togglefullscreen |
| S7 | "no flat top-level" | invariant / property | L1 | automated | `{isDev:false}` and `{isDev:true}` | call | every top-level item has array `submenu` and `click === undefined`; no top-level `role` |
| S8 | isDevMode default (D2) | decision-table (ELECTRON_DEV × resourcesPath) | L1 | automated | 4 combos: (env set, rp absent) (set, present) (unset, absent) (unset, present) | `buildWinLinuxMenuTemplate()` no args | "Check for Updates…" present ONLY for (unset, present); hidden in other three |
| S9 | opts overrides env | BVA / precedence | L1 | automated | ELECTRON_DEV set + resourcesPath present | `{isDev:false}` then (env unset, rp present) `{isDev:true}` | explicit opt wins both ways |
| S10 | setupAppMenu dispatch (win32,linux) | pairwise platform × builder | L1 | automated | `process.platform` ∈ {win32, linux} | `setupAppMenu()` | `Menu.buildFromTemplate` called once with array whose labels = `["Dashboard","Edit","View","Help"]`; `Menu.setApplicationMenu` called once with its return value |
| S11 | macOS unchanged | regression pin / snapshot | L1 | automated | `process.platform="darwin"`, `app.name="PI Dashboard"` | `setupAppMenu()` | top labels `["PI Dashboard","Edit","View","Window"]`; app submenu still has "About PI Dashboard", "Doctor...", Servers, Connect…, Use Local, Runtime, Browser relay, hide/hideOthers/unhide, quit; no "Dashboard" top-level |
| S12 | pure builder (D2) | idempotence / purity | L1 | automated | two calls with same opts | call twice, mutate 1st result (push item, rename a label) | 2nd result unaffected & deep-equal to a fresh third call; `Menu.*` spies never called by builder itself |
| S13 | Dashboard→Servers (boundary 0/1/N) | BVA on entry count | L1 | automated | Servers hooks `entries()` = [] / [1] / [2 incl. needsPairing] | builder | Dashboard[0].label "Servers" with non-empty submenu in all three (0 entries → only "Connect to another dashboard…"); N entries → N rows + separator + connect row |
| S14 | label uniqueness / accelerator collision | invariant (no duplicates) | L1 | automated | `{isDev:false}` | flatten tree | no two non-separator items share a `label`; no two items share an `accelerator` |
| S15 | Servers submenu stays live on Win/Linux | state-transition | L1 | automated | platform=linux, hooks entries=[A]; `setupAppMenu()` once | entries→[A,B]; `notifyServersMenuChanged()` | `Menu.setApplicationMenu` called a 2nd time; its template's Dashboard→Servers submenu contains B's label |
| S16 | rebuild wired once | idempotence (module state `serversMenuWired`) | L1 | automated | fresh module (`vi.resetModules`); call `setupAppMenu()` 3× | one `notifyServersMenuChanged()` | `setApplicationMenu` called exactly 3 + 1 times (single listener, no fan-out) |
| S17 | Dashboard actions | decision-table | L1 | automated | builder tree | invoke `click` of "Connect to Remote Dashboard…", "Use Local Dashboard" | `openRemoteConnectWindow` ×1, `useLocalDashboard` ×1, nothing else called |
| S18 | Doctor action | decision-table | L1 | automated | Help→Doctor | `click()` | `openDoctorWindow` called once (Doctor handler now lives under Help) |
| S19 | Doctor idempotent focus | state-transition (1st/2nd activation) | L1 | automated | real `openDoctorWindow` with BrowserWindow mock (not mocked doctor-window) | call twice (2nd with `isMinimized()=true`) | 1 BrowserWindow constructed; 2nd call `restore()`+`focus()` on it |
| S20 | View reload accelerators | decision-table | L1 | automated | `BrowserWindow.getFocusedWindow()` returns win with `webContents.{reload,reloadIgnoringCache}` spies | click Reload / Force Reload | `reload` ×1 / `reloadIgnoringCache` ×1 respectively, not crossed |
| S21 | Browser relay → Revoke all still nested | decision-table | L1 | automated | `setRevokeAllHook` spy (real consent module) | click Dashboard→Browser relay→Revoke all | hook called once |
| S22 | Exit role is a *role*, not a click | invariant | L1 | automated | Dashboard last item | inspect | `role==="quit"` and `click===undefined` (so Electron's `app.quit()` → `installQuitGuard` is the path; no custom quit) |
| S23 | Exit goes through full quit on Win/Linux | state-transition (guard) | L1 | automated | `installQuitGuard(fakeApp,{isQuitting:()=>false,requestQuit})` | emit `before-quit` (what `role:"quit"` triggers) | `preventDefault` called, `requestQuit` ×1; 2nd emit does not call it again; when `isQuitting()=true` no intercept. (Existing coverage — confirm case present, add only if missing; guard is installed platform-independently at `main.ts:735`.) |

### Performance

None applicable — menu template built once at startup / on keyring change (< dozens of items); no workload, latency, or scale dimension.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S32 | Real app applies grouped menu (Linux CI host) | system E2E (main-process evaluate) | electron | automated | packaged app launched via `launchElectron` on a Linux runner, fake health server | `electronApp.evaluate(({Menu})=>Menu.getApplicationMenu()!.items.map(i=>i.label))` | deep-equal `["Dashboard","Edit","View","Help"]` after first window ready; skipped (`test.skip`) on non-win32/linux hosts |
| S33 | quit role label is platform-native | platform quirk | electron | automated | same launch | evaluate Dashboard submenu last item `.label` | `"Quit"` on linux, `"Exit"` on win32 (Electron-resolved; unit tests can't see it — the mocked `Menu` has no role-label logic) |
| S34 | Servers rebuild in real app | state-transition (real Menu) | electron | automated | real launch | keyring change (pair a 2nd server via existing `server-windows.electron.spec.ts` harness) then evaluate Dashboard→Servers submenu labels | new server label appears without restart; top-level labels still 4 |
| S35 | Native menubar rendering, title-bar width (the #1121 symptom) | visual/subjective | — | manual-only | Win 10/11 and Ubuntu (GNOME + KDE) builds, default window width | human views menu bar | [judgment: four compact menus fit title bar, no overflow/truncation; Exit/Quit sits at bottom of Dashboard] |
| S36 | Keyboard access (Alt-mnemonics/F10, arrow nav, accelerators Ctrl+R/Ctrl+Shift+R, Ctrl+Z/X/C/V/A in input) | usability / compatibility | — | manual-only | Windows + Linux builds, focus in the chat input | human uses keys | [judgment: menus reachable by keyboard; edit shortcuts and reload accelerators behave; no duplicate-accelerator double fire] |
| S37 | macOS visually unchanged | visual regression (human) | — | manual-only | macOS build | human opens menu bar | [judgment: identical to previous release; no "Dashboard" menu] — S11 pins structure, this pins native look |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S24 | Check for Updates — error | fault-injection | L1 | automated | `checkForUpdatesNow` resolves `{type:"error",message:"ENOTFOUND"}` | click Help→Check for Updates… | `dialog.showMessageBox` once with `type:"warning"`, message "Update check failed", detail "ENOTFOUND" |
| S25 | Check for Updates — current | state-transition | L1 | automated | `{type:"up-to-date",version:"1.2.3"}` | click | info dialog, message "You're up to date", detail contains "v1.2.3" |
| S26 | Check for Updates — update-available | equivalence | L1 | automated | `{type:"update-available",…}` | click | `showMessageBox` NOT called (dialog owned by main.ts listener) |
| S27 | View Update Log — none | BVA (path null / present) | L1 | automated | `getUpdateLogPath()` → null, then "/tmp/u.log" | click Help→View Update Log | null: info dialog "No update log available.", `showItemInFolder` not called; present: `showItemInFolder("/tmp/u.log")`, no dialog |
| S28 | About — no bundled git | equivalence | L1 | automated | `process.resourcesPath` undefined (or no `git/THIRD-PARTY-LICENSE.txt`) | click Help→About | dialog `title "About <app>"`, detail has `Version <getVersion()>` & "© Blackbelt Technology", `buttons:["OK"]`, no git line |
| S29 | About — bundled git + license button | equivalence + branch | L1 | automated | real tmp dir `…/git/THIRD-PARTY-LICENSE.txt` containing `Git version: 2.45.1`, `resourcesPath`→tmp; `showMessageBox` resolves `{response:1}` then `{response:0}` | click About twice | buttons `["OK","Open Bundled Git License"]`, detail has "Bundled Git for Windows v2.45.1"; response 1 → `shell.openPath(file)` ×1; response 0 → no openPath. Note: code checks file presence, not `process.platform` (spec says "Windows install") — assert file-presence behaviour only |
| S30 | Runtime item with no active runtime context | fault-injection (dependency absent) | L1 | automated | `getActiveRuntimeContext()` → null | click Dashboard→Runtime→Use Local Folder… and Stop Using Local Folder | "runtime not ready" dialog shown, `showOpenDialog`/`pickLocalFolder`/`runRuntimeSwitch` not called, no unhandled rejection |
| S31 | No focused window on Reload | fault-injection (null) | L1 | automated | `getFocusedWindow()` → null | click Reload and Force Reload | no throw, no `reload` call |

---

## Coverage summary

- Requirements covered: 8/8 — electron-native-chrome "Application Menu" scenarios (macOS structure S11, Win/Linux structure S1–S10, dev-hidden S4/S8/S9, Check for Updates result S24–S26, About S28/S29, View Update Log S27, Doctor S18/S19, Servers live rebuild S15/S34) + electron-shell "App menu on Windows/Linux" (S1/S3/S10). Design D1–D4 mapped: D1 S1/S2/S33; D2 S8/S9/S12; D3 S5; D4 S3.
- Scenarios by class: edge/structure/click 23 (S1–S23) · perf 0 · frontend/platform 6 (S32–S37) · error 8 (S24–S31)
- Scenarios by level: L1 31 · L2 0 · L3 0 · electron 3 · none 3 (native menu is not DOM; rendered-UI rule N/A)
- Scenarios by disposition: automated 34 · manual-only 3

## New infra needed

- none. S32–S34 live in a new spec file `tests/e2e-electron/app-menu.electron.spec.ts` reusing `tests/e2e-electron/electron-lifecycle.ts`; the L1 file `packages/electron/src/lib/__tests__/app-menu.test.ts` is new but uses the existing vitest setup.
