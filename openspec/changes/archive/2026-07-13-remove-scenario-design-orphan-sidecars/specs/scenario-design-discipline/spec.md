## MODIFIED Requirements

### Requirement: scenario-design ships inside the published eng-disciplines package

The `scenario-design` skill SHALL live under `packages/eng-disciplines/.pi/skills/scenario-design/` and SHALL be registered in that package's `pi.skills[]` manifest so any pi session that loads `@blackbelt-technology/pi-dashboard-eng-disciplines` discovers it by natural-language trigger. The skill directory SHALL contain only its canonical files (`SKILL.md` + `references/*.md`) and SHALL NOT carry orphan per-file `*.AGENTS.md` doc sidecars — its DOX detail lives inline in `packages/eng-disciplines/AGENTS.md`, matching the package's 8 sibling skills.

#### Scenario: eng-disciplines session discovers scenario-design

- **WHEN** a pi session loads the eng-disciplines package
- **THEN** `scenario-design` appears in the available-skills list
- **AND** its NL triggers ("design test scenarios", "find edge cases", "is this spec testable") load the full SKILL.md body
- **AND** the skill count registered in `pi.skills[]` is 9 (previous 8 + scenario-design)

#### Scenario: exactly one source of the skill exists

- **WHEN** an auditor greps the repo for `scenario-design/SKILL.md`
- **THEN** the only match is under `packages/eng-disciplines/.pi/skills/`
- **AND** no copy remains under the root `.pi/skills/`

#### Scenario: no orphan doc sidecars in the package

- **WHEN** an auditor lists `*.AGENTS.md` files under `packages/eng-disciplines/.pi/skills/scenario-design/`
- **THEN** none exist
- **AND** `packages/eng-disciplines/AGENTS.md` still carries the inline DOX rows for `scenario-design/SKILL.md` and its two `references/*.md` files, with no `→ see <sidecar>` pointer
- **AND** `npm pack --dry-run` for the package does not list any `scenario-design/*.AGENTS.md` file
