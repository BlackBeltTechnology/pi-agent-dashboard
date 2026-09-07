## MODIFIED Requirements

### Requirement: Docker Compose base configuration

The `compose.yml` SHALL define a single default service `pi-dashboard` with: build context pointing to the project root, port mappings for dashboard (default 8000) and pi gateway (default 9999), named volumes for `pi-state` and `zrok-state`, tmpfs on `/tmp`, memory limits, and a healthcheck using `/api/health`. All ports and limits SHALL be configurable via environment variables with sensible defaults. Additional services SHALL be permitted only via opt-in compose overlay files that are not applied by default; a Kroki overlay SHALL add a `yuzutech/kroki` service reachable by `pi-dashboard` on the compose network, running in Kroki's safe/include-restricted mode, AND set the dashboard's Kroki endpoint env to that service in the same overlay — both sides wired atomically.

#### Scenario: Container starts with default configuration
- **WHEN** `docker compose up` is run with no `.env` file
- **THEN** the dashboard is accessible at `http://localhost:8000` and the pi gateway listens on port 9999
- **AND** no overlay-gated service (including Kroki) is started and no Kroki endpoint is configured

#### Scenario: Healthcheck detects running server
- **WHEN** the dashboard server is running inside the container
- **THEN** `docker compose ps` shows the service as healthy

#### Scenario: Named volumes persist across restarts
- **WHEN** the container is stopped and restarted
- **THEN** pi sessions, auth credentials, dashboard preferences, and zrok enrollment are preserved

#### Scenario: Kroki overlay enables local diagram rendering
- **WHEN** the stack is started with the Kroki overlay file applied
- **THEN** the Kroki service is reachable from `pi-dashboard` on the compose network and the dashboard resolves it as the diagram endpoint (via the overlay-set live environment override, not first-run config seeding)

#### Scenario: Kroki include fetching is restricted
- **WHEN** a diagram submitted through the overlay-enabled Kroki uses `!include`/`!includeurl` with an arbitrary URL
- **THEN** the Kroki service refuses to fetch it (safe mode), and the render fails cleanly rather than fetching network-internal resources
