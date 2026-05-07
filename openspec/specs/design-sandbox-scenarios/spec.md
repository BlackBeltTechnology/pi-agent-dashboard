## ADDED Requirements

### Requirement: Scenario-based browser automation
The system SHALL execute scenario-based browser automation driven by JSON step files, performing actions like opening URLs, clicking elements, filling inputs, and capturing screenshots.

#### Scenario: Scenario file is a valid JSON array
- **WHEN** a scenario file is read by the browser automation driver
- **THEN** the file SHALL parse as a JSON array
- **AND** each element SHALL be an object with a required `action` field
- **AND** an invalid JSON file SHALL produce an error message referencing the parse failure and file path

#### Scenario: Step vocabulary and parameter schemas
- **WHEN** the browser automation driver executes a step
- **THEN** the step's `action` SHALL be one of: `open`, `click`, `fill`, `type`, `select`, `press`, `wait`, `screenshot`, `scroll`, `snapshot`
- **AND** each action SHALL accept the following parameters:

| Action | Required params | Optional params | Description |
|---|---|---|---|
| `open` | `url` (string) | — | Navigate to URL |
| `click` | `selector` (string) | — | Click element matching selector |
| `fill` | `selector` (string), `value` (string) | — | Clear and type into input |
| `type` | `selector` (string), `value` (string) | — | Type without clearing |
| `select` | `selector` (string), `value` (string) | — | Select dropdown option |
| `press` | `key` (string) | — | Press keyboard key |
| `wait` | — | `condition` ("networkidle" \| "load"), `ms` (number) | Wait for condition or duration |
| `screenshot` | `name` (string) | `fullPage` (boolean, default false) | Capture screenshot to `screenshots/<name>.png` |
| `scroll` | `direction` ("up" \| "down" \| "left" \| "right") | `px` (number) | Scroll viewport |
| `snapshot` | — | `interactive` (boolean, default false) | Capture DOM snapshot with @ref handles |

#### Scenario: Unknown action produces clear error
- **WHEN** a step has an `action` not in the vocabulary
- **THEN** the driver SHALL halt execution
- **AND** SHALL emit an error message: "Unknown action '<action>' at step <index>. Valid actions: open, click, fill, type, select, press, wait, screenshot, scroll, snapshot"

#### Scenario: Missing required parameter produces error
- **WHEN** a step is missing a required parameter (e.g., `screenshot` step without `name`)
- **THEN** the driver SHALL halt execution
- **AND** SHALL emit an error message: "Missing required parameter '<param>' for action '<action>' at step <index>"

#### Scenario: Sequential halt-on-error execution
- **WHEN** a non-screenshot step fails (element not found, navigation timeout, invalid selector)
- **THEN** the driver SHALL halt execution and NOT proceed to subsequent steps
- **AND** SHALL emit an error message referencing the step index, action, and failure reason

#### Scenario: Wait timeout
- **WHEN** a `wait` step uses `ms` parameter
- **THEN** the driver SHALL wait for exactly the specified number of milliseconds
- **WHEN** a `wait` step uses `condition: "networkidle"` 
- **THEN** the driver SHALL wait until no network requests are in flight for ≥500ms
- **AND** SHALL timeout after 30 seconds, halting with an error

#### Scenario: Screenshot output
- **WHEN** a `screenshot` step executes
- **THEN** the driver SHALL write a PNG file to `screenshots/<name>.png` relative to the change directory
- **AND** if the `screenshots/` directory does not exist, the driver SHALL create it
- **AND** if the file cannot be written (permissions, disk full), the driver SHALL halt with an error
