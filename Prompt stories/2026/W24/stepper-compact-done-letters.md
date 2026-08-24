---
session: 019ec6d1
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [stepper-compact-done-letters]
proposal_excerpt: "On the full-page OpenSpec board the lifecycle stepper renders in `compact` variant, which hides the per-node text label. In that variant a completed artifact node (`Proposal`, `Design`, `Specs`, `Tasks`) collapses to…"
---

# How we did it: Ship an OpenSpec change end-to-end (stepper-compact-done-letters) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change stepper-compact-done-letters
```

The literal ask was "apply this OpenSpec change." The **real** objective, which the four
follow-up prompts made explicit, was a full delivery pipeline: implement the change +
tests, archive it and sync delta specs into main specs, open a PR against the default
branch, watch CI to green, triage CodeRabbit, then merge and tear down the branch and
worktree. In short: take one small UI change (in `compact` variant, a *done* artifact
node — P/D/S/T — should keep its letter instead of collapsing to a check) from proposal
to merged-on-`develop`, with all housekeeping done.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — let the skill read `proposal.md` + `tasks.md` and locate the code to touch.
2. Make the **minimal code edit** (`OpenSpecStepper.tsx`: adjust the `renderContent` gate) and add **targeted tests** covering the new branch and its complements.
3. Run just the affected suite: `npx vitest run <path/to/test>`. If it needs a clean HOME, prefix `HOME=$(mktemp -d)`.
4. `npm run build` to confirm compilation; **do not restart the live `:8000` server** from a worktree — leave the manual visual-check task for the human.
5. Steer: `archive and sync` → run `openspec archive <change> --yes` (this syncs delta specs into main specs *and* moves the change to `archive/`).
6. Steer: `commit, create PR and monitor CI` → stage only feature files (exclude machine-local `.pi/settings.json`), commit, `git push -u`, `gh pr create --base develop` (default branch is **develop**, not main), then poll `gh pr checks <n>`.
7. Steer: `Fix coderabbit issues (if exists)` → read each comment, **verify against repo reality** before acting; reply-and-skip false positives with a documented reason.
8. Steer: `merge PR, delete branch and worktree` → `gh pr merge <n> --squash --delete-branch`, then delete the remote branch and `git worktree remove --force` from the **main** checkout.

## 3. How the collaboration unfolded

**Phase 1 — Apply (implement + test).** The AI read the proposal/tasks, then made a
surgical one-gate edit in `OpenSpecStepper.tsx` so a compact *done* artifact node falls
through to the existing letter branch instead of rendering `mdi-check`. It added three
tests (sidebar-done → check; compact-done P/D/S → letter; compact-done Apply → check),
ran the suite (14 pass, 3 new), and `npm run build` clean. *Why it worked:* it changed
one condition and proved every branch with tests rather than eyeballing.

- **Decision point:** the AI declined to restart the running `:8000` dashboard because
  that server is the *main* install, not the worktree — it left the manual visual check
  (task 3.2) to the human. Good instinct: don't disturb the operator's live environment.

**Phase 2 — Archive & sync.** On `archive and sync`, the AI ran `openspec archive --yes`,
which aborted on a **pre-existing** structural bug in `openspec-attach-combo/spec.md`
(`## ADDED Requirements` delta heading left in a main spec, plus a missing `## Purpose`).
It fixed those two lines, re-ran archive successfully, and confirmed the change landed in
`archive/2026-06-14-stepper-compact-done-letters/`. *Why it worked:* it diagnosed the
failure as inherited, not self-caused, and fixed the minimum to unblock.

**Phase 3 — Commit, PR, CI.** The AI staged only the feature/spec/archive files (excluding
an unrelated `.pi/settings.json` local-path edit), committed, pushed, and — after a first
`--base main` attempt failed — discovered the repo's default branch is `develop` and
opened PR #121 there. It then polled `gh pr checks` on a sleep loop until lint→test→build
went green.

**Phase 4 — CodeRabbit triage.** CodeRabbit flagged the archived files as "nested under
`archive/`." The AI **verified against the repo** (`git ls-tree` showed 435 existing
archived changes under that exact path), concluded it was a false positive, and posted a
reply documenting the skip rather than making a breaking change.

