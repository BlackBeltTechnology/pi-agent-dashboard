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

Playwright `globalSetup` SHALL spin up the Docker test harness (`docker/test-up.sh`) and wait until `GET <baseURL>/api/health` returns 200 before any spec runs. `globalTeardown` SHALL tear the container down (`docker/test-down.sh`, `compose down -v`), discarding all ephemeral state.

In managed mode, `globalSetup` SHALL NOT pre-pin or `:0`-probe the host ports. It SHALL let `test-up.sh` derive a free port pair within the disjoint windows from the throwaway workspace's `HOST_CWD`, then resolve the chosen ports from the throwaway workspace's `.pi-test-harness.json` state file and propagate them (`PW_E2E_PORT`/`PW_GATEWAY_PORT`) so `baseURL` and worker processes stay in sync with the container. This makes two parallel managed runs (different workspaces) non-colliding without an ephemeral-port race.

When `PW_E2E_USE_RUNNING=1` is set, `globalSetup` SHALL NOT spin up a container; it SHALL only assert that the attach port (`PW_E2E_PORT`, default `:18000`) is already healthy, and `globalTeardown` SHALL NOT tear anything down (the caller owns the container).

#### Scenario: Managed lifecycle (default)
- **WHEN** `npm run test:e2e` runs with `PW_E2E_USE_RUNNING` unset
- **THEN** globalSetup SHALL boot the container via `test-up.sh` WITHOUT exporting a pre-chosen port pair
- **AND** SHALL read the derived ports back from the workspace `.pi-test-harness.json` and set `baseURL` to match
- **AND** SHALL block until `/api/health` → 200 (or fail with a message naming `docker/test-up.sh`)
- **AND** after the run globalTeardown SHALL run `docker/test-down.sh`
- **AND** the host `~/.pi` state SHALL be byte-identical before and after

#### Scenario: Two parallel managed e2e runs do not race on ports

- **WHEN** `npm run test:e2e` runs concurrently in two different worktrees, both managed
- **THEN** each boots from its own throwaway workspace, yielding a distinct in-window port pair and distinct compose project
- **AND** neither run's container fails to publish its host port due to the other
- **AND** each Playwright `baseURL` targets its own container

#### Scenario: Attach to a running container (fast path)
- **WHEN** a developer has already run `docker/test-up.sh` and runs `PW_E2E_USE_RUNNING=1 npm run test:e2e`
- **THEN** globalSetup SHALL skip spin-up and only verify the attach port's health
- **AND** globalTeardown SHALL leave the container running

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

The same `PI_E2E_SEED` seed SHALL ALSO make the harness drive a key-free faux
model, so UI-spawned sessions can complete a prompt → streamed-events → rendered
DOM round-trip with no LLM credential. The seed SHALL stage the faux fixture as
a global auto-discovered pi extension at
`~/.pi/agent/extensions/faux-provider/index.ts` with its sibling
`faux-scenarios.ts` (subdir form, because the extension imports
`./faux-scenarios.js`), and SHALL seed `defaultModel: "faux/faux-1"` into the pi
config. No `-e` flag and no change to the dashboard spawn argv contract
(`sessionFlagsToArgv`) SHALL be required. Both seeds SHALL be no-ops when the
files already exist and SHALL default OFF.

#### Scenario: Seed clears the onboarding gate

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/auth.json` SHALL contain a fake `anthropic` OAuth credential
- **AND** `/api/provider-auth/status` SHALL report `anthropic` `authenticated:true` so `providersReady` is true
- **AND** the LandingPage step-2 ("Add folder") and step-3 ("Start session") CTAs SHALL be enabled

#### Scenario: Seed opens the network guard for the in-container browser

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/dashboard/config.json` SHALL set `trustedNetworks` to the RFC1918 private blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- **AND** the in-container browser (non-loopback source IP) SHALL receive 200 from `/api/browse` so the pin-directory dialog can list directories

