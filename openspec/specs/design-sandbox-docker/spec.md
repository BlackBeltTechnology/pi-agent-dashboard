## ADDED Requirements

### Requirement: Two-service Docker sandbox composition
The system SHALL provide a Docker-based sandbox using `docker-compose` with two services: a `dashboard` service running `pi-dashboard --dev` on port 8000, and a `browser` service running headless Chromium with Chrome DevTools Protocol on port 9222.

#### Scenario: Sandbox starts successfully
- **WHEN** `docker compose -f sandbox/docker-compose.yml up -d --wait` is executed
- **THEN** the `dashboard` service SHALL pass its health check (`GET /api/health` returns 200) within 30 seconds
- **AND** the `browser` service SHALL expose port 9222 and respond to CDP requests (`GET http://localhost:9222/json/version` returns JSON with a `Browser` field)
- **AND** both services SHALL be on a shared Docker network so the browser can reach the dashboard at `http://dashboard:8000`

#### Scenario: Dashboard service uses seed data
- **WHEN** the `dashboard` service starts
- **THEN** it SHALL read session data from the seed volume mounted at `~/.pi/agent/sessions/`
- **AND** session data SHALL be mounted read-only (`:ro`) to prevent accidental mutation of committed seed files

#### Scenario: Sandbox teardown
- **WHEN** `docker compose -f sandbox/docker-compose.yml down` is executed
- **THEN** both containers SHALL be stopped and removed
- **AND** no orphan containers or networks SHALL remain

### Requirement: Sandbox Dockerfile
The sandbox SHALL include a `sandbox/Dockerfile` that builds a dashboard-only image.

#### Scenario: Dockerfile builds successfully
- **WHEN** `docker compose -f sandbox/docker-compose.yml build` is executed from the repo root
- **THEN** the build SHALL complete without errors
- **AND** the resulting image SHALL contain `pi`, `openspec`, dashboard npm dependencies, and dashboard source code

#### Scenario: Dockerfile layers are cacheable
- **WHEN** the dashboard source code changes but `package.json` does not
- **THEN** the `npm ci` layer SHALL be served from Docker's build cache
- **AND** only the `COPY . /app` layer SHALL be rebuilt

### Requirement: Dashboard entrypoint
The `dashboard` service SHALL use `sandbox/entrypoint.sh` as its entrypoint.

#### Scenario: Entrypoint waits for health
- **WHEN** the `dashboard` container starts
- **THEN** `entrypoint.sh` SHALL start `pi-dashboard --dev` in the background
- **AND** SHALL poll `http://localhost:8000/api/health` every 1 second
- **AND** SHALL timeout after 30 seconds if health never returns 200, exiting with code 1
- **AND** on success, SHALL tail dashboard logs to keep the container alive
