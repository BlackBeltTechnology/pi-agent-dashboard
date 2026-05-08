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

### Requirement: Capture script rebuilds Docker image
The `sandbox/scripts/capture-screenshots.sh` script SHALL force a Docker image rebuild before starting the sandbox.

#### Scenario: Capture script includes --build flag
- **WHEN** `capture-screenshots.sh` is executed
- **THEN** the script SHALL invoke `docker compose -f sandbox/docker-compose.yml up -d --build --wait 2>&1`
- **AND** the `--build` flag SHALL ensure the Docker image is rebuilt from the current worktree context
- **AND** the script SHALL NOT use `docker compose up` without `--build`

#### Scenario: Rebuild picks up worktree code changes
- **WHEN** the agent has modified source files in the worktree since the last sandbox run
- **AND** `capture-screenshots.sh` is executed
- **THEN** the rebuilt Docker image SHALL contain the latest source code from the worktree
- **AND** the `RUN npm run build` layer in the Dockerfile SHALL execute against the latest source
- **AND** screenshots captured from the rebuilt container SHALL reflect the latest code

### Requirement: Capture script documents rebuild behavior
The `sandbox-designer/SKILL.md` Docker Sandbox Setup section SHALL document that `capture-screenshots.sh` always rebuilds.

#### Scenario: Skill documents rebuild guarantee
- **WHEN** reading the Docker Sandbox Setup section of `sandbox-designer/SKILL.md`
- **THEN** the section SHALL state: "`capture-screenshots.sh` always passes `--build` to `docker compose up` — the image is rebuilt from the current worktree on every invocation"
- **AND** the section SHALL note the tradeoff: rebuild adds 30-90 seconds per capture round
