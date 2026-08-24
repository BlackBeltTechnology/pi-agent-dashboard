---
session: 019ef264
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [port-session-card-state-visuals-to-openspec-board]
proposal_excerpt: "`SessionCard.tsx` (sidebar) carries a rich, status-driven visual layer: animated `.card-stripes-fx` scrolling stripes (yellow=running/streaming, cyan=unread, purple=ask_user/needs-input), a status-marker state machine…"
---

# How we did it: Port SessionCard status visuals to the OpenSpec board — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

> `/skill:openspec-apply-change port-session-card-state-visuals-to-openspec-board`

The real objective: **finish implementing an already-scoped OpenSpec change** that ports
the sidebar `SessionCard.tsx` visual layer — animated `.card-stripes-fx` status stripes
(yellow=running, cyan=unread, purple=ask_user), pulse classes, and auto-scroll-to-active —
onto the OpenSpec board (`OpenSpecBoardView.tsx`). The AI joined mid-implementation
(Task 1 already done) and had to drive the remaining tasks to completion, then — after one
steering turn — carry the change **all the way through ship**: archive, PR, CI, CodeRabbit,
merge, and worktree cleanup.

## 2. TL;DR playbook

1. **Kick off with the apply skill**: `/skill:openspec-apply-change <change-name>`. It reads
   `tasks.md` and resumes from the first unchecked task.
2. **Extract the shared visual logic first.** Move `getCardPulseClass`,
   `getCardStripeFxClass`, `STRIPE_FX_CLASS` out of `SessionCard.tsx` into a shared
   `session-status-visuals.ts`; keep `SessionCard.tsx` re-exporting them so its existing
   tests don't move.
3. **Add a `deriveProposalCardState(sessions)`** aggregator with explicit precedence
   (`ask_user > running > unread > none`) — one card-level stripe from many rows.
4. **Wire the board**: per-row `.card-stripes-fx` overlay in `BoardSessionRow`
   (`relative isolate` + `data-session-id`), aggregate stripe on `ProposalCard`, and a
   board-level `boardScrollRef` + `lastClickedRef` + `askUserFingerprint` effect for
   auto-scroll that *suppresses* scroll on user clicks.
5. **Type-check the touched files only**, then add board tests mirroring the existing board
   test file's patterns.
6. **Run the full suite once** and prove any failures are pre-existing and unrelated
   (`npm test | tee /tmp/pi-test.log`, then grep for your files) — don't chase red tests you
   didn't cause.
7. **Delegate the docs row** (Documentation Update Protocol, caveman style) to a
   `general-purpose` subagent; mark completed checkboxes; leave manual-QA tasks unchecked.
8. **Ship on one instruction**: give the AI the numbered ship plan (archive → commit/push →
   PR → poll CI+CodeRabbit → fix findings → merge with the repo's convention → delete branch
   → remove worktree).

## 3. How the collaboration unfolded

**Phase A — Resume & orient (mid-implementation).** The AI opened the board component, found
where `sessions` is available at board level, and studied the `SessionList` scroll pattern
and the existing board test before touching anything. *Why it worked:* it grounded every new
ref/effect in an existing pattern instead of inventing one.

**Phase B — Extract → wire → test.** Shared helpers relocated to
`session-status-visuals.ts`; `SessionCard.tsx` re-exported them (zero churn to its tests).
`deriveProposalCardState` added with a documented precedence order. Board got per-row +
aggregate stripes and the auto-scroll effect. 8 new board tests, lib suite green. *Decision
point:* keep `SessionCard.tsx` as a thin re-export shim rather than rewrite its callers —
minimizes blast radius.

**Phase C — Full-suite triage.** `npm test` showed 19 failures; the AI proved all 19 lived
in `pi-image-fit` (jimp native) and `pi-dashboard-server` (doctor/event-wiring), none in the
client. *Why it worked:* it treated a red suite as a **classification** problem (mine vs
pre-existing), not a fix-everything problem.

**Phase D — Docs + housekeeping.** Delegated the doc-tree row update to a subagent;
checked off done tasks; left the 3 manual-QA tasks (6.2–6.4) unchecked.

