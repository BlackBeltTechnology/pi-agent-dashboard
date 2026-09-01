---
session: 019ec585
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [add-session-closing-indicator, fix-openspec-board-mobile-scroll]
proposal_excerpt: "Closing a session card can take several seconds, with **no visual feedback** during the wait. The user clicks the ✕, nothing changes, and the card sits visually identical — fully styled, still clickable — until it abr…"
---

# How we did it: Ship a session-card closing indicator, end to end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single command:

```
/skill:openspec-apply-change add-session-closing-indicator
```

The *real* objective — visible from the proposal and the code that followed — was to
give the dashboard a **visible "closing" state** on session cards. Today, clicking the
✕ triggers a shutdown that can take several seconds while the card stays fully styled
and clickable, giving zero feedback. The change adds a transient `closing` flag, an
optimistic UI flip with a safety-revert timer, and a dimmed card + spinning disabled
close button. From there the human drove it all the way to production: apply → archive
→ commit → PR → CI → CodeRabbit → merge develop → merge PR → clean up the worktree.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read proposal/specs/tasks and implement task-by-task.
2. **Mirror the nearest existing pattern.** Here the model copied the `resuming?` flag end-to-end (shared type → hook → card) instead of inventing a new mechanism.
3. Type-check + run the client test suite. In a worktree with no `node_modules`, symlink shared first: `mkdir -p node_modules/@blackbelt-technology && ln -sfn ../../packages/shared node_modules/@blackbelt-technology/pi-dashboard-shared`, then `HOME=$(mktemp -d) npx vitest run packages/client/src`.
4. **Remove the temp symlink before committing** — it is not part of the change.
5. `/skill:openspec-archive-change <change>` — sync the delta spec into a new main spec, then archive.
6. Stage only the change's files (leave unrelated `.pi/settings.json` unstaged), commit, push, `gh pr create`.
7. Poll `gh pr checks <n>` until green; read CodeRabbit inline threads, not just the summary check.
8. Merge `origin/develop`, resolve the trivial `groups.json` ordering conflict, delete any active-copy duplicate the merge resurrects, re-test, push.
9. `gh pr merge --merge --delete-branch`; if `gh` errors updating the local checkout, finish manually: `git push origin --delete <branch>` + remove the worktree with `--force`.

## 3. How the collaboration unfolded

**Discovery & apply.** The apply skill resolved the change, read all context files, and
worked the tasks. The model's first instinct was the right one: `grep` for the existing
`resuming` flag and mirror it. It found two card roots (mobile + desktop), identified the
active close button, and applied a dim to both roots plus a spinner/disabled treatment to
the ✕. *Why it worked:* copying a proven adjacent pattern kept the diff small and idiomatic.

**Verify (the hard part).** Type-checking surfaced a resolution trap: the worktree has no
`node_modules`, so `DashboardSession` resolved from the **main** checkout's shared package —
which lacked the new `closing?` field. The model diagnosed this via `--traceResolution`,
created a worktree-local symlink to the worktree's shared, confirmed the type errors cleared,
then **removed the symlink** so it wouldn't leak into the commit. Tests ran under an ephemeral
`HOME`; all 238 client test files (2407 tests) passed.

**Archive.** The archive skill flagged two things before acting: the optional `design` artifact
was `ready` not `done`, and the delta spec was a brand-new capability with no main spec. The
human chose to sync; the model created the new main spec from the `## ADDED Requirements` block
(2 requirements, 4 scenarios) and archived the change to a dated folder.

