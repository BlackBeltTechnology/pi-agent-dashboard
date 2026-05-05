## Why

Current automated coverage exercises React units, server paths, and VM install/runtime checks, but it does not render the dashboard in real Mobile Safari. iOS Safari/PWA layout, viewport, service-worker, and touch-navigation regressions can ship unnoticed even though the product targets mobile web usage.

Visual diffs also need stable app data. Running against a developer's live dashboard makes screenshots depend on active sessions, local config, credentials, theme, Safari cache, and timing.

## What Changes

- Add a separate, opt-in iOS visual test suite for the dashboard PWA under `qa/ios-visual/`.
- Use project-local WebdriverIO 9 + TypeScript + Mocha + Appium service + `@wdio/visual-service` instead of a global WDIO scaffold.
- Drive iOS Simulator Safari through Appium 3 + a pinned `appium-xcuitest-driver` v10+ and capture screenshot diffs against committed baselines.
- Add a separate deterministic dashboard launcher for visual tests, using isolated `HOME`, dashboard config, runtime files, Appium home, and test ports.
- Add a fixture-mode dashboard/test-pi seam so tests can seed deterministic session metadata that the production bridge protocol cannot carry, while still replaying production-shaped bridge events for chat/tool UI.
- Add a web-client serving gate: fixture mode must build/serve the SPA or own a Vite dev server before WDIO starts.
- Wait for seeded dashboard state and UI readiness before starting visual checkpoints, not just server `/api/health`.
- Stabilize Safari/PWA state before screenshots: clear or isolate site data, seed theme/localStorage keys, control service-worker/cache state, and reduce animation/timing noise.
- Target this dashboard's routes and selectors, not the generic sample app: seeded session list/detail states, root onboarding/landing page, settings/providers tab, and mobile shell behavior.
- Configure URL, simulator UDID, device name, platform version, fixture ports, screenshot tolerances, baseline profile, theme, fixture mode, and baseline update mode through environment variables.
- Add scripts and documentation for macOS prerequisites, simulator creation, Appium driver doctor, deterministic dashboard startup, first baseline generation, normal diff runs, cleanup, and optional self-hosted Mac CI usage.
- Keep the suite out of default `npm test` and Ubuntu CI so contributors without Xcode/Appium are not blocked.

## Capabilities

### New Capabilities
- `ios-appium-visual-tests`: Appium/WebdriverIO-based visual regression tests for the dashboard PWA in iOS Simulator Safari, backed by an isolated deterministic dashboard/test-pi fixture.

### Modified Capabilities

## Impact

- New QA-only package and files under `qa/ios-visual/`.
- Root `package.json` gains opt-in helper scripts that delegate to `qa/ios-visual`.
- A fixture launcher starts a second dashboard instance on test ports with isolated state and a predictable test-pi bridge client.
- A test-only fixture startup/seeding seam may be added to server startup; it must be gated by fixture env/config and unavailable in normal dashboard runs.
- `qa/README.md` gains a pointer to the iOS visual suite; generated screenshots, fixture runtime files, Appium driver cache, and Appium logs must stay gitignored except committed baselines.
- New dev-time dependencies for the isolated QA package: Appium, WebdriverIO, `@wdio/visual-service`, `@wdio/appium-service`, TypeScript, Mocha runner, and supporting types.
- No normal production runtime API, extension bridge behavior, Electron packaging behavior, or normal dashboard state changes for users.
