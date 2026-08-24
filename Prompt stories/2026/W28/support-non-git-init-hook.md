---
session: 019f5484
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [support-non-git-init-hook]
proposal_excerpt: "The worktree-init hook (`.pi/settings.json#worktreeInit`) is the mechanism that tells the dashboard whether a checkout is \"configured\" and how to initialize it. Both endpoints that read it — `GET /api/git/worktree/ini…"
---

# How we did it: support-non-git-init-hook — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single skill invocation:

```
/skill:openspec-apply-change support-non-git-init-hook
```

The real objective: implement a pre-planned OpenSpec change end-to-end. The change
teaches the dashboard's two worktree-init endpoints to read the
`.pi/settings.json#worktreeInit` hook in **non-git** directories, not just git repos.
Today both endpoints gate on `isGitRepo`/`resolveMainPath` and return `not_a_repo`
for a plain configured folder. The task was to add a `resolveConfigRoot(cwd)`
primitive that resolves the config root for git repos, git worktrees, AND bare
`.pi/settings.json` dirs — then rewire the routes to it — with unit + route tests,
and carry the whole thing through apply → ship → merge. Two later one-liners
("I will tests later, ship-change" and "Maybe its can run now") were the only
steering: they moved the AI from *implement* to *ship* and then unblocked a stalled
review.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — let the apply skill read the
   proposal/design/spec and drive the tasks.md checklist.
2. Add the new primitive next to its sibling (`resolveConfigRoot` beside
   `resolveMainPath` in `git-operations.ts`) so the diff stays local and reviewable.
3. When a same-module function must be **stubbed in tests**, call the primitives
   through a **module self-namespace import** (`self.isGitRepo(...)`), because
   `vi.spyOn` cannot intercept internal lexical references.
4. In tests, prove "no git spawn happened" with a **filesystem marker**, not fragile
   internal spies. Always set an ephemeral `HOME=$(mktemp -d)` for git-touching tests.
5. Run the full suite once to a log, then **grep to isolate** your package's failures
   from pre-existing unrelated noise: `npm test 2>&1 | tee /tmp/pi-test.log`.
6. Prove unrelated failures are pre-existing/environmental (here: a stale `jimp`
   node_modules drift) via the lockfile before dismissing them — don't hand-wave.
7. Steer to ship: `"I will tests later, ship-change"` — the ship-change skill archives
   + syncs specs, commits, pushes, opens the PR, watches CI, handles CodeRabbit.
8. Triage every CodeRabbit finding; **fix the one that leaked into the LIVE spec**,
   defer cosmetic/by-design ones with a posted reason.
9. Squash-merge; expect the **worktree branch-delete collision** and finish cleanup
   with an explicit remote-branch delete + `git worktree remove` + local `-D`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the change, don't guess).** The AI located the
`openspec-apply-change` skill, ran `openspec status`/`instructions apply`, then read
the proposal, design, spec, and the two source files (`git-operations.ts`,
`git-routes.ts`) plus their existing tests before writing a line. *Why it worked:*
full context first means the new primitive slots in beside `resolveMainPath` with a
surgical diff.

**Phase 2 — Implement the primitive + make it testable.** The AI added
`resolveConfigRoot(cwd)` and immediately hit a real testability wall: `vi.spyOn`
doesn't intercept internal same-module calls (the lexical binding is used). The fix
was to route the two primitives through a **module self-namespace import**
(`self.isGitRepo` / `self.resolveMainPath`) so the degenerate-git case becomes
deterministically stubbable. *Decision point:* choose the self-namespace pattern over
splitting the module or mocking the whole module.

**Phase 3 — Rewire routes + tests.** Both init routes swapped the
`isGitRepo` guard + `resolveMainPath` for `resolveConfigRoot`, `repoRoot`→`configRoot`,
and a `null` root now returns the existing no-hook envelope instead of `not_a_repo`.
The AI removed the now-orphaned `resolveMainPath` import (an orphan its own change
created — correct to remove). Route tests used a **filesystem marker** to prove
no-spawn rather than internal spies. 41/41 green.

**Phase 4 — Verify against noise.** The full suite showed 17 failures — all
`Jimp is not a constructor` in `pi-image-fit-extension`. The AI didn't wave them off:
it traced installed `jimp@0.16.13` (v0 API) vs the lockfile's pinned `jimp@1.6.1`,
proved it was a **stale local worktree install drift** (CI's clean install passes),
confirmed the server package was clean, and ran tsc + Biome scoped to the 4 changed
files (only `organizeImports` was actionable — applied scoped).

**Phase 5 — Ship.** On `"ship-change"`, the AI marked the lone manual QA task
done-for-post-merge, archived the change (syncing 2 requirements into the live spec),
committed, pushed, opened PR #284, and watched CI to green (9m20s — which also
confirmed the Jimp failures were local-only).