#### Scenario: Seed stages a key-free faux model

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/extensions/faux-provider/index.ts` and its sibling `faux-scenarios.ts` SHALL exist (auto-discovered global extension)
- **AND** the pi config SHALL set `defaultModel` to `faux/faux-1`
- **AND** a session spawned through the dashboard UI SHALL load the faux provider (no "No API provider registered for api: faux") and select `faux/faux-1` with no LLM credential

#### Scenario: Default stays UI-only

- **WHEN** `docker/test-up.sh` runs WITHOUT `PI_E2E_SEED`
- **THEN** no credential, trusted-network, faux-extension, or `defaultModel` seed SHALL be written
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

### Requirement: Faux fixture routes scenarios per session via prompt sentinel

The faux fixture (`qa/fixtures/faux-provider.ext.ts`) SHALL select its scripted
scenario per prompt from a `[[faux:<scenario-id>]]` sentinel in the latest user
message, looking the id up in the shared `qa/fixtures/faux-scenarios.ts`
catalog. Step selection within a multi-step scenario SHALL be derived from the
count of assistant turns since that user message, so multi-step scenarios (e.g.
`ask-select-roundtrip`) replay in order. When no sentinel is present the fixture
SHALL fall back to the `FAUX_SCRIPT` env scenario, preserving the existing
server-Vitest and VM-smoke behaviour. Per-session isolation SHALL rely on each
session being its own `pi --mode rpc` process (own extension instance + faux
state); no cross-session coordinator SHALL be introduced.

#### Scenario: Sentinel selects the scenario

- **WHEN** a prompt containing `[[faux:tool-read]]` is sent to a faux-backed session
- **THEN** the faux stream SHALL emit the `tool-read` scenario's scripted events

#### Scenario: No sentinel falls back to FAUX_SCRIPT

- **WHEN** a prompt with no `[[faux:…]]` sentinel is sent
- **THEN** the fixture SHALL serve the scenario named by the `FAUX_SCRIPT` env (existing default behaviour), and the existing server-Vitest + `qa/tests/10-faux-model.sh` SHALL remain green

#### Scenario: Concurrent sessions stay independent

- **WHEN** two faux-backed sessions receive prompts with different sentinels
- **THEN** each SHALL stream its own scenario, because each runs in its own pi process with its own faux state

### Requirement: Faux-backed model round-trip scenario specs

The suite SHALL include browser scenario specs that send a sentinel prompt
through the UI composer and assert the scripted assistant response renders in the
DOM — proving the `prompt → faux model → bridge → /ws → renderer` round-trip
without an LLM credential. Specs SHALL select on existing app `data-testid`s and
SHALL be idempotent with respect to shared-container state.

#### Scenario: Plain text round-trip renders

- **WHEN** a spec sends `[[faux:plain-text]]` through the composer of a spawned session
- **THEN** the scripted assistant text (`PLAIN_TEXT_MARKER`) SHALL become visible in the rendered message DOM

#### Scenario: Tool-call renderer round-trip

- **WHEN** a spec sends `[[faux:tool-read]]`
- **THEN** the `read` tool renderer SHALL mount, proving a faux tool-call streamed and rendered

#### Scenario: Interactive ask_user round-trip

- **WHEN** a spec sends `[[faux:ask-select]]`
- **THEN** the interactive select widget SHALL mount, proving a faux `ask_user` tool-call streamed and rendered

### Requirement: Browser availability is verified before the container boots
Playwright `globalSetup` SHALL verify that the Chromium browser binary required by the installed Playwright version is present **before** it spins up or health-checks the Docker test harness. The check SHALL resolve the executable via the `@playwright/test` module (not the `node_modules/.bin/playwright` shim), so a missing bin symlink SHALL NOT block the suite.

When the browser is missing, `globalSetup` SHALL fail fast with a non-zero exit and a message that (a) names the exact remediation command `npx playwright install chromium` and (b) references change `self-heal-host-playwright-browser`. The Docker container SHALL NOT be booted in this case.

#### Scenario: Missing browser fails before container boot
- **WHEN** a developer runs the suite via a direct path (`npx playwright test`, UI mode, or `PW_E2E_USE_RUNNING=1`) and the Chromium binary is absent
- **THEN** globalSetup SHALL exit non-zero within seconds, before `docker/test-up.sh` is spawned
- **AND** the error message SHALL contain `npx playwright install chromium`
- **AND** no Docker container SHALL be started

#### Scenario: Present browser proceeds to lifecycle
- **WHEN** the Chromium binary is present
- **THEN** the preflight SHALL pass silently
- **AND** globalSetup SHALL proceed to the existing managed-boot or `PW_E2E_USE_RUNNING` health-check path unchanged

### Requirement: npm path self-installs the browser
The `package.json` SHALL provide `pretest:e2e` and `pretest:e2e:ui` scripts that run `playwright install chromium`, so the browser is installed automatically before the corresponding `test:e2e` / `test:e2e:ui` scripts run. When the browser is already present the hook SHALL be a fast no-op and SHALL NOT re-download.

The manual `npx playwright install chromium` step in `tests/e2e/README.md` SHALL be demoted from a required prerequisite to a fallback note.

#### Scenario: First run on a fresh host self-heals
- **WHEN** a developer with no installed Chromium runs `npm run test:e2e`
- **THEN** the `pretest:e2e` hook SHALL install Chromium first
- **AND** the suite SHALL then run without a manual prerequisite step

#### Scenario: Warm run does not re-download
- **WHEN** Chromium is already installed and `npm run test:e2e` runs
- **THEN** the `pretest:e2e` hook SHALL complete as a no-op without downloading a browser

### Requirement: Playwright version is pinned for deterministic browser revision
The root `@playwright/test` dependency SHALL be pinned to an exact version (no `^`/`~` range) so the required Chromium revision is deterministic and transitive minor bumps SHALL NOT silently change it or trigger an unrequested browser download. Upgrading Playwright SHALL be an explicit dependency change.

#### Scenario: Transitive bump does not move the browser revision
- **WHEN** dependencies are reinstalled without an explicit Playwright version change
- **THEN** the resolved `@playwright/test` version SHALL be unchanged
- **AND** no new Chromium revision SHALL be required or downloaded

