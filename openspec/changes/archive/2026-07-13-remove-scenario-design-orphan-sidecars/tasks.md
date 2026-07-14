# Tasks

## 1. Remove orphan sidecars

- [x] 1.1 `git rm packages/eng-disciplines/.pi/skills/scenario-design/SKILL.md.AGENTS.md packages/eng-disciplines/.pi/skills/scenario-design/references/technique-cheatsheet.md.AGENTS.md packages/eng-disciplines/.pi/skills/scenario-design/references/test-plan-schema.md.AGENTS.md`.
- [x] 1.2 Confirm no `*.AGENTS.md` sidecars remain under the scenario-design dir; only `SKILL.md` + `references/{technique-cheatsheet,test-plan-schema}.md` stay.

## 2. Verify

- [x] 2.1 Confirm `packages/eng-disciplines/AGENTS.md` still carries the 3 inline scenario-design rows (no `→ see` pointer to a deleted sidecar).
- [x] 2.2 `npm pack --dry-run -w @blackbelt-technology/pi-dashboard-eng-disciplines` no longer lists the 3 sidecars; SKILL.md + 2 references still present.
- [x] 2.3 `openspec validate remove-scenario-design-orphan-sidecars` passes.
