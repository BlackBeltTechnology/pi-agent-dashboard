## ADDED Requirements

### Requirement: Isolated iOS visual QA package
The project SHALL provide an opt-in iOS visual test package under `qa/ios-visual/` that is separate from production packages and the default test suite.

#### Scenario: iOS visual tests run through explicit script
- **WHEN** a developer runs the root iOS visual test script
- **THEN** the command SHALL delegate to the `qa/ios-visual/` package and run WebdriverIO against the configured dashboard URL

#### Scenario: Default tests do not require Xcode or Appium
- **WHEN** a developer runs `npm test`
- **THEN** the iOS visual suite SHALL NOT run and SHALL NOT require Xcode, Appium, or an iOS Simulator

#### Scenario: QA package stays out of publishable workspaces
- **WHEN** release packaging or workspace publishing runs
- **THEN** the iOS visual test package SHALL NOT be treated as a publishable dashboard package

### Requirement: Project-local WebdriverIO, Appium, and driver store
The iOS visual QA package SHALL pin and invoke WebdriverIO, Appium, the Appium service, the visual service, TypeScript, Mocha, and the XCUITest driver from project-controlled dependencies and driver storage.

#### Scenario: Local WDIO runner executes
- **WHEN** the iOS visual test script runs after installing `qa/ios-visual/` dependencies
- **THEN** it SHALL invoke the local `wdio` runner and load `wdio.conf.ts`

#### Scenario: Appium doctor command uses suite-local Appium home
- **WHEN** a developer runs the iOS visual doctor script
- **THEN** it SHALL execute the XCUITest driver doctor through the package-local Appium executable with the suite-local `APPIUM_HOME`

#### Scenario: XCUITest driver install command pins driver version
- **WHEN** a developer runs the iOS visual driver-install script
- **THEN** it SHALL install or update a pinned `xcuitest` driver version into the suite-local `APPIUM_HOME`

#### Scenario: Global Appium driver store is not required
- **WHEN** the iOS visual suite runs
- **THEN** it SHALL NOT require a pre-existing driver install under the user's global `~/.appium` directory

### Requirement: Dashboard-specific Safari simulator configuration
The WebdriverIO configuration SHALL drive Mobile Safari in an iOS Simulator through Appium XCUITest and SHALL target the dashboard URL through environment configuration.

#### Scenario: Base URL defaults to local dashboard server only for manual runs
- **WHEN** `PI_DASHBOARD_BASE_URL` is unset in manual mode
- **THEN** the WebdriverIO `baseUrl` and Safari initial URL SHALL default to `http://127.0.0.1:8000`

#### Scenario: Fixture mode fails closed on wrong URL
- **WHEN** fixture mode starts WebdriverIO
- **THEN** the configured dashboard URL SHALL equal the owned fixture dashboard URL
- **AND** the run SHALL fail before screenshots if it would target the manual default or any other URL

#### Scenario: Base URL can target dev server, fixture dashboard, or tunnel
- **WHEN** `PI_DASHBOARD_BASE_URL` is set to another URL in manual mode
- **THEN** WebdriverIO SHALL use that URL for navigation and Safari startup

#### Scenario: Simulator UDID overrides device lookup
- **WHEN** `SIM_UDID` is set
- **THEN** the Appium capabilities SHALL include that UDID for simulator selection

#### Scenario: Simulator name and platform are configurable
- **WHEN** `IOS_DEVICE_NAME` or `IOS_PLATFORM_VERSION` are set
- **THEN** the Appium capabilities SHALL use those values instead of documented defaults

### Requirement: Deterministic dashboard fixture
The iOS visual suite SHALL provide a fixture mode that starts a separate dashboard instance connected to deterministic fixture state.

#### Scenario: Fixture dashboard uses isolated HOME and runtime state
- **WHEN** the fixture dashboard launcher runs
- **THEN** it SHALL start a dashboard instance with isolated `HOME`, config, session, dashboard, and runtime directories under the suite temporary directory
- **AND** it SHALL NOT read or mutate the developer's normal dashboard state

#### Scenario: Fixture dashboard verifies path isolation
- **WHEN** fixture startup resolves dashboard config, session, Appium, and fixture cwd paths
- **THEN** startup SHALL fail if any resolved path points outside the suite fixture/runtime directories except explicit project source reads

