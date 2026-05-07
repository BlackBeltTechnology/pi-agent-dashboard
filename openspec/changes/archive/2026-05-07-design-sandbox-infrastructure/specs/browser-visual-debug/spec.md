## MODIFIED Requirements

### Requirement: Sandbox mode for automated screenshot capture
The detect-dashboard script SHALL support a `--sandbox` flag. When `--sandbox` is set, the script SHALL output `DASHBOARD_URL=http://localhost:8000 MODE=sandbox` without probing any ports, and SHALL NOT attempt to detect a running dashboard or Vite instance.

#### Scenario: Sandbox mode returns fixed URL
- **WHEN** `detect-dashboard.sh --sandbox` is executed inside the Docker sandbox
- **THEN** the script outputs `DASHBOARD_URL=http://localhost:8000 MODE=sandbox` and exits 0

### Requirement: Scenario-file driven browser automation
The SKILL.md SHALL document a `--scenario <path>` mode for `--sandbox` operation. The scenario file is a JSON array of step objects with the vocabulary: `open`, `click`, `fill`, `type`, `select`, `press`, `wait`, `screenshot`, `scroll`, `snapshot`. Each `screenshot` step SHALL include a `name` field used as the output filename (`screenshots/<name>.png`).

#### Scenario: Scenario file execution
- **WHEN** `browser-visual-debug --sandbox --scenario scenarios.json` is invoked
- **THEN** the browser SHALL execute each step in order
- **AND** `screenshot` steps SHALL write PNG files to `screenshots/<name>.png`
- **AND** non-screenshot steps that fail SHALL halt execution with a clear error message referencing the step index and action

#### Scenario: Step vocabulary documented
- **WHEN** an agent reads the `--sandbox` section of SKILL.md
- **THEN** the section SHALL list all 10 step actions with their parameters and describe the execution contract (sequential, halt-on-error)
