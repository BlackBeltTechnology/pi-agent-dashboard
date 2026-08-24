---
session: 019e7667
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [harden-worktree-spawn]
proposal_excerpt: "The +Worktree dialog silently fails when spawning a pi session into a sibling worktree of the pi-dashboard repo itself. Two compounded bugs:"
---

# How we did it: Ship a worktree-spawn hardening change through green CI — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The first prompt was just **"commit and push"** — the implementation for the
`harden-worktree-spawn` OpenSpec change was already sitting uncommitted in the
`.worktrees/harden-worktree-spawn` checkout. The *real* objective, revealed by the
follow-up steering ("create a PR", then a pasted CI job URL, then "is this open PR?"),
was end-to-end: **commit the worktree-spawn hardening work, open PR #52 against
`develop`, and drive it to fully green CI so it could merge.** The interesting part
wasn't the commit — it was diagnosing a CI `tsc --noEmit` failure caused by
out-of-scope code that had leaked in from a *sibling* branch, and deciding how to
unblock the PR without expanding the change's scope.

## 2. TL;DR playbook

1. **Snapshot the state first:** `git status && git diff --stat && git log --oneline -5`
   in the worktree before committing — confirm what's actually staged and that you're
   on the right branch.
2. **Commit with a scoped Conventional-Commit message** (`feat(worktree-spawn): …`),
   push with `git push -u origin <branch>`.
3. **Open the PR against `develop`** (not `main`): `gh pr create --title … --body …`.
   Capture the PR number.
4. **When CI goes red, read the failing job, not the summary:**
   `gh run view <run-id> --log-failed | tail -100`, then narrow with
   `grep -E "error TS|possibly 'null'|has no exported member"`.
5. **Classify each error by root cause.** Here: two errors were a *missing exported
   helper* (`isOrphanWorktreePath`) imported by code that had been copy-pasted from a
   different branch; two were trivial (`implicit any`, `possibly null`).
6. **Trace the leaked symbol across branches** with
   `git log --all -S "isOrphanWorktreePath" -- packages/server/` and
   `git show <commit> -- <file>` to prove it lives only on the sibling branch.
7. **Pick the minimal unblock:** port the missing helpers into this branch's
   `git-worktree.ts` and null-guard the two trivial errors — don't rip out the
   out-of-scope code mid-flight if porting is smaller.
8. **Verify locally before re-pushing:** `npm run lint` (= `tsc --noEmit`) must be
   clean, then commit `fix(lint): …` and push.
9. **Confirm the merge gate:**
   `gh pr view <n> --json state,isDraft,mergeable,statusCheckRollup` — all checks green
   → merge.

## 3. How the collaboration unfolded

**Phase 1 — Commit & push (Discovery).** The AI ran `git status`/`diff --stat`/`log`
to see what was uncommitted, wrote a scoped `feat(worktree-spawn): …` commit, and
pushed the branch. It surfaced the GitHub "create PR" link. *Why it worked:* it
verified the working tree state before committing rather than blindly `git add -A`-ing.

**Phase 2 — Open the PR.** On "create a PR", the AI ran `gh pr create` with a title and
a heredoc body, producing **PR #52**. *Decision point:* base branch is `develop`, the
project's integration branch — not `main`.

**Phase 3 — Diagnose red CI (the hard part).** The human pasted a failing Actions job
URL. The AI pulled the failed log (`gh run view --log-failed`), grepped for the TS
error lines, and found four `tsc --noEmit` errors. It then did real forensics:
`isOrphanWorktreePath` was imported but not exported *here*. Using
`git log --all -S`, `git show <commit>`, and cross-branch `git diff`, it proved the
orphan-cleanup code (import + `computeOrphanLikely` + `orphanCleanup` + route + client
helpers) had been copy-pasted from branch `openspec-worktree-spawn-button`
(commit `4e4e9066`, itself an open PR) — but the helper it depended on lived *only* on
that branch, and it was **out of scope** for `harden-worktree-spawn` (whose proposal is
bootstrap + global toast only). *Why it worked:* it treated a compile error as a
provenance question ("where did this symbol come from?") and answered it with git
archaeology instead of guessing.

**Phase 4 — Minimal fix & verify.** The AI ported the missing `isOrphanWorktreePath`
helpers into `git-worktree.ts`, null-guarded `child.stdout`/`child.stderr`, and typed
the implicit-`any` parameter. It ran `npm run lint` locally to confirm clean, committed
`fix(lint): …`, and pushed `a2e6435c`.

**Phase 5 — Confirm merge.** Hours later, "is this open PR?" → the AI ran
`gh pr view 52 --json state,isDraft,mergeable,statusCheckRollup` and reported **MERGED**,
all 10 checks green (ci + 6 Linux smoke + 3 Windows smoke).