**Phase 6 — CodeRabbit + merge.** CodeRabbit was rate-limited (ACK placeholder, zero
real review). The AI correctly paused at the one-way merge door. The `"Maybe its can
run now"` nudge re-triggered the review: 5 findings, all Minor, all on doc artifacts —
**but one had leaked into the LIVE main spec** ("SHALL NOT execute any command" was
false, since `resolveConfigRoot` shells out to git for discovery). The AI fixed that in
both live + archived spec, deferred cosmetic ones with a posted reason, re-ran CI green,
then squash-merged and cleaned up.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change support-non-git-init-hook`.**
  Effective because the *planning* was already done (proposal/design/spec/tasks
  existed). The apply skill turns a checklist into implementation. Kickoff via the
  skill, not a freeform "implement this."
- **`"I will tests later, ship-change"`** — a high-leverage 5-word unlock. It told the
  AI (a) the operator accepts deferring the manual QA task and (b) to switch skills to
  the ship flow. Stronger phrasing: *"Manual QA task 4.1 deferred to post-merge — run
  ship-change."*
- **`"Maybe its can run now"`** — nudged the AI to retry the rate-limited CodeRabbit
  review. Effective as a resume signal; clearer: *"Re-trigger CodeRabbit; the rate
  limit should have eased — then proceed to merge if clean."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in implement-mode after tasks were code-complete (one manual QA task left) | "I will tests later, ship-change" | State up front: "defer manual QA to post-merge; ship when code tasks pass" |
| Pause indefinitely at the one-way merge door when CodeRabbit was rate-limited | "Maybe its can run now" | Pre-authorize: "if CI is green and CodeRabbit is only rate-limited, retry once then merge" |

Note the AI's own good instincts that needed **no** steering: it stopped before the
irreversible squash-merge to confirm intent, and it refused to dismiss unrelated test
failures without proving they were environmental.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a straight
apply→ship execution of pre-existing skills. The reusable assets exercised:

- **`openspec-apply-change`** — reads the change artifacts and drives tasks.md. Invoke
  when a planned OpenSpec change is ready to build.
- **`ship-change`** — archive + spec-sync + commit + PR + CI-watch + CodeRabbit loop +
  squash-merge + worktree cleanup. Invoke after apply completes and only QA/manual
  tasks remain.

**Worth capturing as a memory/skill:** the **module self-namespace stubbing pattern**
(`import * as self from './this-module'; self.primitive(...)` so `vi.spyOn` can
intercept same-module calls) is a repeatable Vitest testability trick — a good
candidate for a project convention note.

## 7. Pitfalls & dead ends

- **`vi.spyOn` can't stub same-module internal calls.** Symptom: your spy never fires
  for a function that another function in the same file calls directly. Fix: route the
  call through a module self-namespace import (`self.fn()`).
- **Stale worktree node_modules drift.** Symptom: `Jimp is not a constructor` (or any
  "X is not a constructor") in an untouched package. Cause: hoisted old version used
  because the nested pinned install is missing in the worktree. Verify against the
  **lockfile** + a clean CI run before blaming your change; don't try to fix it.
- **CodeRabbit "pass / Review rate limited" is an ACK, not a review.** Zero real
  comments. Don't treat it as an approval; retry after the window, or proceed only
  under a pre-authorized rule.
- **Doc fixes can leak into the LIVE spec.** `openspec archive` syncs delta
  requirements into the main spec — so a wording error CodeRabbit flags on an archived
  artifact may also be live. Fix both.
- **Worktree branch-delete collision on squash-merge.** `gh pr merge --delete-branch`
  tries to switch to `develop` locally (checked out in the parent worktree) and fails;
  the merge itself still succeeds on GitHub. Finish manually: delete the remote branch,
  `git worktree remove`, then `git branch -D` (squash commits aren't "merged" in git's
  linear sense, so `-d` refuses). Removing the worktree deletes the session's own cwd —
  run final cleanup with an explicit valid cwd.

## 8. Reproduce it faster — checklist

- [ ] Confirm the OpenSpec change is planned (proposal/design/spec/tasks exist).
- [ ] `/skill:openspec-apply-change <change-name>` — read all context files first.
- [ ] Add the new primitive beside its sibling for a local, reviewable diff.
- [ ] For same-module stubbing, use the module self-namespace import pattern.
- [ ] Tests: ephemeral `HOME=$(mktemp -d)`; prove no-spawn with a filesystem marker.
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log`; grep to isolate YOUR package's failures.
- [ ] Prove any unrelated failure is pre-existing/environmental via the lockfile.
- [ ] Scoped Biome (`--only=assist/source/organizeImports`) + tsc on changed files only.
- [ ] Steer to ship: defer manual QA, run `ship-change`.
- [ ] Triage CodeRabbit; fix anything that reached the LIVE spec; defer the rest with a
      posted reason; re-run CI green.
- [ ] Squash-merge; handle the worktree branch-delete collision; run cleanup from a
      valid cwd.

**Key inputs:** a planned OpenSpec change, `gh` auth, a worktree checkout.
**Artifacts produced:** PR #284 (merged, squash `cc4f2450`);
`packages/server/src/git-operations.ts` (+`resolveConfigRoot`),
`packages/server/src/routes/git-routes.ts` (rewired init routes),
new unit + route tests, and the archived change
`openspec/changes/archive/2026-07-12-support-non-git-init-hook/` with 2 requirements
synced into `openspec/specs/worktree-init-hook/spec.md`.

---

_Generated from session `019f5484` · `pi-agent-dashboard/.worktrees/os-support-non-git-init-hook` · 2026-07-12. Source extract: `/tmp/facts-t92cG3.md`._
