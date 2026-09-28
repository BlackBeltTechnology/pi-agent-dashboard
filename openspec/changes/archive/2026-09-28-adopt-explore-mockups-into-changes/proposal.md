## Why

Explore-mode mockups land in root `mockups/` because no change exists yet
(`mockups/openspec-compact-states/` row: "No change yet."). Nothing moves them when
the change is later created: `compact-openspec-lifecycle-bar` planned, shipped and
archived while its mockup stayed at root `mockups/openspec-compact-states/` with the
stale "No change yet." row; `promote-model-roles-settings` only got its mockup by a
manual move; the root
`session-card-sections/` row points at a change path that no longer exists after
archive. `plan-proposal` Step 4 commits only `proposal/design/specs/tasks/test-plan`,
so a change's `mockups/` is not guaranteed to reach the worktree `ship-it` builds in.
Separately, generated `openspec-propose`/`-ff` end with "Run `/opsx-apply`"
(`/opsx:apply` in openspec 1.11 templates), bypassing `plan-proposal`
(doubt-review + scenario-design).

## What Changes

- **Pending-change marker.** A mockup made before its change exists gets a
  `mockups/AGENTS.md` row whose Purpose cell ends `Pending change: <intent>`
  (replaces the free-text "No change yet." suffix). Rows without the marker
  (repros, `site/` labs, rows already carrying `See change:`) are never offered.
- **`openspec/config.yaml` rules** (survive `openspec update`; injected by
  `openspec instructions` for every caller):
  - `rules.proposal` — when the agent is about to write a new `proposal.md`, if
    any `Pending change` rows exist, `ask_user` (multiselect) which to adopt; move
    each into `<changeDir>/mockups/`, then repair relative links, drop its row, and
    add a `Mockup:` line to `proposal.md`.
  - `rules.tasks` — right after a new `tasks.md`, unless the drafting request says
    `plan-proposal` is driving, `ask_user` (confirm) whether to run
    `plan-proposal` instead of suggesting apply.
  - Both skip silently when `ask_user` is unavailable (subagent/headless); the
    final report lists pending rows instead.
- **`plan-proposal` skill:** Step 1 tells drafting sub-skills "plan-proposal is
  driving this change"; Step 1b "Adopt pending mockups" (idempotent backstop for
  direct entry, `-continue`, re-runs; skips rows declined this session) before
  doubt-review; Step 4 commits the change's `mockups/**`.
- **Row fix:** `mockups/openspec-compact-states/` row "No change yet." →
  `See change: compact-openspec-lifecycle-bar` (change is archived; archives are
  immutable, so the mockup stays at root).

Spike in a throwaway repo (pi 0.87.1, openspec 1.11.0): `rules.proposal` fired a
multiselect naming only the marked mockup before `proposal.md` was written (`ff`);
`rules.tasks` fired the plan-proposal confirm instead of apply (`continue`). Not yet
observed: `rules.tasks` at the end of a full `ff` run (QA task 5.1).

## Capabilities

### New Capabilities
- `explore-mockup-adoption`: lifecycle of pre-change mockups — the `Pending change`
  marker, adoption into a change when its proposal is created, and the
  `config.yaml` handoff to `plan-proposal`.

### Modified Capabilities
- `plan-proposal-orchestrator`: adds the Step 1b adopt-mockups step and includes
  the change's `mockups/**` in the planning commit.

## Impact

- `openspec/config.yaml` (new `rules:` block) — affects every future change
  creation in this repo.
- `.pi/skills/plan-proposal/SKILL.md`, `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`,
  their rows in `.pi/skills/AGENTS.md`.
- `mockups/AGENTS.md` (header convention, migrated/removed rows).
- No code, no runtime, no migration. Rollback = revert the commit; nothing is moved
  by this change itself.

## Discipline Skills

- `doubt-driven-review` — `config.yaml` rules change the process for every future
  change creation; stress-tested before landing (run by `plan-proposal` Step 2).
- No others apply: no auth/secrets/untrusted network input, no latency budget, no
  endpoint/job/external call.