## 4. Prompts that worked

- **Goal prompt — "commit and push"** (weak on its own). It worked only because the
  implementation was already done and the AI reconstructed the intent. **Stronger
  version:** *"Commit the uncommitted worktree-spawn work with a scoped
  `feat(worktree-spawn):` message, push, open a PR against `develop`, and drive CI to
  green — fix any lint/tsc failures minimally without expanding the change's scope."*
- **High-leverage follow-up — pasting the raw failing-job URL.** One URL gave the AI
  everything it needed to fetch the exact failed log. Far better than "CI is broken".
- **"is this open PR?"** — a cheap status check that the AI answered authoritatively by
  querying `gh pr view --json` rather than assuming.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "commit and push" | "create a PR" | State the full goal up front: commit → PR against `develop` → green CI → merge |
| Not know which CI job failed | Paste the exact Actions job URL | Give the failing run/job URL (or say "read `gh run view --log-failed`") in the first breath |
| Risk expanding scope while fixing the compile error | Implicitly hold the line via the proposal (bootstrap + toast only) | Name the scope guardrail explicitly: "unblock CI with the *smallest* fix; do not add features from other branches" |
| Treat `git add -A` as safe | (verified state first anyway) | Always `git status`/`diff --stat` before a broad add in a worktree — sibling-branch copy-paste can smuggle in unrelated code |

The core lesson: **out-of-scope code leaked in via copy-paste from an open sibling
branch, and only surfaced as a CI type error.** The steering that mattered was keeping
the fix minimal (port the one missing helper) instead of doing a larger cleanup.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. But the workflow is clearly repeatable
and would benefit from a **skill: "unblock-red-pr-ci"** capturing:

- **What it captures:** fetch the failing job log (`gh run view <run> --log-failed`),
  bucket errors by root cause, git-archaeology any *missing exported symbol*
  (`git log --all -S`, `git show`), then apply the smallest scope-preserving fix and
  re-verify with `npm run lint` before re-push.
- **Why it's effective:** it removes the guess-and-push loop against CI (each round trip
  is minutes of Actions time) by diagnosing locally and reproducing the exact `tsc`
  failure before touching code.
- **When to invoke it:** any time a PR's `ci` / `tsc --noEmit` check is red and you own
  the branch.

The repo already has a `ci-troubleshoot` skill for the workflow taxonomy — this session
is a concrete instance of the "lockfile / bad symbol / lint" failure-mode branch of it.

## 7. Pitfalls & dead ends

- **A first commit attempt failed** (multi-line `-m` message in the initial
  `git commit`) — the truncated commit command errored before succeeding on a retry.
  If a long heredoc/`-m` commit fails, re-run with the message in a file or a clean
  `$(cat <<'EOF' …)` block.
- **Copy-pasted code from a sibling open PR compiles on *its* branch but not yours.** A
  `TS2305: Module … has no exported member` is the tell: the symbol exists only where it
  was copied from. Don't "fix" it by inventing a stub — trace it with `git log --all -S`
  and either port the real helper or remove the pasted code.
- **Reading the CI *summary* wastes time.** Go straight to `--log-failed` and grep for
  `error TS`, `possibly 'null'`, `has no exported member`.
- **Base branch matters:** this PR targets `develop`. Opening against `main` would fail
  the merge gate later.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree with the change implemented; `gh` authenticated;
knowledge that PRs base on `develop`; the failing Actions run/job URL if CI is already red.

1. `git status && git diff --stat && git log --oneline -5` — verify state.
2. `git commit -m "feat(<scope>): …"` (retry via file/heredoc if a long message fails).
3. `git push -u origin <branch>`.
4. `gh pr create --title … --body … ` → note the PR number (base = `develop`).
5. If red: `gh run view <run-id> --log-failed | grep -E "error TS|possibly 'null'|has no exported member"`.
6. Bucket errors; for any missing symbol: `git log --all -S "<symbol>" -- packages/…` + `git show <commit> -- <file>`.
7. Apply the **smallest** scope-preserving fix (port the helper; null-guard; type the param).
8. `npm run lint` clean locally → `git commit -m "fix(lint): …"` → push.
9. `gh pr view <n> --json state,isDraft,mergeable,statusCheckRollup` → all green → merge.

**Final artifacts:** PR #52 (merged), edits to
`packages/server/src/git-worktree.ts`, `git-operations.ts`, `worktree-bootstrap.ts`.

---

_Generated from session `019e7667-19ef-7b71-bd3f-4962203e3901` · `pi-agent-dashboard` · 2026-05-30. Source extract: session facts sheet (mktemp)._
