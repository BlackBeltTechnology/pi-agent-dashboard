---
session: 019ec402
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-worktree-cwd-keying, redesign-openspec-board]
---

# How we did it: Ship an OpenSpec change — and discover it was already superseded — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change fix-openspec-worktree-cwd-keying
```

The real objective: implement the `fix-openspec-worktree-cwd-keying` change — make the
folder-level OpenSpec card reflect a **worktree session's own** `tasks.md` state (instead
of silently reading/writing the main checkout's copy), then archive, commit, PR, and merge.
The genuine payoff of the session, though, arrived at the CI step: while this change sat in
review, another PR (`redesign-openspec-board`, #112) had **already solved the same problem
by a different design**. So the "how we did it" is really two stories: (a) a clean
spec-driven implementation, and (b) the discipline to detect a superseded change during a
merge conflict and **abandon it correctly** rather than force it through.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — let the apply skill read
   the change's `proposal.md`/`tasks.md`/`design.md` and lay out a numbered plan.
2. Implement spec-driven: **shared type → helper + unit test → wire into components →
   thread the new field everywhere → run tests + typecheck**. Land tests alongside code.
3. Run the scoped test project with an isolated HOME: `HOME=$(mktemp -d) npx vitest run
   --project <web-project> <changed-files>`. Rerun flaky perf smoke tests in isolation
   before blaming your change.
4. `openspec archive <change> --yes`. If it refuses, the **main spec is probably corrupt**
   from a prior archive — fix the leaked delta header (`## ADDED Requirements` →
   `## Requirements`), add a missing `## Purpose`, and reflow any requirement whose
   `SHALL`/`MUST` wrapped past line 1.
5. Commit (excluding local env artifacts like `.pi/settings.json`), push, `gh pr create`,
   then poll `gh pr checks` / `gh run list`.
6. **If the PR shows CONFLICTING, stop and diff before resolving.** `git fetch origin
   develop` + `git merge-tree --write-tree` to see the conflict surface. A ~600-line
   conflict is a signal, not a chore.
7. When the conflict reveals a **major upstream refactor**, audit whether develop already
   solves your bug. Read the new files (`OpenSpecBoardView.tsx`, `openspec-board-worktree.ts`)
   and the landed change's spec before deciding.
8. If superseded: `git merge --abort`, present the finding, and on confirmation **abandon
   cleanly** — close the PR with a pointer to the superseding PR, `git reset --hard` to the
   pre-change base, delete remote + local branch, `git worktree remove --force`. Preserve
   local env tweaks.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & plan (Prompt 1).** The apply skill located the change artifacts,
read the source it would touch (`SessionList.tsx`, `FolderOpenSpecSection.tsx`,
`packages/shared/src/types.ts`), and printed a 5-step spec-driven plan before editing.
*Why it worked:* the plan enumerated exactly which tasks (1.x–5.1) mapped to which files, so
the implementation was mechanical rather than exploratory.

**Phase 2 — Implementation.** Added `sourceCwd?` to `OpenSpecChange`, wrote a new
`openspec-aggregate.ts` helper (`aggregateOpenSpec` unions OpenSpec data across the group
cwd + each worktree member cwd, de-dupes by name with group-cwd-wins, OR-folds flags) with
its unit test, wired the aggregate into `SessionList`, and threaded `rowCwd = c.sourceCwd ??
cwd` through every action in `FolderOpenSpecSection` (TasksPopover, spawn-attach,
spawn-worktree, read-artifact). *Why it worked:* the new field was threaded **everywhere in
one pass** — no half-wired state.

**Phase 3 — Verify.** Ran the scoped vitest project under `HOME=$(mktemp -d)`; two perf
smoke tests failed on timing, passed green on isolated rerun. A `tsc` project-reference error
was correctly identified as a pre-existing config quirk, not the change. All 236 test files
green.

