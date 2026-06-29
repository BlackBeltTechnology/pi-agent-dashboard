# playwright-e2e-qa — delta

## ADDED Requirements

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
