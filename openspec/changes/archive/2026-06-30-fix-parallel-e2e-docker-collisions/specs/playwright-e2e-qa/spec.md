## MODIFIED Requirements

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
