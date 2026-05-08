## ADDED Requirements

### Requirement: Optional Docker-gated Design Phase in openspec-propose
The `openspec-propose` skill SHALL include an optional Design Phase between spec creation and task creation, gated on Docker availability.

#### Scenario: Docker available — full design phase executes
- **WHEN** `openspec-propose` is invoked for a UI change and Docker is available (`docker info` exits 0)
- **THEN** the skill SHALL:
  1. Start the Docker sandbox (`docker compose -f sandbox/docker-compose.yml up -d --wait`)
  2. Derive browser scenarios from user stories in the proposal
  3. Write the scenario file to `<change-dir>/screenshots/scenario.json`
  4. Run `browser-visual-debug --sandbox --scenario <change-dir>/screenshots/scenario.json`
  5. Invoke the `sandbox-designer` agent with user story + before-screenshots → `<change-dir>/mockup.html`
  6. Tear down the sandbox (`docker compose -f sandbox/docker-compose.yml down`)
  7. Reference `mockup.html` in the generated `design.md`

#### Scenario: Docker unavailable — hard stop
- **WHEN** `openspec-propose` is invoked for a UI change and Docker is NOT available (`docker info` exits non-zero)
- **THEN** the skill SHALL emit the error "Design sandbox unavailable (Docker not found). Cannot proceed with UI change."
- **AND** the skill SHALL instruct the user to install Docker and retry
- **AND** the skill SHALL NOT proceed with text-only proposal generation
- **AND** the skill SHALL NOT return success

#### Scenario: Docker available but sandbox fails to start — hard stop with retry
- **WHEN** Docker is available but `docker compose up` fails (port conflict, build error, health check timeout)
- **THEN** the skill SHALL emit a warning: "Design sandbox failed to start: <error message>."
- **AND** the skill SHALL attempt `docker compose down --volumes` to clean up partial state
- **AND** the skill SHALL retry once with `docker compose up -d --build --wait dashboard`
- **AND** if retry also fails, the skill SHALL report the error and STOP — do NOT proceed without sandbox

#### Scenario: Sandbox teardown guarantee
- **WHEN** the Design Phase completes OR fails at any step after `docker compose up`
- **THEN** the skill SHALL always attempt `docker compose down` before proceeding to the next phase
- **AND** a teardown failure SHALL emit a warning but SHALL NOT block the proposal workflow

### Requirement: Scenario derivation from user stories
The `openspec-propose` skill SHALL derive browser scenarios from user stories in the proposal by identifying which dashboard pages and UI states the change affects.

#### Scenario: Scenario file is valid JSON
- **WHEN** the skill writes `<change-dir>/screenshots/scenario.json`
- **THEN** the file SHALL be valid JSON parseable by `JSON.parse`
- **AND** the file SHALL contain an array of step objects
- **AND** each step SHALL have an `action` field matching the scenario vocabulary (`open`, `click`, `fill`, `type`, `select`, `press`, `wait`, `screenshot`, `scroll`, `snapshot`)
- **AND** `screenshot` steps SHALL have a `name` field

### Requirement: Screenshot capture always via Docker sandbox
All screenshot capture for design review (BEFORE, AFTER, mockup) SHALL use the Docker sandbox exclusively. Local agent-browser SHALL NOT be used for design review screenshots.

#### Scenario: Propose phase captures screenshots via sandbox
- **WHEN** `openspec-propose` executes the Design Phase
- **THEN** the skill SHALL capture BEFORE screenshots via `sandbox/scripts/capture-screenshots.sh`
- **AND** the skill SHALL capture mockup screenshot via Docker sandbox
- **AND** the skill SHALL NOT use local `agent-browser` for any screenshot capture

#### Scenario: Apply phase captures AFTER screenshots via sandbox
- **WHEN** `openspec-apply-change` captures AFTER screenshots during the review loop
- **THEN** the agent SHALL use `sandbox/scripts/capture-screenshots.sh` with `--build` in the compose command
- **AND** the agent SHALL NOT use local `agent-browser` or browser tool for screenshot capture

#### Scenario: Sandbox-designer skill correctly documents screenshot source
- **WHEN** reading `sandbox-designer/SKILL.md` Design Review Loop section
- **THEN** step 1 SHALL say: "Capture AFTER screenshots via Docker sandbox (`sandbox/scripts/capture-screenshots.sh` with `--build`)"
- **AND** the section SHALL NOT contain "NOT docker sandbox" or "agent-browser"
- **AND** the section SHALL be consistent with `openspec-apply-change/SKILL.md` step 3
