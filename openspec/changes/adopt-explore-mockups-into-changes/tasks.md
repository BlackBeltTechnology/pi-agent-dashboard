## 1. Handoff rules

- [ ] 1.1 Add `rules.proposal` (only when about to write a new proposal.md, interactive-only, offer every undeclined `Pending change` row in one multiselect, mkdir → refuse if destination entry exists → `git mv`/`mv` → on success: recompute links, remove row, include `Mockup: … (in this change)` line when writing proposal.md; failed move keeps row; skip+report unresolvable rows) and `rules.tasks` (right after a new tasks.md, interactive-only, skip when the request says plan-proposal is driving, ask to run plan-proposal instead of `/opsx-apply`/`/opsx:apply`) to `openspec/config.yaml`. Verify: `openspec instructions proposal --change <any>` and `... tasks ...` each print their rule inside `<rules>`; `openspec instructions design` prints neither.

## 2. Mockup marker

- [ ] 2.1 `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md` MOCKUP binding: no change yet → `mockups/<slug>/` (or single `.html`) with a row whose Purpose cell ends exactly `Pending change: <intent>` before the closing ` |` (intent: no `|`, no backticks); change exists → `openspec/changes/<name>/mockups/`. Verify: `grep -n 'Pending change:' .pi/skills/frontend-mockup-loop-dashboard/SKILL.md` hits the binding.
- [ ] 2.2 `mockups/AGENTS.md` header: document the `Pending change:` convention (a mockup intended for a future change MUST have a marked row; unmarked and `See change:` rows are never adopted). Verify: `grep -n 'Pending change:' mockups/AGENTS.md` hits the header.
- [ ] 2.3 Update the `frontend-mockup-loop-dashboard` row in `.pi/skills/AGENTS.md` (marker binding) and add `See change: adopt-explore-mockups-into-changes` (row has none today). Verify: grep the change id in that row.

## 3. plan-proposal skill

- [ ] 3.1 In `.pi/skills/plan-proposal/SKILL.md`: Step 1 drafting request states "plan-proposal is driving this change"; add Step 1b "Adopt pending mockups" (idempotent, skips rows declined this session, before doubt-review, mechanics per the explore-mockup-adoption requirement) and a guardrail line. Verify: `grep -n 'plan-proposal is driving\|1b' .pi/skills/plan-proposal/SKILL.md` hits Step 1 and a Step 1b between Steps 1 and 2.
- [ ] 3.2 Step 4: add `openspec/changes/<change>/mockups/**` plus the adoption's root-side edits (`mockups/AGENTS.md`, renamed-away sources) to the committed set. Verify: grep `mockups/AGENTS.md` and `mockups/\*\*` in Step 4.
- [ ] 3.3 Update the `plan-proposal` row in `.pi/skills/AGENTS.md`, appending (not replacing) `See change: adopt-explore-mockups-into-changes`. Verify: the row carries both its old and the new `See change:`.

## 4. Row fix

- [ ] 4.1 In `mockups/AGENTS.md`, replace the `openspec-compact-states/` row's "No change yet." with `See change: compact-openspec-lifecycle-bar` (archived; mockup stays at root). Verify: `grep -c 'No change yet' mockups/AGENTS.md` = 0 and the row carries the `See change:`.

## 5. Tests (automated, L1 vitest)

- [ ] 5.1 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: repo openspec/config.yaml · parse YAML · rules.proposal and rules.tasks exist, one string each, carrying the required tokens (Pending change, ask_user, multiselect, mockups/AGENTS.md, git mv, already exists, (in this change) / plan-proposal is driving, /opsx-apply, /opsx:apply, confirm); no other rules key (test-plan #W1; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.2 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: temp dir with copied config.yaml and `openspec new change probe` · `openspec instructions <artifact> --change probe --json` for proposal/tasks/design/specs · proposal and tasks each get exactly their rule; design and specs get none (use workspace node_modules/.bin/openspec, never a real change name) (test-plan #W2; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.3 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: .pi/skills/plan-proposal/SKILL.md · extract ### headings in order · 1 → 1b → 2; Step 1 says "plan-proposal is driving this change"; Step 1b mentions Pending change, ask_user, declined (test-plan #W3; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.4 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: same SKILL.md · read Step 4 body · lists test-plan.md, mockups/**, mockups/AGENTS.md (test-plan #W4; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.5 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: .pi/skills/frontend-mockup-loop-dashboard/SKILL.md · read MOCKUP binding · contains Pending change: and openspec/changes/<name>/mockups/, and forbids | and backticks in intent (test-plan #W5; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.6 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: repo mockups/AGENTS.md rows · parse table · every Pending change row ends its Purpose cell with the marker before the closing pipe, intent non-empty without backtick, File-cell entry exists directly under mockups/; zero "No change yet" (test-plan #W6; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.7 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: fixture rows (valid; `Pending Change:` casing; marker mid-cell; backtick in intent; File cell ../x; missing entry) · run the W6 row check · valid passes, each invalid one reported with row + reason (test-plan #W7; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.8 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: mockups/AGENTS.md header · read text before the table · documents Pending change: and that unmarked / See change: rows are never adopted (test-plan #W8; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)
- [ ] 5.9 packages/shared/src/__tests__/explore-mockup-adoption-wiring.test.ts: .pi/skills/AGENTS.md · find plan-proposal and frontend-mockup-loop-dashboard rows · both carry See change: adopt-explore-mockups-into-changes; plan-proposal row keeps See change: add-openspec-pipeline-orchestrators (test-plan #W9; see packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts)

## 6. QA (manual)

- [ ] 6.1 throwaway repo with one marked tracked mockup dir · `/skill:openspec-ff-change <new>`, pick it · multiselect before proposal.md exists; rename into <change>/mockups/; row gone; proposal has Mockup: … (in this change); after tasks.md a "Run plan-proposal now?" confirm instead of apply (test-plan #M1, test-plan: manual-only)
- [ ] 6.2 change with mockup already adopted, no marked rows · run plan-proposal · Step 1b asks nothing, moves nothing (test-plan #M2, test-plan: manual-only)
- [ ] 6.3 no change dir, no marked rows · plan-proposal <new> drafting via ff · no plan-proposal confirm during Step 1 (test-plan #M3, test-plan: manual-only)
- [ ] 6.4 marked row + existing change · (a) openspec-update-change on its proposal, (b) openspec-new-change <other> · neither shows the multiselect nor moves anything (test-plan #M4, test-plan: manual-only)
- [ ] 6.5 marked row foo/ with <change>/mockups/foo/ pre-created · adopt via ff · refusal reported; mockups/foo/ unchanged; row still marked; no nested foo/foo (test-plan #M5, test-plan: manual-only)
- [ ] 6.6 marked row · `pi -p "/skill:openspec-ff-change …"` without ask_user · nothing moved; final report lists the row (test-plan #M6, test-plan: manual-only)
- [ ] 6.7 marked row, no change dir · plan-proposal <new>, decline in the rule multiselect · Step 1b does not re-ask in the same run; row stays marked (test-plan #M7, test-plan: manual-only)
