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

