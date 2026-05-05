## Context

pi-agent-dashboard already has unit/component tests via Vitest, a web client built by Vite, and VM-based QA under `qa/` for install/runtime checks. The existing browser visual-debug skill supports ad hoc screenshot inspection through `pi-agent-browser`, but there is no repeatable iOS Safari screenshot-diff suite.

The dashboard is a PWA-style web UI served by the dashboard server on port `8000` or by Vite on port `3000` in dev. The client has mobile-specific layout paths (`useMobile`, `MobileShell`, `InstallBanner`) and stable `data-testid` seams on onboarding, settings, and mobile overlay components. Live dashboard state comes from a bridge pi session stream and local dashboard config. The server also reads config from `os.homedir()` and can register bridge settings, poll directories, and expose runtime state. A developer's normal dashboard is therefore too variable for baseline screenshots.

One important constraint: current bridge session registration does not carry fixed `startedAt`, `endedAt`, or status timestamps. A deterministic visual fixture cannot rely on bridge messages alone for all session-card metadata.

The proposed suite must target project surfaces instead of a generic `/login` flow, and it must have a deterministic dashboard/test-pi fixture for stable visual state.

## Goals / Non-Goals

**Goals:**

- Add an isolated iOS visual QA package under `qa/ios-visual/`.
- Use Appium 3, a pinned XCUITest driver v10+, WebdriverIO 9, TypeScript, Mocha, and `@wdio/visual-service`.
- Run against local dashboard URLs by default, with environment overrides for remote/tunnel URLs and simulator details.
- Provide a one-command deterministic mode that starts a separate dashboard instance on test ports with isolated `HOME`, config, Appium home, and runtime state.
- Provide a test-only fixture startup/seeding seam for deterministic session metadata that bridge messages cannot carry.
- Provide a test-pi fixture that connects to the test dashboard and replays production-shaped events for chat/tool UI.
- Gate visual tests on SPA availability and seeded-state readiness, not only server process health.
- Stabilize Safari/PWA state before checkpoints: theme, localStorage, service workers/caches, simulator site data, scroll, and animations.
- Cover deterministic dashboard states: seeded session list/detail, root onboarding/landing, `/settings?tab=providers`, and mobile-shell navigation.
- Commit only baseline screenshots; keep current run screenshots, diffs, fixture runtime files, Appium driver cache, and Appium logs out of git.
- Keep iOS visual tests opt-in and Mac-only so normal `npm test`, CI on Ubuntu, and release builds stay unchanged.

**Non-Goals:**

- No standalone Add-to-Home-Screen WebClip automation in the first version.
- No auth/login flow baseline; dashboard auth can redirect to provider UI and is not deterministic for visual diff.
- No mutation-heavy flows that create real sessions, restart a developer's server, edit real credentials, kill real processes, or depend on a developer's running pi agent.
- No hosted GitHub Actions macOS simulator job by default; self-hosted Mac runner guidance is enough.
- No production-visible fixture API; any fixture seam must be gated by fixture mode and unavailable in normal dashboard runs.

## Decisions

### D1. Place suite under `qa/ios-visual/`

Use `qa/ios-visual/` instead of `packages/*` or a root `pwa-tests/` folder.

Rationale: the existing repo groups platform QA under `qa/`; the iOS simulator suite is QA-only and should not become a publishable workspace package. A standalone `package.json` in `qa/ios-visual/` keeps heavy Appium/WebdriverIO dependencies out of the production workspace graph unless installed explicitly.

Alternative considered: `packages/ios-visual-tests/`. Rejected because `packages/*` is the npm workspace glob and release workflows publish workspaces unless packages are private and carefully excluded.

### D2. Use project-local Appium, WDIO, and Appium driver home

Add Appium and WebdriverIO as dev dependencies in `qa/ios-visual/package.json`; run them with `npm --prefix qa/ios-visual` scripts. Set `APPIUM_HOME` to `qa/ios-visual/.tmp/appium-home` (or another documented suite-local path) for driver install, doctor, and runs. Pin the XCUITest driver version in scripts/config instead of relying on a user's global `~/.appium` driver store.

Rationale: the user plan's global `npm i -g appium` works for one machine, but project-local tooling and a suite-local `APPIUM_HOME` are reproducible. Xcode, simulator runtimes, Homebrew packages, and first WDA build remain machine-level prerequisites.

Alternative considered: require globally installed Appium and global drivers. Rejected because global versions drift and make failures harder to reproduce.

### D3. Configure dashboard URL and simulator through env vars

Default `PI_DASHBOARD_BASE_URL` to `http://127.0.0.1:8000` for manual runs only. In deterministic fixture mode, the launcher must set `PI_DASHBOARD_BASE_URL` to the owned fixture dashboard URL and fail closed if WDIO would target the manual default or any URL that is not the fixture URL. Use `SIM_UDID` when set, else fall back to `IOS_DEVICE_NAME` (default `PWA-Test`) and `IOS_PLATFORM_VERSION` (default documented value). Use the same base URL for `baseUrl` and Safari's initial URL.

