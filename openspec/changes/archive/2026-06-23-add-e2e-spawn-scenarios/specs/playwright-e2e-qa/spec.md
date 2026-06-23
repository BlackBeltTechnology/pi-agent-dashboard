# playwright-e2e-qa — delta

## ADDED Requirements

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
