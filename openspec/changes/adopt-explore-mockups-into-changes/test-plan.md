# Test Plan — adopt-explore-mockups-into-changes

Stage: design   Generated: 2026-09-27

No clarifications outstanding: every Triple is filled from the delta specs and
design D1–D10. Split: static wiring (config, skill text, DOX marker format) is
deterministic → L1 vitest content guards (exemplar
`packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts`).
Whether an agent *obeys* the rules is LLM behaviour with no deterministic CI
signal → `manual-only`.

L1 home: one new file `packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts`.
Injection rows (W2) spawn the workspace `node_modules/.bin/openspec` inside a temp
dir holding a copy of `openspec/config.yaml` — never a real change name (changes
archive; the test must not depend on one).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| W1 | explore-mockup-adoption: Adopt / Offer plan-proposal (rule text) | EP | L1 | automated | repo `openspec/config.yaml` | parse YAML | `rules.proposal` and `rules.tasks` exist, one string each; proposal rule contains `Pending change`, `ask_user`, `multiselect`, `mockups/AGENTS.md`, `git mv`, `already exists`, `(in this change)`; tasks rule contains `plan-proposal is driving`, `/opsx-apply`, `/opsx:apply`, `confirm`; no other artifact key under `rules` |
| W2 | explore-mockup-adoption: rules reach every caller | decision-table | L1 | automated | temp dir: copied `config.yaml`, `openspec new change probe` | `openspec instructions <artifact> --change probe --json` for proposal / tasks / design / specs | proposal → `rules` has exactly the proposal rule; tasks → exactly the tasks rule; design and specs → `rules` absent or empty |
| W3 | plan-proposal-orchestrator: Adopt before doubt-review (ordering) | state-transition | L1 | automated | `.pi/skills/plan-proposal/SKILL.md` | extract `###` headings in order | sequence contains `1.` then `1b.` then `2.`; Step 1 body contains `plan-proposal is driving this change`; Step 1b body contains `Pending change`, `ask_user`, `declined` |
| W4 | plan-proposal-orchestrator: Stop at worktree boundary (commit set) | EP | L1 | automated | same SKILL.md | read Step 4 body | contains `test-plan.md`, `mockups/**`, and `mockups/AGENTS.md` |
| W5 | explore-mockup-adoption: marker binding in adapter | EP | L1 | automated | `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md` | read MOCKUP binding line | contains `Pending change:` and `openspec/changes/<name>/mockups/`; states intent excludes `\|` and backticks |
| W6 | explore-mockup-adoption: Pending-change marker format (repo invariant) | EP + BVA | L1 | automated | repo `mockups/AGENTS.md` rows | parse table rows | every row containing `Pending change:` → Purpose cell ends with `Pending change: <intent>` immediately before closing ` \|`; intent non-empty, no backtick; File cell backticked name resolves to an existing entry directly under `mockups/`; count of `No change yet` = 0 |
| W7 | explore-mockup-adoption: marker parser rejects drift | EP (invalid classes) | L1 | automated | fixture rows: (a) valid; (b) `Pending Change:` casing; (c) marker mid-cell followed by text; (d) intent with backtick; (e) File cell `../x`; (f) File cell names missing entry | run the W6 row check on each | (a) passes; (b)–(f) each reported with the row and reason |
| W8 | explore-mockup-adoption: convention documented | EP | L1 | automated | `mockups/AGENTS.md` header (text before the table) | read | contains `Pending change:` and states unmarked / `See change:` rows are never adopted |
| W9 | DOX closeout | EP | L1 | automated | `.pi/skills/AGENTS.md` | find rows for `plan-proposal/SKILL.md` and `frontend-mockup-loop-dashboard/SKILL.md` | each row contains `See change: adopt-explore-mockups-into-changes`; plan-proposal row still contains `See change: add-openspec-pipeline-orchestrators` |

### Performance

None — no runtime path.

### Frontend-quirk

None — no UI.

### Error-handling (agent behaviour — manual)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Adopt when proposal created + Offer plan-proposal (`ff`) | state-transition | — | manual-only | throwaway repo, one marked tracked mockup dir | `/skill:openspec-ff-change <new change>`; pick the mockup | multiselect appears before `proposal.md` exists; `git status` shows rename into `<change>/mockups/`; row gone; `proposal.md` has `Mockup: … (in this change)`; after `tasks.md`, confirm "Run plan-proposal now?" instead of an apply suggestion |
| M2 | plan-proposal Step 1b idempotent | state-transition | — | manual-only | change whose mockup was already adopted; no marked rows | run `plan-proposal` | no multiselect; no file moved; proceeds to doubt-review |
| M3 | Re-entrancy guard | state-transition | — | manual-only | no change dir; no marked rows | run `plan-proposal <new>` (drafts via `ff`) | no "Run plan-proposal now?" confirm during Step 1; continues to Step 1b/2 |
| M4 | Proposal revised or only previewed | decision-table | — | manual-only | marked row present; existing change | (a) `openspec-update-change` on its proposal; (b) `openspec-new-change <other>` | neither run shows the multiselect or moves anything |
| M5 | Move refused on existing destination | fault injection | — | manual-only | marked row `foo/`; `<change>/mockups/foo/` pre-created | adopt `foo` via `ff` | agent reports refusal; `mockups/foo/` unchanged; row still marked; no nested `mockups/foo/foo` |
| M6 | Non-interactive context | fault injection | — | manual-only | marked row present | `pi -p "/skill:openspec-ff-change …"` with no dashboard `ask_user` | nothing moved; final report lists the pending row |
| M7 | Declined not re-offered | state-transition | — | manual-only | marked row present; no change dir | `plan-proposal <new>`; decline in the rule's multiselect | Step 1b does not ask again in the same run; row stays marked |

---

## New infra needed

None. W2 uses the workspace `openspec` binary already in `node_modules/.bin`.
