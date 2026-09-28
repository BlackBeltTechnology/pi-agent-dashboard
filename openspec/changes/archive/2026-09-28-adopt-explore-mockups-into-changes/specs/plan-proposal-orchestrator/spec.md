## ADDED Requirements

### Requirement: Adopt pending mockups before doubt-review
When drafting via `openspec-new-change`/`-ff`/`-continue`, `plan-proposal` SHALL
state "plan-proposal is driving this change" in its request. After planning
artifacts exist and before `doubt-driven-review`, it SHALL offer every
`Pending change` row in `mockups/AGENTS.md` not already declined in the session via
one `ask_user` multiselect and adopt each chosen entry using the mechanics defined
by the `explore-mockup-adoption` adoption requirement. The step SHALL be
idempotent: with no offerable rows it asks nothing and changes nothing.

#### Scenario: Pending mockup adopted
- **WHEN** `plan-proposal` runs and a `Pending change` row exists that the user selects
- **THEN** the entry is moved into the change and referenced from `proposal.md` before doubt-review runs

#### Scenario: Already adopted
- **WHEN** the mockup was adopted earlier (e.g. by the `config.yaml` proposal rule) so no marked row remains
- **THEN** the step asks nothing and changes nothing

#### Scenario: Pending mockup declined
- **WHEN** the user selects none of the offered rows
- **THEN** nothing moves, the rows stay marked, and they are not re-offered in the same session

## MODIFIED Requirements

### Requirement: Stop at the worktree boundary

After the planning artifacts — `proposal.md`, `design.md`, `specs/**`, `tasks.md`,
`test-plan.md`, and, when mockups were adopted, the change's `mockups/**` plus the
adoption's root-side edits (`mockups/AGENTS.md`, renamed-away sources) — are
committed to
`develop`, `plan-proposal` SHALL stop at the point a worktree is spawned from that
commit, handing control to a human checkpoint. It SHALL NOT continue into the
implementation phase itself.

#### Scenario: Planning complete
- **WHEN** proposal, design, specs, tasks, test-plan, and any change mockups are committed and the worktree is created
- **THEN** `plan-proposal` reports readiness and stops, instructing the user to run `ship-it` inside the worktree
