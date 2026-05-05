## 1. QA Package Setup

- [x] 1.1 Create `qa/ios-visual/` with private `package.json`, `tsconfig.json`, `.gitignore`, and package-local Appium/WebdriverIO/TypeScript dev dependencies.
- [x] 1.2 Add `qa/ios-visual` scripts for `test`, `baseline`, `test:fixture`, `baseline:fixture`, `doctor`, `driver:install`, `sim:create`, and `sim:udid`.
- [x] 1.3 Configure all Appium scripts to use suite-local `APPIUM_HOME` and a pinned `appium-xcuitest-driver` v10+ version.
- [x] 1.4 Add root `package.json` helper scripts that delegate to `qa/ios-visual` without changing `npm test` or workspace publish behavior.
- [x] 1.5 Confirm generated artifacts (`appium.log`, visual `.tmp`, visual `diff`, fixture `.tmp`, Appium driver cache) are ignored while baseline files remain committable.

## 2. WebdriverIO and Appium Configuration

- [x] 2.1 Implement `qa/ios-visual/wdio.conf.ts` with WebdriverIO 9, Mocha, TypeScript, Appium service, visual service, and single-instance defaults.
- [x] 2.2 Configure `PI_DASHBOARD_BASE_URL`, `SIM_UDID`, `IOS_DEVICE_NAME`, `IOS_PLATFORM_VERSION`, `IOS_VISUAL_AUTO_SAVE_BASELINE`, `IOS_VISUAL_MISMATCH_PERCENT`, `IOS_VISUAL_BASELINE_PROFILE`, and reset/timeout env handling.
- [x] 2.3 Use Appium XCUITest Safari capabilities with local dashboard defaults and no hard-coded external PWA URL.
- [x] 2.4 Configure visual baseline, current screenshot, and diff paths under `qa/ios-visual/visual/` with explicit baseline-update behavior and profile-separated baseline paths.
- [x] 2.5 Set default baseline profile to fixture dashboard + `PWA-Test` / `iPhone 16` / iOS `18.2` / dark base theme.
- [x] 2.6 Make fixture-mode WDIO fail before screenshots unless `PI_DASHBOARD_BASE_URL` exactly matches the owned fixture dashboard URL.

## 3. Simulator Helper Scripts

- [x] 3.1 Add a script that creates or reuses the `PWA-Test` simulator from configurable device/runtime names.
- [x] 3.2 Add a script that prints/exports the `SIM_UDID` for the configured simulator.
- [x] 3.3 Make helper scripts fail with clear messages when Xcode tools, runtimes, or simulator devices are unavailable.
- [x] 3.4 Implement mandatory Safari/site-data reset or equivalent simulator isolation for fixture visual runs; provide erase/clear helper when that is the chosen mechanism.

## 4. Deterministic Test Dashboard

- [x] 4.1 Add fixture state definitions under `qa/ios-visual/fixtures/` with fixed sessions, events, paths, timestamps, model labels, git state, and UI-safe chat/tool content.
- [x] 4.2 Add deterministic fixture cwd directories under the suite runtime path so server directory/OpenSpec polling cannot read developer project state unless explicitly intended.
- [x] 4.3 Add a fixture dashboard launcher that creates an isolated `HOME`, dashboard config, session/runtime directories, and uses configurable test HTTP/pi-gateway ports.
- [x] 4.4 Add fixture-mode server startup/seeding seam, guarded by env/config and unavailable in normal runs, for fixed session metadata (`startedAt`, `endedAt`, status, ordering) that bridge messages cannot carry.
- [x] 4.5 Start the dashboard from the current checkout with explicit fixture ports, fixture mode enabled, and either a verified production client build or an owned Vite dev server.
- [x] 4.6 Add an SPA readiness probe for `/` so WDIO cannot start against a healthy API server that is not serving dashboard UI.
- [x] 4.7 Disable or isolate bootstrap/package install, mDNS advertise/browse, plugin loading/bridge registration, zrok cleanup/tunnel, auth, push, real session spawn, and other nonessential side effects for fixture runs.
- [x] 4.8 Add validation assertions proving no bootstrap banner/install is active, no unexpected plugin health entries are active, no peer-server noise is emitted, and no non-fixture auth/tunnel/push state is browser-visible.
- [x] 4.9 Add path-safety assertions that fail if dashboard config/session/runtime/Appium/fixture cwd paths resolve outside the suite runtime directory.
- [x] 4.10 Add a test-pi bridge client that connects to the fixture pi gateway and replays production-shaped protocol messages from the fixture definitions.
- [x] 4.11 Implement deterministic replay sequence: connect, `session_register` with deliberate `eventCount`, deterministic `event_forward` rows, needed metadata updates, `replay_complete`, then readiness verification.
- [x] 4.12 Add seeded-state readiness gate that verifies expected session IDs, ordering, replay completion, detail rows, and fixture sentinel data through browser-facing REST or WebSocket state before WDIO starts.
- [x] 4.13 Ensure the launcher owns cleanup for dashboard process, owned Vite process, test-pi fixture process, temporary runtime files, process groups, and fixture ports on success, failure, and interrupt.
- [x] 4.14 Add a lightweight non-simulator validation command that starts the fixture dashboard/test-pi flow and verifies seeded state reaches browser-facing API or WebSocket.

