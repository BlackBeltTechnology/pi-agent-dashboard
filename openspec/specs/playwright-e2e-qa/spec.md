# playwright-e2e-qa Specification

## Purpose
TBD - created by archiving change add-playwright-e2e. Update Purpose after archive.
## Requirements
### Requirement: Browser-E2E suite lives at tests/e2e and is additive to VM QA
The repository SHALL provide a Playwright browser-E2E suite rooted at `tests/e2e/` with a root `playwright.config.ts` (`testDir: "tests/e2e"`, `baseURL: "http://localhost:18000"`, chromium project). This suite SHALL be additive — it SHALL NOT replace, port, or disable the VM smoke tests under `qa/tests/*.sh,*.ps1`, which retain ownership of clean-install and process-runtime verification across OSes.

The E2E suite SHALL be opt-in via `npm run test:e2e` and SHALL NOT run as part of the vitest unit run (`npm test`).

#### Scenario: E2E suite is separate from unit tests
- **WHEN** a developer runs `npm test`
- **THEN** the vitest unit suite SHALL run AND the Playwright E2E suite SHALL NOT be invoked

#### Scenario: VM QA untouched
- **WHEN** the Playwright suite lands
- **THEN** `qa/tests/*.sh` and `qa/tests/*.ps1` SHALL remain present and unmodified
- **AND** the VM QA Makefile targets SHALL continue to function

### Requirement: Playwright manages the Docker test container lifecycle
Playwright `globalSetup` SHALL spin up the Docker test harness (`docker/test-up.sh`) and wait until `GET http://localhost:18000/api/health` returns 200 before any spec runs. `globalTeardown` SHALL tear the container down (`docker/test-down.sh`, `compose down -v`), discarding all ephemeral state.

When `PW_E2E_USE_RUNNING=1` is set, `globalSetup` SHALL NOT spin up a container; it SHALL only assert that `:18000` is already healthy, and `globalTeardown` SHALL NOT tear anything down (the caller owns the container).

#### Scenario: Managed lifecycle (default)
- **WHEN** `npm run test:e2e` runs with `PW_E2E_USE_RUNNING` unset
- **THEN** globalSetup SHALL boot the container and block until `/api/health` → 200 (or fail with a message naming `docker/test-up.sh`)
- **AND** after the run globalTeardown SHALL run `docker/test-down.sh`
- **AND** the host `~/.pi` state SHALL be byte-identical before and after

#### Scenario: Attach to a running container (fast path)
- **WHEN** a developer has already run `docker/test-up.sh` and runs `PW_E2E_USE_RUNNING=1 npm run test:e2e`
- **THEN** globalSetup SHALL skip spin-up and only verify `:18000` health
- **AND** globalTeardown SHALL leave the container running

#### Scenario: Setup fails fast when container never goes healthy
- **WHEN** the container fails to become healthy within the configured timeout
- **THEN** globalSetup SHALL fail with a non-zero exit and a message referencing change `add-playwright-e2e`
- **AND** no specs SHALL run

### Requirement: Smoke spec proves the browser-to-container wiring
The suite SHALL ship at least one smoke spec that opens `baseURL` in a real browser, asserts the dashboard shell renders, and asserts one WebSocket-backed live signal reaches a connected state — proving `/ws` works through the browser, not only via the entrypoint probe.

#### Scenario: Smoke spec renders the shell and connects WS
- **WHEN** the smoke spec navigates to `/`
- **THEN** a stable dashboard root element SHALL be visible
- **AND** a WebSocket-driven connection indicator SHALL reach its connected state without a page reload

### Requirement: PI_E2E_SEED makes the Docker harness provider-ready

The Docker test harness SHALL, when `PI_E2E_SEED=1`, seed credentials and
network trust so browser-driven scenario specs can clear the LandingPage
onboarding gate and reach network-guarded endpoints. The seed SHALL run in
`docker/test-entrypoint.sh` before the base entrypoint, SHALL be a no-op when
the target files already exist, and SHALL default OFF so manual
`docker/test-up.sh` QA stays UI-only. `tests/e2e/global-setup.ts` SHALL set
`PI_E2E_SEED=1` for managed runs and SHALL blank host provider API keys so they
never leak into the disposable container.

#### Scenario: Seed clears the onboarding gate

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/auth.json` SHALL contain a fake `anthropic` OAuth credential
- **AND** `/api/provider-auth/status` SHALL report `anthropic` `authenticated:true` so `providersReady` is true
- **AND** the LandingPage step-2 ("Add folder") and step-3 ("Start session") CTAs SHALL be enabled

#### Scenario: Seed opens the network guard for the in-container browser

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/dashboard/config.json` SHALL set `trustedNetworks` to the RFC1918 private blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- **AND** the in-container browser (non-loopback source IP) SHALL receive 200 from `/api/browse` so the pin-directory dialog can list directories

#### Scenario: Default stays UI-only

- **WHEN** `docker/test-up.sh` runs WITHOUT `PI_E2E_SEED`
- **THEN** no credential or trusted-network seed SHALL be written
- **AND** the harness SHALL remain UI-only

### Requirement: Spawn round-trip and VCS/terminal/navigation scenarios

The suite SHALL include browser scenario specs that exercise a spawned session.
Specs SHALL select on existing app `data-testid`s and SHALL be idempotent with
respect to shared-container state (reuse an existing session card when present,
otherwise pin the baked git fixture and spawn). A spec SHALL assert the
session-card branch indicator (`git-branch-btn`) for git VCS — not the
worktree-only `composer-git-group`.

#### Scenario: Spawn round-trip renders a session card

- **WHEN** a session is spawned in the baked git fixture
- **THEN** a `session-card-desktop` SHALL become visible, proving the browser↔server↔bridge `/ws` round-trip

#### Scenario: Git VCS indicator renders

- **WHEN** a session is running in the git fixture
- **THEN** the `git-branch-btn` (title "Switch branch") SHALL become visible, proving git status was read from the repo

#### Scenario: Inline terminal mounts a live xterm

- **WHEN** the selected session's `open-inline-terminal-button` is clicked
- **THEN** an xterm pane SHALL mount, exposing its "Terminal input" textarea over the terminal WebSocket

#### Scenario: Settings route mounts without crashing

- **WHEN** the settings view is opened from the dashboard
- **THEN** `settings-content` SHALL be visible
- **AND** no uncaught `pageerror` SHALL have fired during navigation