#### Scenario: Fixture dashboard uses separate ports
- **WHEN** the fixture dashboard starts
- **THEN** it SHALL listen on test-specific HTTP and pi gateway ports that are configurable and distinct from the normal dashboard defaults unless explicitly overridden

#### Scenario: Fixture startup disables nonessential side effects
- **WHEN** the fixture dashboard starts in fixture mode
- **THEN** bootstrap/package install, mDNS advertise/browse, plugin loading/bridge registration, zrok cleanup/tunnel, auth, push, and real session spawning SHALL be disabled or proven isolated

#### Scenario: Fixture side-effect absence is verified
- **WHEN** the non-simulator fixture validation runs
- **THEN** it SHALL verify no bootstrap banner/install is in progress, no unexpected plugin health entries are active, no peer-server noise is emitted, and no non-fixture tunnel/auth/push state affects browser-visible output

#### Scenario: Fixture waits for process health first
- **WHEN** the fixture launcher starts the dashboard process
- **THEN** it SHALL wait for the fixture dashboard health endpoint before connecting the test-pi fixture

#### Scenario: Fixture verifies SPA availability
- **WHEN** fixture server health passes
- **THEN** the launcher SHALL verify that `/` serves the dashboard SPA from either a built client bundle or an owned Vite dev server before starting WebdriverIO

#### Scenario: Fixture mode seeds deterministic session metadata
- **WHEN** fixture mode initializes dashboard state
- **THEN** it SHALL seed fixed session IDs, names, cwd paths, statuses, `startedAt`, `endedAt`, model labels, git state, and ordering through a fixture-only startup/seeding seam or pre-seeded isolated persistence

#### Scenario: Fixture seeding seam is not production-visible
- **WHEN** the dashboard starts without fixture mode
- **THEN** fixture-only seed inputs SHALL be ignored or unavailable, and no fixture API SHALL be exposed to normal users

#### Scenario: Test-pi fixture uses production-shaped bridge messages for events
- **WHEN** the test-pi fixture connects to the fixture dashboard
- **THEN** it SHALL replay deterministic chat/tool rows through bridge protocol messages shaped like production session registration, event forwarding, metadata updates, and replay completion

#### Scenario: Test-pi replay sequence is deterministic
- **WHEN** the test-pi fixture replays events
- **THEN** it SHALL follow the sequence: connect, `session_register` with deliberate `eventCount`, deterministic `event_forward` rows, needed metadata updates, `replay_complete`, then readiness verification

#### Scenario: Fixture waits for seeded state readiness
- **WHEN** the test-pi fixture finishes replaying deterministic messages
- **THEN** the launcher SHALL verify through a browser-facing REST or WebSocket check that expected session IDs, ordering, replay completion, events, and selected detail data are visible before WebdriverIO starts visual checkpoints

#### Scenario: Test-pi fixture seeds predictable state
- **WHEN** the seeded-state readiness check passes
- **THEN** deterministic sessions, events, names, cwd paths, statuses, timestamps, model labels, git state, chat content, and tool content from fixture files SHALL be visible in the dashboard

#### Scenario: Fixture cwd data stays deterministic
- **WHEN** a seeded session references a cwd
- **THEN** that cwd SHALL point to deterministic fixture directories under the suite runtime directory or an explicitly controlled test fixture path

#### Scenario: Fixture cleanup stops owned processes and frees ports
- **WHEN** the visual run exits, fails, or is interrupted
- **THEN** the fixture launcher SHALL stop owned dashboard, Vite if owned, and test-pi processes, clean temporary runtime files, and verify fixture HTTP/pi ports are no longer listening

### Requirement: Project-specific visual smoke coverage
The iOS visual suite SHALL include visual smoke tests for deterministic dashboard UI states using stable selectors and current dashboard routes.

#### Scenario: Root onboarding or landing page baseline
- **WHEN** the suite navigates to `/`
- **THEN** it SHALL wait for a stable dashboard root state such as onboarding content or the sessionless landing page before taking a full-page visual checkpoint

#### Scenario: Seeded session list and detail baseline
- **WHEN** the suite runs against the deterministic fixture dashboard
- **THEN** it SHALL capture at least one visual checkpoint covering seeded session list/detail UI from the test-pi fixture

#### Scenario: Settings providers route baseline
- **WHEN** the suite navigates to `/settings?tab=providers`
- **THEN** it SHALL wait for `settings-header` and `settings-content` before taking a visual checkpoint of the settings page