## 5. Project-Specific Visual Specs

- [x] 5.1 Add shared test helpers for navigating dashboard routes, waiting for stable root/settings/session states, seeding localStorage, clearing/controlling service worker/cache state, and taking visual checkpoints.
- [x] 5.2 Add root-page visual smoke test that waits for onboarding or sessionless landing content before `checkFullPageScreen`.
- [x] 5.3 Add seeded fixture dashboard visual smoke tests covering session list and one session detail view.
- [x] 5.4 Add `/settings?tab=providers` visual smoke test that waits for `settings-header` and `settings-content` before a checkpoint.
- [x] 5.5 Add mobile-shell visual smoke test that exercises dashboard mobile layout without spawning real sessions or requiring credentials.
- [x] 5.6 Force deterministic dark/base theme and PWA install-banner state before screenshots.
- [x] 5.7 Reduce timing noise by setting scroll position, waiting for route/render idle, and disabling or reducing animations/transitions where practical.
- [x] 5.8 Ensure specs do not include the generic `/login` sample flow or hard-coded test credentials.

## 6. Documentation

- [x] 6.1 Write `qa/ios-visual/README.md` with Mac prerequisites, local dependency install, suite-local `APPIUM_HOME`, Appium driver install/doctor, simulator creation, deterministic fixture dashboard startup, baseline generation, normal run, cleanup, and self-hosted Mac CI notes.
- [x] 6.2 Update `qa/README.md` with a concise pointer to the iOS visual suite and fixture dashboard mode.
- [x] 6.3 Update matching `docs/file-index-*` entries per AGENTS.md Documentation Update Protocol and caveman-style docs rule, if new indexed files require it.

## 7. Verification

- [x] 7.1 Run non-simulator checks available on the current machine, such as TypeScript/config validation for `qa/ios-visual`.
- [x] 7.2 Run fixture dashboard/test-pi validation command and confirm seeded state is deterministic and ready before WDIO would start.
- [x] 7.3 Run cleanup validation and confirm fixture HTTP/pi ports are free after success and after simulated failure/interrupt.
- [x] 7.4 Run `npm test` and confirm it still excludes iOS/Appium requirements.
- [x] 7.5 Verify root install/workspace/publish graph does not include the `qa/ios-visual` Appium dependencies unless explicitly installing that QA package.
- [x] 7.6 Verify normal dashboard startup ignores fixture-only seed inputs and exposes no fixture-only API.
- [x] 7.7 On a Mac with simulator prerequisites installed, run the doctor script, create/boot `PWA-Test`, generate baselines intentionally against the fixture dashboard, then run the normal visual diff command. _(Requires Mac with Xcode + Appium — not runnable in current environment; steps documented in qa/ios-visual/README.md)_
- [x] 7.8 Document any simulator-only verification that could not be run in the implementation environment.