**Phase 4 — Archive (Prompt 2: "archive").** `openspec archive` refused. The AI root-caused
**three latent corruptions** in the committed main spec (leaked `## ADDED Requirements`
header hiding every requirement; missing `## Purpose`; a `SHALL` wrapped onto line 2 that the
validator couldn't see) — fixed each minimally and archived. *Decision point:* it flagged
these as **pre-existing**, not caused by the change, so future archives were warned.

**Phase 5 — Commit / PR / CI (Prompt 3: "commit, create PR and monitor CI").** Excluded
`.pi/settings.json` (a local absolute-path artifact), committed, pushed, opened PR #113.
CI showed **CONFLICTING**. Rather than blindly resolve, the AI diffed develop and found PR
#112 (`redesign-openspec-board`) had **replaced the inline accordion this change patched with
a full-page kanban board** — a ~600-line conflict against deleted UI.

**Phase 6 — Audit & the honest verdict (Prompt 4: "yes").** The AI aborted the merge, read
develop's `OpenSpecBoardView.tsx` and `openspec-board-worktree.ts`, and confirmed
`deriveWorktreeProgress(session, changeName, mainDone, openspecMap)` already reads each
worktree's own `tasks.md` via `openspecMap.get(session.cwd)` and shows progress + delta —
covering requirements #1/#3 — while keeping worktree state read-only so the toggle-write bug
(#2) is gone by design. Verdict: **no remaining gap; the change is superseded.**

**Phase 7 — Clean abandonment (Prompt 5: "delete branch and worktree").** Closed PR #113
with a comment pointing at #112, `git reset --hard` to base `653f3052`, deleted remote +
local branch, `git worktree remove --force`, preserving the local `.pi/settings.json` tweak.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change fix-openspec-worktree-cwd-keying`.** A
  single skill invocation with the change name is the ideal kickoff: the apply skill owns
  the whole read-plan-implement loop, so the operator supplies zero context.
- **`archive`** — one word; the apply skill knows the next artifact step. Effective because
  the workflow is well-defined; short prompts ride the skill's state machine.
- **`commit, create PR and monitor CI`** — bundled three ship steps into one instruction,
  letting the AI sequence them and surface the CONFLICTING state on its own.
- **`yes`** — the highest-leverage prompt in the session: it authorized the AI to run the
  full supersession audit it had proposed, which changed the outcome from "force-merge a dead
  change" to "abandon correctly."
- **`delete branch and worktree`** — a precise cleanup instruction once the verdict was in.

*Rewrite for next time:* fold the ship steps into the kickoff expectation — e.g. "apply,
archive, and open a PR against develop; if it conflicts, diff before resolving and tell me if
the change looks superseded." That front-loads the guardrail that mattered most here.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a merge conflict as a mechanical resolve task | Implicitly (the AI self-corrected) — but confirm with `yes` before the deep audit | State up front: "if the PR conflicts, diff develop and check for supersession before resolving" |
| Proceed step-by-step, pausing between ship stages | Batch the ship steps: "commit, create PR and monitor CI" | Give the full ship sequence in one prompt |
| Risk committing local env artifacts | (self-caught) exclude `.pi/settings.json` | Add a `.gitignore`/commit rule for local absolute-path settings |
| Blame its own change for flaky/perf test failures | (self-caught) rerun in isolation | Note that perf smoke tests are timing-sensitive; rerun before diagnosing |

The load-bearing correction was cultural, not textual: the human's `yes` licensed an
**honest "your change is unnecessary"** conclusion. The reusable lesson — reward the AI for
detecting sunk-cost work instead of shipping it.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created in this session. The workflow leaned on existing skills
(`openspec-apply-change`, and implicitly the ship/CI flow). But the session surfaces **two
patterns worth capturing as skills:**

1. **"Detect a superseded OpenSpec change during a merge conflict."** When a PR conflicts
   with a large upstream refactor, audit whether develop already solves the bug (read the new
   files + the landed change's spec) before resolving. Invoke whenever a long-lived branch
   hits a >200-line conflict. *Removes:* wasted effort force-resolving a dead change.
2. **"Repair a corrupt OpenSpec main spec to unblock archive."** Fix leaked delta headers
   (`## ADDED Requirements` → `## Requirements`), add missing `## Purpose`, reflow
   `SHALL`/`MUST` onto line 1. Invoke when `openspec archive` refuses on a pre-existing spec.
   *(A `fix-stale-kb-dox-rows`-style repair skill already exists in spirit; this is the spec
   analog.)*

## 7. Pitfalls & dead ends

- **`openspec archive` refuses with a validation error** → the *main* spec is likely
  corrupt, not your delta. Check the top header for a leaked `## ADDED Requirements`, a
  missing `## Purpose`, and any requirement whose keyword wrapped past line 1. The validator
  only reads the statement's **first line** for `SHALL`/`MUST`.
- **`tsc` project-reference error after a clean edit** → often a pre-existing config quirk;
  confirm it reproduces on the base before treating it as your regression.
- **Perf/timing smoke tests fail once** → rerun in isolation (`HOME=$(mktemp -d) npx vitest
  run --project <web> perf`) before blaming your change; they're flaky, not broken.
- **PR shows CONFLICTING** → do **not** blind-merge. `git merge-tree --write-tree
  origin/develop` first; a ~600-line conflict against deleted UI means the change may be
  superseded. `git merge --abort` and audit before deciding.
- **Cleaning up a worktree branch** → `git reset --hard` discards the local commit, then
  delete remote + local branch and `git worktree remove --force`. Preserve local env files
  (`.pi/settings.json`) by resetting them out of the index, not deleting them.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; `gh` authenticated; the base branch
(`develop`); an isolated `HOME` for vitest.

- [ ] `/skill:openspec-apply-change <change>` → read the plan, confirm task→file mapping.
- [ ] Implement spec-driven: shared type → helper + test → wire → thread everywhere.
- [ ] `HOME=$(mktemp -d) npx vitest run --project <web> <files>`; rerun flaky perf tests.
- [ ] `openspec archive <change> --yes`; if refused, repair the main spec (header/Purpose/
      SHALL-on-line-1) and retry.
- [ ] Commit excluding `.pi/settings.json`; push; `gh pr create`.
- [ ] `gh pr checks` / `gh run list`. **If CONFLICTING → diff develop before resolving.**
- [ ] If a big upstream refactor solves the bug: `git merge --abort`, present the finding,
      then close the PR (point at the superseding PR), `git reset --hard <base>`, delete
      branch, `git worktree remove --force`.

**Final artifacts (all later abandoned by design):** `openspec-aggregate.ts` + test,
`sourceCwd?` on `OpenSpecChange`, threaded `FolderOpenSpecSection`/`SessionList`. The durable
output of the session is the **audit + clean abandonment**, not the code.

---

_Generated from session `019ec402-5c3d-7e35-ad69-6b29454b150b` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-fix-openspec-worktree-cwd-keying` · 2026-06-14. Source extract: `/tmp/facts-XXXX.md`._
