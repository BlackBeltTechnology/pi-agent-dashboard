## ADDED Requirements

### Requirement: Designer uses contact_supervisor for progress reporting
The sandbox-designer subagent SHALL use `contact_supervisor` to report progress and findings to the supervisor agent during the review loop.

#### Scenario: Designer reports review completion
- **WHEN** the sandbox-designer completes a comparison of AFTER screenshots against mockup.html
- **THEN** the designer SHALL call `contact_supervisor({ reason: "progress_update", message: "<findings>" })`
- **AND** the message SHALL include: number of issues found, list of issues with severity (critical/major/minor)
- **AND** the message SHALL include `runId` for context
- **AND** the designer SHALL NOT use `intercom()` directly

#### Scenario: Designer reports NO_ISSUES
- **WHEN** the sandbox-designer finds zero differences between AFTER screenshots and mockup
- **THEN** the designer SHALL call `contact_supervisor({ reason: "progress_update", message: "NO_ISSUES: implementation matches mockup" })`
- **AND** the supervisor SHALL interpret "NO_ISSUES" as the signal to exit the review loop

#### Scenario: Designer reports minimal findings
- **WHEN** the sandbox-designer finds only minor cosmetic issues (e.g., padding off by 1-2px)
- **THEN** the designer SHALL call `contact_supervisor({ reason: "progress_update", message: "<findings with severity: minor>" })`
- **AND** the designer SHALL note that issues are minor and may be acceptable

### Requirement: Designer uses contact_supervisor for decisions
The sandbox-designer SHALL escalate ambiguous findings to the supervisor via `need_decision`.

#### Scenario: Designer cannot determine if difference is intentional
- **WHEN** the sandbox-designer finds a visual difference but cannot determine if it is a bug or intentional deviation
- **THEN** the designer SHALL call `contact_supervisor({ reason: "need_decision", message: "<description of ambiguity>" })`
- **AND** the designer SHALL include both BEFORE and AFTER descriptions of the ambiguous element
- **AND** the designer SHALL wait for the supervisor's reply before continuing

#### Scenario: Designer receives supervisor decision
- **WHEN** the supervisor replies to a `need_decision` escalation
- **THEN** the designer SHALL read the reply and use it to classify the finding
- **AND** if the supervisor says "intentional", the designer SHALL NOT include it in the issue list
- **AND** if the supervisor says "fix", the designer SHALL include it as a finding

### Requirement: Designer message format
All `contact_supervisor` messages from the sandbox-designer SHALL follow a consistent format.

#### Scenario: Progress update message format
- **WHEN** the designer sends a progress update
- **THEN** the message SHALL include a header with runId: `[designer:<runId>]`
- **AND** the message SHALL include a findings count: `Found N issue(s)`
- **AND** each finding SHALL be a bullet with: severity tag `[CRITICAL]`/`[MAJOR]`/`[MINOR]`, element identifier, expected value (from mockup), actual value (from AFTER), and action required

#### Scenario: Decision request message format
- **WHEN** the designer sends a need_decision escalation
- **THEN** the message SHALL include: runId, description of the ambiguity, mockup expectation, AFTER screenshot observation
- **AND** the message SHALL end with a clear question the supervisor can answer

### Requirement: Designer reads files from task text only
The sandbox-designer SHALL receive all file paths in the `task` text string, not via the `reads` parameter.

#### Scenario: Screenshots and documents passed in task text
- **WHEN** the supervisor invokes the sandbox-designer
- **THEN** the `task` parameter SHALL contain absolute paths to: BEFORE screenshots, mockup.html, proposal.md, design.md, all spec files
- **AND** the `reads` parameter SHALL be omitted or empty
- **AND** the designer SHALL use the `read` tool to load each file

#### Scenario: Designer validates screenshots loaded correctly
- **WHEN** the sandbox-designer reads screenshot files
- **THEN** the designer SHALL describe the screenshots in its first message to confirm they loaded
- **AND** if screenshots fail to load, the designer SHALL stop immediately and report the error via `contact_supervisor`

### Requirement: Designer reviews only via Docker sandbox screenshots
The sandbox-designer SHALL review AFTER screenshots captured from the Docker sandbox, never from local agent-browser.

#### Scenario: Designer receives sandbox-captured screenshots
- **WHEN** the supervisor sends AFTER screenshots to the designer
- **THEN** the screenshots SHALL have been captured via `sandbox/scripts/capture-screenshots.sh`
- **AND** the supervisor SHALL verify the Docker image was rebuilt with `--build` before capture
- **AND** the supervisor SHALL NOT send screenshots captured via local `agent-browser`

#### Scenario: Designer rejects non-sandbox screenshots
- **WHEN** the designer detects that AFTER screenshots were captured via local agent-browser (e.g., URL is `http://localhost:8000` but no sandbox indicator)
- **THEN** the designer SHALL report via `contact_supervisor`: "ERROR: screenshots not from sandbox — may show stale code"
- **AND** the designer SHALL refuse to proceed with review
