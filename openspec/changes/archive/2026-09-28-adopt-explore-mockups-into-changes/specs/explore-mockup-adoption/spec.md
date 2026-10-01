## Purpose

Lifecycle of mockups created before their OpenSpec change exists: a marker on the
`mockups/AGENTS.md` row, adoption into the change when its proposal is created, and
the handoff from generated change-creation skills to `plan-proposal`.

## ADDED Requirements

### Requirement: Pending-change marker on pre-change mockups
A mockup created directly under root `mockups/` (directory `mockups/<slug>/` or file
`mockups/<name>.html`) while no OpenSpec change exists for it SHALL have a
`mockups/AGENTS.md` row whose File cell holds the backticked entry name and whose
Purpose cell ends (before the closing ` |`) with exactly `Pending change: <intent>`,
where `<intent>` is a short human hint containing no `|` and no backticks. Mockups
not intended for a change, and mockups already owned by a change (`See change:`),
SHALL NOT carry the marker.

#### Scenario: Explore-mode mockup without a change
- **WHEN** the dashboard mockup adapter writes a mockup and no matching change exists
- **THEN** the mockup lands under `mockups/` and its row ends with `Pending change: <intent>`

#### Scenario: Mockup for an existing change
- **WHEN** the change already exists
- **THEN** the mockup is written directly to `openspec/changes/<name>/mockups/` and no marker row is added

### Requirement: Adopt pending mockups when the proposal is created
`openspec/config.yaml` SHALL define `rules.proposal` instructing the agent, when it
is about to write `proposal.md` in the same step, `proposal.md` does not yet exist,
and `ask_user` is available, to offer every `Pending change` row not already
declined in the session in one `ask_user` multiselect. For each chosen entry, in
order, it SHALL `mkdir -p <changeDir>/mockups`, fail if `<changeDir>/mockups/<entry>`
already exists, move the entry there (`git mv` if tracked, `mv` otherwise), and only
after a successful move: recompute relative links that point outside the entry
against the new location, remove its row, and include a
`Mockup: mockups/<entry> (in this change)` line when writing `proposal.md`. A failed
move SHALL leave the row intact. Entries SHALL be moved, never copied. A row whose File-cell
path does not resolve to an existing entry directly under `mockups/` SHALL be
skipped and reported. This requirement is the canonical definition of the adoption
mechanics.

#### Scenario: Pending mockup chosen
- **WHEN** a proposal is created via `openspec-propose`, `-ff`, or `-continue` and `Pending change` rows exist
- **THEN** the agent asks one multiselect before writing `proposal.md`, and each chosen entry is moved into the change with its row removed and a reference in `proposal.md`

#### Scenario: Unmarked or owned mockups ignored
- **WHEN** `mockups/AGENTS.md` rows lack the marker or carry `See change:`
- **THEN** those entries are not offered

#### Scenario: Nothing pending
- **WHEN** no row carries the marker
- **THEN** no question is asked and the proposal is written normally

#### Scenario: Proposal revised or only previewed
- **WHEN** `proposal.md` already exists (e.g. `openspec-update-change`), or instructions are only shown without writing (`openspec-new-change`)
- **THEN** the rule takes no action

#### Scenario: Move fails
- **WHEN** the move of a chosen entry fails or is refused (destination already exists, source vanished)
- **THEN** its row stays in `mockups/AGENTS.md` and the failure is reported

#### Scenario: Non-interactive context
- **WHEN** `ask_user` is unavailable (subagent or headless run)
- **THEN** nothing is moved and the final report lists the pending rows

### Requirement: Offer plan-proposal after tasks
`openspec/config.yaml` SHALL define `rules.tasks` instructing the agent, right after
`tasks.md` is newly written, when `ask_user` is available and the drafting request
does not state that `plan-proposal` is driving this change, to not suggest apply (`/opsx-apply` or
`/opsx:apply`) and instead ask via `ask_user` (confirm) whether to run
`plan-proposal`; on yes it loads the `plan-proposal` skill.

#### Scenario: Tasks created outside plan-proposal
- **WHEN** `tasks.md` is created by `openspec-propose`, `-ff`, or `-continue` in a plain session
- **THEN** the agent asks "Run plan-proposal now?" instead of suggesting apply

#### Scenario: Tasks created by plan-proposal's own drafting
- **WHEN** `plan-proposal` Step 1 drafts `tasks.md` with a request stating "plan-proposal is driving this change"
- **THEN** no confirm is asked and `plan-proposal` continues to its next step

#### Scenario: Tasks revised
- **WHEN** `tasks.md` already exists
- **THEN** the rule takes no action
