## MODIFIED Requirements

### Requirement: Stop at the worktree boundary

After the planning artifacts — `proposal.md`, `design.md`, `specs/**`, `tasks.md`,
`test-plan.md`, `dependencies.yaml` when the change has one, and, when mockups were adopted, the change's `mockups/**` plus the
adoption's root-side edits (`mockups/AGENTS.md`, renamed-away sources) — are
committed to
`develop`, `plan-proposal` SHALL stop at the point a worktree is spawned from that
commit, handing control to a human checkpoint. It SHALL NOT continue into the
implementation phase itself.

#### Scenario: Planning complete
- **WHEN** proposal, design, specs, tasks, test-plan, and any change mockups are committed and the worktree is created
- **THEN** `plan-proposal` reports readiness and stops, instructing the user to run `ship-it` inside the worktree

#### Scenario: Dependencies declaration is committed
- **GIVEN** a change on `pi-spec-driven` patch 2 with `dependencies.yaml`
- **WHEN** `plan-proposal` commits the planning artifacts
- **THEN** `dependencies.yaml` SHALL be part of that commit
