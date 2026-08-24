---
session: 019f159a
week: 2026/W27
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [unify-error-retry-lifecycle]
proposal_excerpt: "Today the dashboard treats provider-retry (🟡) and settled-error (🔴) as mutually exclusive replacements: retryState wins over lastError, and agent_start clears lastError the instant a retry begins."
---

# How we did it: Archive a merged-but-unarchived OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with `is this merged? I think its squased and need to be archived. Check it`.
The real objective: confirm that the `unify-error-retry-lifecycle` OpenSpec change had
actually shipped (it was squash-merged as PR #199), then complete the **archive** step
that the merge skipped — moving the change out of `openspec/changes/` and applying its
spec deltas to `openspec/specs/`. This is a housekeeping/state-reconciliation task, not a
feature build: the code already landed; only OpenSpec's bookkeeping was left in a
half-done state.

## 2. TL;DR playbook

1. Verify the merge: `git log --oneline -15` and confirm the squash commit
   (`feat(<change>): … (#NNN)`) exists on the current branch.
2. Confirm the change is still un-archived: it sits in `openspec/changes/<name>/` and is
   absent from `openspec/changes/archive/`.
3. Check task completeness: `grep -c '\- \[ \]'` vs `grep -c '\- \[x\]'` in `tasks.md`;
   list the unchecked ones with `grep -n '\- \[ \]'`. Confirm any leftover is a **deploy**
   step (per AGENTS.md), not implementation — safe to archive.
4. Run `openspec archive <name> --yes`.
5. If it fails on a `MODIFIED` delta mismatch, it's almost always a **requirement rename**:
   the delta modifies a header the live spec doesn't have anymore. Diff the delta's
   `### Requirement:` headers against the live spec.
6. Rename the **live** spec header to match the delta header, then re-run archive (it then
   replaces the full requirement body from the delta).
7. Repeat 5–6 for each spec that trips the same rename mismatch.
8. Validate: `openspec validate <spec> --type spec` for each touched spec; confirm the
   change moved to `openspec/changes/archive/<date>-<name>/`.
9. `git add -A && git commit -m "chore(openspec): archive <name> (#NNN)"`.

## 3. How the collaboration unfolded

Two prompts, ~2m39s, all on Opus — a tight, self-directed reconciliation.

- **Phase 1 · Diagnose (bash).** One batched `git log` + branch + change-dir listing
  established three facts at once: the change was merged (squash #199), still lived in the
  active changes dir, and had a `tasks.md` to check. *Why it worked:* front-loading the
  state check into a single command answered "is it merged?" and "is it archived?" together
  before touching anything.
- **Phase 2 · Confirm safe-to-archive (bash).** Counted checked vs unchecked tasks; the
  only unchecked item (`7.4`) was the local build+deploy step, which AGENTS.md classifies
  as a deploy action, not implementation. Decision point: 28/28 real tasks done → archive
  is justified.
- **Phase 3 · Archive + unblock renames (bash + edit).** `openspec archive --yes` failed
  twice, each on a `MODIFIED` requirement whose header had been renamed in the change but
  not yet in the live spec. The AI diffed delta headers against the live spec, then edited
  the **live** spec header to match — twice (`error-detection`, `session-status-banner`) —
  re-running archive after each until it passed.
- **Phase 4 · Verify (bash).** Confirmed the change moved to
  `openspec/changes/archive/2026-06-29-unify-error-retry-lifecycle/`, validated all three
  touched specs, and summarized (+1 added, ~7 modified).
- **Phase 5 · Commit.** On the user's one-word `commit`, staged all 11 files (archive
  rename + spec updates + `groups.json`) with a `chore(openspec): archive …` message.

## 4. Prompts that worked

- **The goal prompt** — `is this merged? I think its squased and need to be archived. Check it`.
  Effective because it *stated the hypothesis* ("squashed, needs archiving") and asked for
  verification, letting the AI confirm-then-act rather than guess. A stronger version:
  *"Confirm `<change>` is merged (find the squash commit), then run `openspec archive` and
  fix any delta mismatches; commit when clean."*
- **High-leverage follow-up** — `commit`. One word, but it landed the whole reconciliation
  because the AI had already staged the narrative of what changed. Works only because the
  prior turn left the tree in a known, verified state.

## 5. Steering & corrections (what to watch for)

Minimal steering — the human trusted the diagnosis and only gated the commit. The real
"guardrails" here are the recurring OpenSpec-archive traps:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat an unchecked task as a blocker | (AI self-corrected) — checked whether `7.4` was a deploy step per AGENTS.md | State up front: "deploy/build tasks don't block archive" |
| Hit `MODIFIED` archive failures on renamed requirements | (AI self-corrected) rename live header to match delta | Remember: OpenSpec `MODIFIED` matches by **header**; a renamed requirement must have its live header renamed first |
| Wait for explicit go-ahead before committing | `commit` | Say "archive and commit" in the goal prompt to remove the round-trip |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. But the workflow is **clearly repeatable** and
worth capturing. Recommended skill: *"archive a merged-but-unarchived OpenSpec change"* —
covering the verify-merge → check-tasks → archive → fix-rename-mismatch → validate → commit
loop, with the key insight that OpenSpec's `MODIFIED` matcher keys on the requirement
**header**, so a renamed requirement blocks archive until the live spec header is renamed to
match the delta. (This repo already ships an `openspec-archive-change` skill; this session's
rename-mismatch fix is the missing pitfall to fold into it.)

## 7. Pitfalls & dead ends

- **`openspec archive` fails on a `MODIFIED` delta.** Cause: the change renamed a
  requirement (`### Requirement: <old>` → `<new>`), but the live spec still has `<old>`.
  OpenSpec matches modifications by header, so it can't find the target. **Fix:** rename the
  live spec header to the new name, then re-run archive — it replaces the full requirement
  body from the delta. Expect one failure per renamed requirement (here: two —
  `error-detection` and `session-status-banner`).
- **An unchecked task in `tasks.md` looks like a blocker.** Not always: local build/deploy
  steps (e.g. `7.4`) are deploy actions per AGENTS.md, not implementation. Don't hold
  archive on them once the real tasks are 28/28.
- **The squash merge only committed change artifacts, not the archive.** Merging a PR does
  **not** archive the change or apply spec deltas — that's a separate manual step. Always
  run `openspec archive` after the PR lands.

## 8. Reproduce it faster — checklist

- [ ] `git log --oneline -15` → confirm the squash commit `feat(<change>): … (#NNN)`.
- [ ] Change still in `openspec/changes/<name>/`, absent from `.../archive/`.
- [ ] `tasks.md`: real tasks all `[x]`; any `[ ]` is a deploy/build step → OK to archive.
- [ ] `openspec archive <name> --yes`.
- [ ] On `MODIFIED` failure: diff delta `### Requirement:` headers vs live spec → rename
      live header to match → re-run archive. Repeat per spec.
- [ ] `openspec validate <spec> --type spec` for each touched spec.
- [ ] Confirm move to `openspec/changes/archive/<date>-<name>/`.
- [ ] `git add -A && git commit -m "chore(openspec): archive <name> (#NNN)"`.

**Inputs needed:** the change name, its PR number, and repo write access.
**Artifacts produced:** archived change dir, updated `openspec/specs/error-detection`,
`session-status-banner`, `provider-retry-state`, and a `chore(openspec): archive` commit
(11 files).

---

_Generated from session `019f159a` · `pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/session_facts_87575_12799.md`._