#### Scenario: Mobile shell baseline
- **WHEN** the suite runs in the configured iPhone simulator viewport
- **THEN** it SHALL capture at least one checkpoint that exercises the dashboard mobile shell without requiring a live pi session

#### Scenario: Generic login sample is not used
- **WHEN** visual smoke specs are implemented
- **THEN** they SHALL NOT assume a deterministic `/login` form, test credentials, or a post-login dashboard element

### Requirement: Safari and PWA state stabilization
The iOS visual suite SHALL normalize browser and app state before visual checkpoints.

#### Scenario: Safari site data is reset or isolated
- **WHEN** a fixture visual run starts
- **THEN** Mobile Safari site data for the target dashboard URL SHALL be cleared, isolated by a fresh simulator, or reset by an equivalent documented mechanism

#### Scenario: Theme and install banner state are seeded
- **WHEN** a visual test opens the dashboard
- **THEN** it SHALL seed localStorage to use dark/base theme and a deterministic PWA install-banner state before taking screenshots

#### Scenario: Service worker and cache state are controlled
- **WHEN** a visual checkpoint is taken
- **THEN** service worker and cache state SHALL be cleared, disabled, or made deterministic for the fixture URL

#### Scenario: Motion and timing noise are reduced
- **WHEN** a visual checkpoint is taken
- **THEN** the suite SHALL wait for route/render stability and SHALL reduce or disable animations/transitions where practical

#### Scenario: Scroll position is deterministic
- **WHEN** a full-page or element screenshot is captured
- **THEN** the suite SHALL set or verify the expected scroll position before the checkpoint

### Requirement: Visual baseline and artifact handling
The iOS visual suite SHALL store reviewable baseline images in git and SHALL ignore generated run artifacts.

#### Scenario: Baselines are committed assets for default profile
- **WHEN** the first approved baseline run completes for the default profile
- **THEN** baseline screenshots under the configured baseline folder SHALL be suitable for committing to git

#### Scenario: Baseline profile is explicit
- **WHEN** baselines are generated
- **THEN** the output path SHALL encode or otherwise separate the simulator/device/runtime/theme profile so incompatible profiles do not overwrite each other

#### Scenario: Temporary screenshots and diffs are ignored
- **WHEN** a normal visual test run produces current screenshots, diff images, fixture runtime files, Appium driver cache, or Appium logs
- **THEN** those generated artifacts SHALL be ignored by git

#### Scenario: Baseline updates are explicit
- **WHEN** a normal visual test run detects a screenshot difference above the configured threshold
- **THEN** it SHALL fail rather than silently replacing the existing baseline

#### Scenario: Baseline script can create or update baselines
- **WHEN** a developer intentionally runs the baseline update script
- **THEN** the visual service SHALL be allowed to create or update missing baseline screenshots

#### Scenario: Visual mismatch threshold is configurable
- **WHEN** `IOS_VISUAL_MISMATCH_PERCENT` or equivalent suite config is set
- **THEN** visual assertions SHALL use that threshold to decide pass/fail

### Requirement: Mac setup and run documentation
The project SHALL document the Mac-only setup and run workflow for the iOS visual suite.

#### Scenario: Host prerequisites are documented
- **WHEN** a developer reads the iOS visual QA documentation
- **THEN** it SHALL list Xcode Command Line Tools, Xcode license acceptance, Homebrew packages, optional `applesimutils`, Appium driver install, suite-local `APPIUM_HOME`, and XCUITest doctor checks

#### Scenario: Simulator creation is documented
- **WHEN** a developer reads the simulator setup section
- **THEN** it SHALL show how to list runtimes/devices, create the recommended `PWA-Test` simulator, boot it, and export `SIM_UDID`

#### Scenario: Deterministic dashboard startup is documented
- **WHEN** a developer reads the run instructions
- **THEN** it SHALL explain how to start the isolated fixture dashboard/test-pi mode and how to point tests at it

#### Scenario: Manual dashboard targets are documented
- **WHEN** a developer reads the run instructions
- **THEN** it SHALL explain how to point tests at the local dashboard server, Vite/dev mode, or a tunnel URL through `PI_DASHBOARD_BASE_URL`

#### Scenario: Self-hosted Mac CI guidance exists
- **WHEN** a team wants to automate the suite
- **THEN** the documentation SHALL include a self-hosted Mac runner command sequence that boots the simulator, starts the fixture dashboard, waits for seeded state, runs the suite, and shuts everything down