**Phase 5 — Merge & teardown.** On the final steering prompt, the AI squash-merged
(`50d5c21`), deleted the remote branch, and force-removed the worktree from the main
checkout (the worktree can't remove itself, and only the intentionally-excluded local
settings edit remained).

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change stepper-compact-done-letters`.**
  Effective because it hands the AI a self-describing unit of work: the skill knows to
  read proposal + tasks, so no context has to be re-typed. *Stronger version for a
  future run:* state the full intent up front — "apply, then archive+sync, open a PR to
  develop, get CI green, triage CodeRabbit, merge and clean up the worktree" — so the AI
  can plan the whole pipeline instead of waiting for four separate nudges.
- **High-leverage follow-ups.** Each was 3–5 words and unlocked a whole phase:
  - `archive and sync` — one phrase drove spec-sync + archive + fixing two inherited bugs.
  - `commit, create PR and monitor CI` — commit → push → PR → poll, all from one line.
  - `Fix coderabbit issues (if exists)` — the `(if exists)` guard correctly let the AI
    *verify and skip* rather than invent a fix.
  - `merge PR, delete branch and worktree` — complete teardown in one instruction.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "implement," treating apply as the whole job | `archive and sync`, then `commit, create PR…` | Give the full pipeline in the kickoff prompt |
| Reach for the default `--base main` | (implicit) repo default is `develop` | State "PR against develop" up front; save a project memory that develop is the base branch |
| Treat a CodeRabbit comment as actionable | `Fix coderabbit issues (if exists)` | Always verify a bot flag against repo reality before acting; reply-and-skip false positives |
| Include an unrelated `.pi/settings.json` local edit | (AI self-corrected) | Stage feature files explicitly; never `git add -A` in a worktree |

Also worth internalizing: the AI **refused to restart the live `:8000` server** and left
the manual visual check to the human — a quality bar the operator should keep (don't let
an agent disturb a running dashboard from inside a worktree).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow is highly repeatable and
already partly encoded in existing skills:

- `openspec-apply-change` + `openspec-archive-change` handled apply and archive/sync.
- **Recommended:** a single **`ship-change`**-style skill (one already exists in this repo)
  that chains archive → commit → PR-to-develop → CI-watch → CodeRabbit-triage → squash-merge
  → worktree-teardown. Invoking it would collapse the four steering prompts into one, and
  it would encode the non-obvious facts (base = `develop`; `openspec archive --yes` does the
  sync; verify bot flags; exclude local settings; force-remove the worktree from the main
  checkout). Next time, prefer `/skill:ship-change` after apply instead of hand-driving the
  git/gh steps.

## 7. Pitfalls & dead ends

- **`openspec archive` aborts on a pre-existing bad main spec.** If archive fails on a
  `## ADDED Requirements` heading or a missing `## Purpose` in a *main* spec, that's
  inherited from a prior archive — normalize the heading to `## Requirements` and add a
  concise `## Purpose`, then re-run. Don't assume your change caused it.
- **`gh pr create --base main` fails** — this repo's default branch is `develop`. Use
  `--base develop`.
- **CodeRabbit "files nested under `archive/`" is a false positive** for archived changes.
  The "never nest under active/archive" rule governs *new active* artifacts; `openspec
  archive` is *designed* to write to `archive/YYYY-MM-DD-<name>/`. `git ls-tree` proves
  hundreds of prior changes live there. Reply and skip; do not move the files.
- **`gh pr merge --delete-branch` local cleanup fails** when `develop` is checked out in
  the main worktree. Delete the remote branch with `git push origin --delete <branch>` and
  remove the worktree with `git worktree remove --force` from the main checkout.
- **A vitest run may need an isolated HOME** — prefix `HOME=$(mktemp -d)` if the first run
  behaves oddly.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a clean worktree/branch; `gh` authed;
knowledge that the base branch is **develop**.

1. `/skill:openspec-apply-change <change>` → minimal code edit + targeted tests.
2. `npx vitest run <test-path>` (add `HOME=$(mktemp -d)` if needed) → green.
3. `npm run build` → clean. Leave any manual visual-check task to the human; don't restart `:8000`.
4. `openspec archive <change> --yes` → syncs delta specs + archives. Fix any inherited main-spec heading/`## Purpose` bug and re-run.
5. Stage only feature files (exclude `.pi/settings.json`), commit, `git push -u origin <branch>`.
6. `gh pr create --base develop --head <branch> --fill` → poll `gh pr checks <n>` to green.
7. Read each CodeRabbit comment; verify against repo reality; reply-and-skip false positives.
8. `gh pr merge <n> --squash --delete-branch`; then `git push origin --delete <branch>` and `git worktree remove --force .worktrees/<name>` from the main checkout.

**Final artifacts produced:** PR #121 squash-merged to `develop` (commit `50d5c21`);
`packages/client/src/components/OpenSpecStepper.tsx` + its `__tests__` updated; change
archived at `openspec/changes/archive/2026-06-14-stepper-compact-done-letters/`; main specs
`openspec-attach-combo` + `openspec-board` synced; branch + worktree removed.

---

_Generated from session `019ec6d1-158f-7abf-bca4-bfe79a69adb7` · `pi-agent-dashboard` · 2026-06-14. Source extract: `/tmp/facts-1784849341-55046.md`._