Rationale: dashboard can run in production mode on `8000`, dev mode through server proxy, direct Vite mode on `3000`, a tunnel URL, or a fixture dashboard on test ports. Fixture runs must not silently hit a developer's live dashboard.

Alternative considered: always start dashboard from the WDIO config. Rejected because developers still need a manual mode for debugging against dev/prod/tunnel targets.

### D4. Test deterministic UI states only

Create smoke visual specs that assert stable selectors/text before screenshots:

- `/` root onboarding or landing page; wait for `Welcome to pi-dashboard`, `Select a session`, or an onboarding test id.
- seeded session list and a seeded session detail view from the fixture state.
- `/settings?tab=providers`; wait for `settings-header` and `settings-content`.
- iPhone-sized mobile shell behavior; verify root/detail routing and safe overlay/menu state without spawning real sessions.

Rationale: visual baselines must be repeatable. Live sessions, model lists, credentials, auth provider redirects, and timestamps produce noisy diffs. The fixture gives richer UI coverage while keeping state fixed.

Alternative considered: port the sample login flow from the generic plan. Rejected because the dashboard does not expose a deterministic `/login` form.

### D5. Make baseline updates explicit

Set `autoSaveBaseline` from an env var such as `IOS_VISUAL_AUTO_SAVE_BASELINE=1`. Provide a separate `baseline` script for first-run baseline creation/update. Normal test runs compare against existing baselines and fail above an explicit mismatch threshold.

Rationale: unconditional `autoSaveBaseline: true` can hide regressions by silently accepting changed screenshots after baselines exist.

Alternative considered: always auto-save baselines. Rejected because it weakens visual regression protection.

### D6. Document Mac-only prerequisite flow

Document Xcode license, Homebrew packages, optional `applesimutils`, local Appium driver install, `appium driver doctor xcuitest`, simulator creation, UDID export, dashboard startup, baseline generation, normal run, and cleanup.

Rationale: most failures in Appium/XCUITest setup come from host prerequisites rather than project code. A repo-local guide reduces guesswork.

### D7. Start a separate fixture dashboard with isolated HOME and side effects disabled

Add a fixture launcher under `qa/ios-visual/` that:

1. creates an isolated runtime directory such as `qa/ios-visual/.tmp/dashboard-home`;
2. spawns dashboard and test-pi processes with `HOME` pointing at that runtime home;
3. writes `~/.pi/dashboard/config.json` under that isolated home with fixture ports and deterministic config;
4. starts the dashboard from the current checkout using explicit `--port` / `--pi-port` flags or `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT` env values;
5. enables fixture startup mode through a gated env/config flag such as `PI_DASHBOARD_FIXTURE_MODE=1` or by importing a fixture-only server launcher;
6. disables or neutralizes bootstrap/package install, mDNS advertise/browse, plugin loading/bridge registration, zrok cleanup/tunnel, auth, push, real session spawn, and other non-visual side effects;
7. waits for `/api/health` on the fixture HTTP port;
8. verifies that the SPA is actually served by probing `/` for dashboard HTML or a known selector-bearing document;
9. verifies every resolved fixture path stays under `qa/ios-visual/.tmp` and fails if it would read/mutate the developer's real `~/.pi` state;
10. sets `PI_DASHBOARD_BASE_URL` for WDIO and fails if it differs from the owned fixture URL;
11. shuts down the dashboard and fixture client after the run.

The fixture state should be defined in TypeScript or JSON under `qa/ios-visual/fixtures/`. Fixture cwd directories should be created under the isolated runtime directory with deterministic minimal contents so OpenSpec/resource polling cannot pull in developer filesystem state.

Rationale: a separate dashboard avoids polluting the developer's real dashboard config and session state. A fixture startup mode makes side effects testable instead of hoping isolated `HOME` is enough.

Alternatives considered:

- Use the developer's live dashboard and ask them to clean state. Rejected because visual diffs would be non-repeatable.
- Mock only browser APIs in the client. Rejected because it skips server/browser WebSocket paths and dashboard boot behavior.
- Launch a real pi agent with fake credentials. Rejected because model/provider/auth/tool state is slower and less deterministic than a fixture.

### D8. Seed deterministic session metadata through fixture mode, not bridge-only messages

The fixture needs fixed session IDs, names, cwd paths, statuses, `startedAt`, `endedAt`, model labels, git state, and ordering. Current bridge registration can provide some identity/metadata but not stable started/ended timestamps or ended status. Therefore deterministic session metadata must be seeded through a fixture-only mechanism, such as:

- direct fixture-mode server initialization that inserts session records into the in-memory session manager before browser replay;
- pre-seeded isolated session metadata/JSONL files that normal startup discovery reads from the fixture `HOME`;
- or another test-only seeding seam that is gated by fixture mode and unavailable in normal server runs.

The test-pi bridge client should still replay production-shaped event messages for chat/tool rows so the visual tests exercise the normal event reducer path.

Rationale: session-card relative-time UI drifts if the server uses `Date.now()` for seeded sessions. A bridge-only fixture cannot create fixed ended sessions with stable timestamps.

