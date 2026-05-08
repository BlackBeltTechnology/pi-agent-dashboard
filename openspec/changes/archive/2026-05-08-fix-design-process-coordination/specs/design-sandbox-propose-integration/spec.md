## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Local agent-browser for AFTER screenshots
**Reason**: Local agent-browser shows code from the main checkout, not from the worktree where changes are made. Screenshots captured locally are stale and mislead the review process.
**Migration**: All AFTER screenshot capture SHALL use Docker sandbox via `sandbox/scripts/capture-screenshots.sh` with `--build`.
