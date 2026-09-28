## Context

- `openspec instructions <artifact>` injects `config.yaml` `rules.<artifact>` for
  every caller: `openspec-propose`, `-ff`, `-continue` (write artifacts),
  `openspec-new-change` (reads first-artifact instructions, writes nothing),
  `openspec-update-change` (revises existing artifacts). All generated
  (`generatedBy`), overwritten by `openspec update`; `config.yaml` is not.
- Generated skills call rules "constraints"; the rules here ask for actions. The
  throwaway test showed the agent executes them.
- `plan-proposal` (project-owned) drafts via `new`/`ff`/`continue`, so its own
  drafting also receives the rules.
- Generic `frontend-mockup-loop` is a published, project-agnostic package; repo
  bindings live in the `frontend-mockup-loop-dashboard` adapter.
- `mockups/AGENTS.md` has rows for only 7 of ~26 entries; existing suffixes:
  `See change: <id>` (owned) and one `No change yet.`

## Goals / Non-Goals

**Goals:**
- Mockups made before a change end up inside it, moved not copied, when its
  proposal is created.
- Generated creation paths offer `plan-proposal` instead of apply.
- Change mockups reach the worktree.

**Non-Goals:**
- Auto-running `plan-proposal` (blocked by design — `docs/research/auto-trigger-plan-proposal.md`).
- Documenting or adopting the ~19 row-less mockups; only marked rows participate.
- Cleaning the stale root `session-card-sections/` duplicate (separate chore).
- `--store` changes (change lives in another repo; `git mv` cannot cross repos).
- Deterministic enforcement (extension hook / `check-conventions.mjs` gate) —
  follow-up only if skips are observed.

## Decisions

- **D1 — config rules, not generated-skill edits.** One place, survives
  `openspec update`. Rule text names apply generically (`/opsx-apply` or
  `/opsx:apply`) so the 1.11 rename does not break it.
- **D2 — marker = candidate set; user = matcher.** Every row whose Purpose cell
  ends with `Pending change: <intent>` (before the closing ` |`) is offered in one
  multiselect; the agent does not judge similarity. `<intent>` is a human hint
  only, free of `|` and backticks. Normally 0–3 rows, so the question stays short.
  The adoptable path is the backticked name in the row's File cell (first column),
  which MUST resolve to an existing entry directly under `mockups/` (directory or
  single file); anything else is skipped and reported.
- **D3 — adopt when `proposal.md` is created, before doubt-review.** The proposal
  is written with final paths, so reviewers and `scenario-design` can open the
  mockup from the change. Adopting at Step 4 would leave planning artifacts
  pointing at root paths.
- **D4 — always confirm via `ask_user`.** No silent moves. A row declined once in
  a session is not re-offered in that session (rule and Step 1b share this).
- **D5 — move, never copy; row removed.** The change's `proposal.md` reference
  becomes the record. Shared-mockup case dropped: a mockup already serving an
  existing change carries `See change:`, not the marker, so it is never offered.
- **D6 — move mechanics (canonical: the `explore-mockup-adoption` requirement).**
  Order: `mkdir -p <changeDir>/mockups` → if `<changeDir>/mockups/<entry>` already
  exists, fail (never move into it — `mv`/`git mv` would nest) → move (`git mv`
  when tracked, `mv` when untracked) → on success only: repair links, remove row,
  include the reference when writing `proposal.md`. A failed move leaves the row
  intact. The adoption edits outside the change (root `mockups/AGENTS.md`, the
  rename's source side) are committed with the planning artifacts. Relative links reaching outside the entry
  are recomputed against the new location (root `mockups/<slug>/` → five levels
  deep, i.e. +3 `../` per file; never a fixed count by assumption); verify by
  serving once. Reference format: a `Mockup: mockups/<entry> (in this change)` line
  in `proposal.md` What Changes.
- **D7 — trigger only when about to write, never on revision or preview.**
  `rules.proposal` acts only when the agent will write `proposal.md` in the same
  step and it does not yet exist; `rules.tasks` only right after `tasks.md` was
  newly written. `openspec-new-change` (shows instructions, writes nothing) and
  `openspec-update-change` (revises) stay inert.
- **D8 — explicit re-entrancy signal.** `plan-proposal` Step 1 states in its
  drafting request "plan-proposal is driving this change"; `rules.tasks` skips its
  confirm when that statement is present. `rules.proposal` may still fire inside
  Step 1 (one question); Step 1b then offers only rows not already declined.
- **D9 — interactive only.** If `ask_user` is unavailable (subagent, headless
  `-p`), both rules skip; the final report lists pending rows. Nothing moves
  unattended.
- **D10 — Step 1b is the backstop.** Covers direct `plan-proposal` entry,
  `-continue` on an existing proposal, re-runs, and `SHIP_IT_BLOCKED` hand-backs.
  Idempotent: nothing marked → nothing asked.

## Risks / Trade-offs

- [Prompt rules are advisory; an agent may skip them, esp. under `ff`] →
  `rules.proposal` has the Step 1b backstop; `rules.tasks` has none (the generated
  Output line may win) — QA 5.1 observes it; deterministic hook as follow-up.
- ["Declined this session" lives in conversation memory; lost after compaction]
  → worst case a declined row is offered again.
- [`rules.tasks` not yet observed at the end of a full `ff` run] → manual QA task.
- [Row removal drops the only DOX record of the mockup] → accepted; the proposal
  reference is the record and archives with the change.
- [Row-less mockups stay orphaned] → accepted non-goal.
- [Marker drift (`Pending Change:` casing, `|`/backticks in intent)] → adapter
  binding pins exact spelling and forbids both characters.
- [Changes ship while mockups sit at root — `compact-openspec-lifecycle-bar`
  archived mid-planning] → no retroactive move into archives; row gets
  `See change:` only.
- [Two sessions adopt the same row concurrently] → rare; the destination-exists
  check (D6) fails the second move and leaves the row intact.
- [Rollback of an untracked move] → `git revert` removes the moved copy but cannot
  restore an untracked source; tracked moves revert cleanly.
