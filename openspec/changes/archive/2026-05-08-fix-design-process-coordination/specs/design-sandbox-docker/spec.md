## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Capture script documents rebuild behavior
The `sandbox-designer/SKILL.md` Docker Sandbox Setup section SHALL document that `capture-screenshots.sh` always rebuilds.

#### Scenario: Skill documents rebuild guarantee
- **WHEN** reading the Docker Sandbox Setup section of `sandbox-designer/SKILL.md`
- **THEN** the section SHALL state: "`capture-screenshots.sh` always passes `--build` to `docker compose up` — the image is rebuilt from the current worktree on every invocation"
- **AND** the section SHALL note the tradeoff: rebuild adds 30-90 seconds per capture round
