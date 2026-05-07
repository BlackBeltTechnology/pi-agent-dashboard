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

#### Scenario: Docker unavailable — graceful fallback
- **WHEN** `openspec-propose` is invoked and Docker is NOT available (`docker info` exits non-zero)
- **THEN** the skill SHALL emit the notice "Design sandbox unavailable (Docker not found). Proceeding with text-only proposal."
- **AND** the skill SHALL skip the Design Phase entirely
- **AND** the skill SHALL proceed with text-only proposal generation (today's behavior)
- **AND** the skill SHALL NOT return an error

#### Scenario: Docker available but sandbox fails to start
- **WHEN** Docker is available but `docker compose up` fails (port conflict, build error, health check timeout)
- **THEN** the skill SHALL emit a warning: "Design sandbox failed to start: <error message>. Proceeding with text-only proposal."
- **AND** the skill SHALL attempt `docker compose down` to clean up partial state
- **AND** the skill SHALL proceed with text-only proposal generation

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