### D9. Specify the test-pi replay sequence and readiness gate

Server `/api/health` proves that the fixture dashboard process is alive; it does not prove that seeded sessions/events have reached browser-facing state. The launcher must therefore wait for a seeded-state readiness check before WDIO starts.

The replay sequence should be normative:

1. Start fixture dashboard and fixture seeding seam.
2. Connect test-pi fixture to the fixture pi gateway.
3. Send `session_register` for each seeded active bridge session with stable IDs/cwd/name/model/source and deliberate `eventCount` values.
4. Send deterministic `event_forward` rows for chat/tool display.
5. Send metadata updates such as git/model/process lists only when needed by the seeded UI.
6. Send `replay_complete` for each replayed session.
7. Open a browser-facing REST or WebSocket readiness check.
8. Assert expected session IDs, order, detail rows, replay completion, and fixture sentinel data.
9. Start WDIO only after all assertions pass.

Rationale: without this gate, first screenshots can capture an empty dashboard, partial replay, timeout fallback, or pending loading state.

### D10. Stabilize Safari/PWA state before screenshots

Before each visual run, the suite must reset or isolate Mobile Safari state. Acceptable approaches: erase the `PWA-Test` simulator for baseline runs, clear Safari/site data through simulator commands, or run in a known fresh simulator. The test helper should seed localStorage before checkpoints:

- `dashboard:theme = "dark"`
- `dashboard:theme-name = "base"`
- `pwa-install-dismissed = "true"` unless a test explicitly covers the install banner

It should also clear or control service workers/caches, set scroll position, wait for route/network/render idle, and disable/reduce animations where practical.

Rationale: the dashboard defaults theme to system, registers a service worker, has iOS install-banner behavior, and uses transitions. These are all valid product behavior but noisy for screenshot baselines.

### D11. Own the web-client serving path

Fixture mode must not assume `packages/client/dist/` exists. Before WDIO starts, the launcher must either:

- run/verify `npm run build` so the fixture dashboard can serve production static files; or
- start and own a Vite dev server, then run the fixture dashboard in `--dev` mode.

Readiness must include an HTML/UI probe for `/` after the chosen serving path is active.

Rationale: `/api/health` can pass while the SPA is missing, causing Safari to capture an error response rather than the dashboard.

### D12. Use one default baseline profile first

The first committed baseline profile is:

- simulator: `PWA-Test`
- device type: `iPhone 16`
- iOS runtime: `18.2`
- theme: dark/base
- mode: fixture dashboard

If contributors use a different simulator/runtime/theme, their screenshots should write to a separate baseline profile directory or be treated as local-only. Normal CI/self-hosted runs should use the default profile unless intentionally adding a new profile.

Rationale: committed visual baselines must have one source of truth. Multiple simulator/runtime/theme combinations can be added later as explicit profiles.

## Risks / Trade-offs

- Xcode/Appium setup is fragile across macOS and iOS runtime updates → provide `doctor` and driver reinstall commands in scripts/docs, all using the same suite-local `APPIUM_HOME`.
- Screenshot diffs can be noisy due to font rendering, scroll position, theme, timestamps, and live data → freeze tests to deterministic fixture routes, use stable waits, seed localStorage, and set visual tolerances deliberately.
- Fixture seeding seam can leak into production if not guarded → gate it behind fixture mode, keep it unavailable in normal CLI/server paths, and test that normal startup ignores fixture files/env.
- Fixture bridge protocol can drift from production protocol → type it against shared protocol definitions where possible and include a lightweight non-simulator validation step.
- Fixture dashboard ports can collide with local services → make ports configurable and fail with a clear message.
- Fixture processes can leak on failed tests → use a launcher that owns process lifecycle, signal forwarding, process-group termination, and port cleanup assertions.
- Server startup has bootstrap, mDNS, tunnel, plugin, zrok, auth, and push side effects → fixture mode must disable or verify absence of each one.
- First WDA build is slow → document first-run cost and keep `noReset` configurable.
- Separate package adds another dependency graph → keep it outside default install/test paths and mark generated artifacts ignored.
- iOS Simulator only covers Safari engine behavior, not Android/Chrome or standalone WebClip quirks → keep standalone PWA mode as future work.

## Migration Plan

1. Add `qa/ios-visual/` package, WDIO config, TypeScript config, smoke specs, helper scripts, and gitignore rules.
2. Add fixture state definitions, fixture-mode server seeding/startup seam, fixture dashboard launcher, and test-pi bridge client.
3. Add root helper scripts that delegate to `qa/ios-visual` without changing `npm test`.
4. Add initial baselines after verifying against the default simulator/profile and deterministic fixture dashboard.
5. Document setup and run flow in QA docs.
6. Rollback by removing `qa/ios-visual/`, root helper scripts, and the fixture-only startup/seeding seam; no user data migration required.

## Open Questions

- Which seeded sessions should be in the first fixture beyond the minimum active + ended session: tool-call rows, terminal/process data, OpenSpec cards, or all of them?