**Phase E — Ship (after the single steering turn).** Archived the change (`openspec archive
-y`), committed, pushed, opened PR #151 against `develop`, polled `gh pr checks` in a loop
until CI + CodeRabbit finished, fixed 2 valid CodeRabbit findings, re-ran, verified
`mergeable: CLEAN`, **checked the repo's merge convention (merge commit, not squash)**, merged
+ deleted the branch, then removed the worktree *from the main repo*.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <change-name>`. A single skill call is
  the ideal kickoff for a *pre-scoped* change: no re-explaining the task, the skill reads
  `tasks.md` and resumes. Effective because the scoping work was already captured in the
  proposal.
- **The high-leverage follow-up** — the entire ship phase was unlocked by ONE compact,
  numbered prompt:
  > `1. I will tests manual later 2. archive / sync 3. create PR 4. monitor CI 5. fix coderabbit issues 6. merge PR 7. delete branch 8. delete worktree`

  This is the pattern to copy: a **terse ordered checklist** that hands the AI an entire
  multi-tool workflow at once and pre-answers the "what about the manual tests?" question
  ("I will test manual later"). It let the AI run archive→merge→cleanup autonomously without
  stopping to ask between steps.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human steered / would need to steer by… | Bake this in next time by… |
|-------------------|---------------------------------------------|----------------------------|
| Pause at unchecked manual-QA tasks before archiving | Pre-stating "I'll test manual later" in the ship prompt | Include a "manual tests deferred" clause in the ship instruction so the AI doesn't block on it |
| Not know the merge style | (AI self-corrected) — it checked the base branch + repo convention before merging | State "merge commit, base = develop" up front to skip the lookup |
| Run cleanup from *inside* the worktree it was deleting | (AI self-corrected) — moved to the main repo for `worktree remove` | Always `cd` to the main repo before `git worktree remove`; the shell's cwd dies with the worktree |

The one explicit human steering turn was the **8-step ship plan** — it converted an
open-ended "now finish it" into a deterministic pipeline. Everything else the AI self-steered.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it *consumed* existing ones:

- **`openspec-apply-change`** — resumes a scoped change from `tasks.md`. Invoke when a
  proposal already exists and you just need to build it.
- **A `general-purpose` subagent** handled the doc-tree row update in caveman style per the
  Documentation Update Protocol — keeping the doc edit out of the main context.

**Recommendation:** the ship phase (archive → PR → poll CI/CodeRabbit → fix → merge with
convention → delete branch → remove worktree from main repo) is a crisp, repeatable
procedure. It is already captured by the project's **`ship-change` / `ship-it`** skills —
prefer invoking those over hand-driving the 8 steps, so the self-corrections above
(merge convention, cwd-before-worktree-remove) come for free.

## 7. Pitfalls & dead ends

- **Worktree-cwd death (6 failed commands).** Running `git worktree remove` (or any command)
  while the shell's cwd *is* that worktree leaves the bash tool anchored to a deleted dir —
  every subsequent command fails until the next turn. **Fix:** `cd /path/to/main-repo`
  before removing the worktree, and run branch/worktree cleanup from the main checkout.
- **`gh pr merge --delete-branch` partial failure.** The remote merge succeeded but `gh`
  errored trying to check out `develop` locally (it's held by the main worktree), so it left
  the remote branch undeleted. **Fix:** verify merge state with `gh pr view --json merged`,
  then delete the remote branch explicitly (`git push origin --delete <branch>`).
- **Don't chase a red full suite.** 19 failures looked alarming; all were pre-existing in
  unrelated packages. Classify failures by package/file against your diff before "fixing"
  anything.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- A **scoped OpenSpec change** with `tasks.md` (the proposal already exists).
- Repo merge convention known (**merge commit**, base `develop`).
- `gh` authenticated; CodeRabbit enabled on the repo.

Steps:
1. `/skill:openspec-apply-change <change-name>` — resume from first unchecked task.
2. Extract shared visual helpers → `session-status-visuals.ts`; keep old file re-exporting.
3. Add `deriveProposalCardState(sessions)` with `ask_user > running > unread > none`.
4. Wire board per-row + aggregate stripes + auto-scroll effect (suppress on click).
5. Type-check touched files, add board tests, run full suite once, classify failures.
6. Delegate the doc-tree row to a subagent; check off done tasks; leave manual-QA unchecked.
7. Hand the AI ONE numbered ship plan (or invoke `ship-change`/`ship-it`).
8. **Before removing the worktree, `cd` to the main repo.** Verify merge via
   `gh pr view --json merged`; delete remote branch explicitly if `gh` skipped it.

Artifacts produced:
- `packages/client/src/components/OpenSpecBoardView.tsx` (edited)
- `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx` (edited)
- `openspec/changes/port-session-card-state-visuals-to-openspec-board/tasks.md` (edited)
- Shared `session-status-visuals.ts` (extracted helpers)
- PR [#151](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/151), merged as `0a3d0d67`; archived change `2026-06-23-port-session-card-state-visuals-to-openspec-board`.

---

_Generated from session `019ef264-e1bd-7490-a670-d55c34cefd38` · `pi-agent-dashboard` · 2026-06-23. Source extract: `/tmp/session_facts.LQ50MG`._