**Ship.** Commit staged only the 6 relevant files (unrelated `.pi/settings.json` deliberately
left out), pushed, opened PR #118, polled CI to green, and confirmed CodeRabbit had 0 actionable
comments. Then merged `develop` in — one trivial `groups.json` conflict (same 6 entries, different
order) resolved to develop's ordering, and a merge artifact where develop's still-active copy of
the change resurrected as a duplicate of the archived one; the model removed only the active copy
and left develop's unrelated `fix-openspec-board-mobile-scroll` duplicate untouched. Re-tested,
pushed, green again, merged, deleted branch, removed worktree.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change add-session-closing-indicator`. Effective because the change was already fully specified; the skill name + change name is all the context the apply loop needs.
- **`go on`** — a one-word unblock that let the model continue past a checkpoint without re-litigating the plan.
- **`commit, create PR and monitor CI`** — one line that chained four steps; the model sequenced them and polled CI autonomously.
- **`fix coderabbot issues and merge develop.`** — bundled a review-response step with a rebase-equivalent; the model correctly reported "none to fix" rather than inventing work.
- **`mrege PR, delete branch and delete worktree`** — despite the typo, unambiguous enough to drive the final cleanup, including the manual fallback when `gh` errored.

Stronger rewrite of the ship prompt: *"Commit only the change's files (not `.pi/settings.json`), push, open a PR to develop, poll CI to green, and report CodeRabbit's actionable threads."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause at workflow checkpoints | `go on` | Stating "run to completion, ask only on ambiguity" up front |
| Treat CodeRabbit's summary check as the whole review | (implicit in "fix coderabbot issues") | Always reading inline threads via `gh api .../comments` |
| Risk staging unrelated `.pi/settings.json` | The model self-corrected and excluded it | A memory/rule: never stage `.pi/settings.json` in feature commits |
| Leave a temp symlink in the tree | Self-corrected before commit | Symlink shared → verify → `rm` as a fixed 3-step ritual |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work was pure execution of existing
skills (`openspec-apply-change`, `openspec-archive-change`) plus git/gh plumbing. The
repeatable friction worth capturing is the **worktree-has-no-node_modules verification
recipe** (symlink shared → typecheck/test under ephemeral `HOME` → remove symlink). If this
recurs, promote it to a project skill so future worktree builds don't re-derive it.

## 7. Pitfalls & dead ends

- **`find / -name SKILL.md` to locate a skill** — slow and noisy; the skill was already local. Prefer the known `.pi/skills/` path.
- **Type errors that look like your code but aren't** — in a worktree, `DashboardSession` resolves from the *main* checkout's shared package. Symlink the worktree's shared before trusting `tsc`.
- **Forgetting to remove the temp symlink** — it would pollute the commit. Remove it before staging.
- **`gh pr merge --delete-branch` erroring after a successful merge** — the merge *did* land on GitHub; the error is `gh` failing to update the local checkout (develop is checked out in the main repo). Verify with `gh pr view`, then delete the remote branch manually.
- **Merge resurrecting an archived change as an active duplicate** — when develop still holds the change as active, `git merge` re-adds it; remove only your own active copy.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>`; mirror the nearest existing flag/pattern.
- [ ] Worktree verify: symlink shared → `npx tsc --noEmit` → `HOME=$(mktemp -d) npx vitest run packages/client/src` → **remove symlink**.
- [ ] `/skill:openspec-archive-change <change>` (sync delta → main spec if it's a new capability).
- [ ] Stage only the change's files; exclude `.pi/settings.json`. Commit, push, `gh pr create`.
- [ ] Poll `gh pr checks <n>`; read CodeRabbit inline threads.
- [ ] Merge develop, resolve `groups.json` ordering, drop resurrected active duplicates, re-test, push.
- [ ] `gh pr merge --merge --delete-branch`; manual fallback for branch + worktree cleanup on `gh` error.

**Inputs needed:** a fully-specified OpenSpec change, `gh` auth, write access to develop.
**Artifacts produced:** PR #118 (merged `97a1b96d`), new spec `openspec/specs/session-card-closing-indicator/spec.md`, archived change `openspec/changes/archive/2026-06-14-add-session-closing-indicator/`.

---

_Generated from session `019ec585` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: deterministic facts sheet._
