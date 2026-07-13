## ADDED Requirements

### Requirement: scenario-design ships inside the published eng-disciplines package

The `scenario-design` skill SHALL live under `packages/eng-disciplines/.pi/skills/scenario-design/` and SHALL be registered in that package's `pi.skills[]` manifest so any pi session that loads `@blackbelt-technology/pi-dashboard-eng-disciplines` discovers it by natural-language trigger.

#### Scenario: eng-disciplines session discovers scenario-design

- **WHEN** a pi session loads the eng-disciplines package
- **THEN** `scenario-design` appears in the available-skills list
- **AND** its NL triggers ("design test scenarios", "find edge cases", "is this spec testable") load the full SKILL.md body
- **AND** the skill count registered in `pi.skills[]` is 9 (previous 8 + scenario-design)

#### Scenario: exactly one source of the skill exists

- **WHEN** an auditor greps the repo for `scenario-design/SKILL.md`
- **THEN** the only match is under `packages/eng-disciplines/.pi/skills/`
- **AND** no copy remains under the root `.pi/skills/`

### Requirement: Test-level routing is project-parameterized, not dashboard-hardcoded

The skill's routing step SHALL instruct the agent to map each scenario's nature to the *host project's* test levels, rather than hardcoding `unit / qa VM smoke / Playwright e2e`. The dashboard-specific levels MAY appear only as a clearly-marked example.

#### Scenario: generic project with different test levels

- **WHEN** the skill runs in a project whose levels are e.g. `jest unit` + `cypress e2e` (no qa VM smoke tier)
- **THEN** the routing step asks the agent to place each scenario at one of that project's actual levels
- **AND** the skill does not assert that a `qa/` smoke tier or a Playwright `:18000` harness exists

#### Scenario: dashboard behaviour preserved via example callout

- **WHEN** the skill runs inside pi-agent-dashboard
- **THEN** an "Example: pi-agent-dashboard levels" callout reproduces the prior `unit / qa VM smoke / Playwright e2e` routing table verbatim in intent
- **AND** the AGENTS.md hard rule (rendered-UI asserts are Playwright only; qa/ stays CLI/process smoke) is still honoured for this repo

### Requirement: Output target and compatibility are decoupled from OpenSpec

The skill SHALL treat the test-plan output location as a parameter ("write to your change/spec's test-plan location") rather than hardcoding `openspec/changes/<name>/test-plan.md`, and its `compatibility` metadata SHALL describe OpenSpec input as optional rather than required.

#### Scenario: non-OpenSpec project uses the skill

- **WHEN** the skill runs in a project with no `openspec/` directory
- **THEN** it still produces a scenario catalog and asks where to write it
- **AND** it does not fail or block on a missing `openspec` CLI

#### Scenario: portable core is unchanged

- **WHEN** comparing the moved skill to the original
- **THEN** the Triple (`input · trigger · observable`), the ISTQB technique cheatsheet, the "scenario ≠ smoke" rule, and the STOP-and-ask clarification gate are preserved
- **AND** the guardrails (never invent a missing value; never write app/test code; offer, don't auto-fold) are preserved
