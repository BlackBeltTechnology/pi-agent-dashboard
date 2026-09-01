---
session: 019ec574
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [emit-openspec-pending-from-poll]
proposal_excerpt: 'When a new worktree (or any new cwd) appears, the OpenSpec section "pops in" several seconds later with no loading indicator. The three-state loading model and the folder-card spinner already exist and work — the gap…'
---

# How we did it: Emit the OpenSpec pending spinner from the poll path — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was terse — **`rebase to develop`** — but the real objective
arrived one prompt later: **`/skill:openspec-apply-change emit-openspec-pending-from-poll`**.
The genuine goal was to *implement a pre-authored OpenSpec change end-to-end*: a
worktree's OpenSpec section used to "pop in" several seconds after a new cwd
appeared, with no loading spinner, because `pending: true` was only emitted on
browser cold-boot connect — never from the server poll path that actually
discovers a new `openspec/changes` dir. The session's arc was the full landing
pipeline: **rebase → apply the change (TDD) → archive → PR → CI → CodeRabbit fixes
→ merge → clean up the worktree.**

## 2. TL;DR playbook

1. **Rebase safely with a stash guard.** `git stash push -m wip .pi/settings.json`
   → `git rebase origin/develop` → `git stash pop`. The local-only absolute-path
   edit in `.pi/settings.json` must never ride along.
2. **Run `/skill:openspec-apply-change <change>`** and follow its steps: select the
   change, read every context file, read the *actual* source before touching it.
3. **Hunt the shared choke point before coding.** Grep every caller of the poll
   wrapper (`pollDirectoryGated`) — one DRY emit site beats three parallel ones.
4. **TDD first:** write the test file, run it with an ephemeral `HOME=$(mktemp -d)`,
   confirm it fails, then implement `emitPendingIfDiscovered` at the choke point.
5. **Prove regressions are pre-existing.** Re-run the failing suites with your
   change *stashed* to show they fail identically — then say so explicitly.
6. **`openspec validate --strict` → `openspec archive <change> --yes`.** Leave the
   live-manual-verification task unchecked on purpose.
7. **Commit excluding `.pi/settings.json`** (`git add -A && git reset -q .pi/settings.json`),
   push, `gh pr create --base develop`, poll `gh pr checks` in a sleep loop to green.
8. **Triage CodeRabbit line-by-line:** fix the valid findings, add a regression test
   that provably fails without the fix, and **reply-with-reason** on the invalid one.
9. **`gh pr merge --squash --delete-branch`**, then manually delete the remote branch
   and `git worktree remove --force` (the local settings edit needs `--force`).

## 3. How the collaboration unfolded

**Phase 1 — Rebase (Discovery).** The AI noticed an uncommitted `.pi/settings.json`
path edit, stashed *just that file*, rebased onto develop (the branch's two commits
were already merged, so cleanly skipped), and popped the stash back. *Why it worked:*
it never risked committing a machine-local path.

**Phase 2 — Apply the change (Design → TDD).** Under `openspec-apply-change`, the AI
read all context + source, then made the key design call: instead of the locked
proposal's *three* broadcast wrappers each emitting via a helper, it found all three
(periodic tick, `onWatcherFired`, `onDirectoryAdded`) plus a bulk-archive caller all
funnel through **`pollDirectoryGated`** — a single shared choke point. It placed the
emit there, wrote the test first, confirmed 3/5 failed, implemented, got 5/5 green.
*Decision point surfaced, not silent:* it recorded the single-choke-point refinement
in `design.md` and `spec.md` rather than quietly deviating from the locked P2.

**Phase 3 — Regression discipline.** The full server suite showed 19 failures. Rather
than panic, the AI re-ran them with its change stashed, proved they were identical
(pre-existing `doctor-route`, `event-wiring-source-stamp`, plus a jimp/image-fit
version mismatch), and documented that its change introduced *zero* new type errors.

**Phase 4 — Archive + PR + CI.** `openspec validate --strict`, `openspec archive
--yes` (task 4.3 left unchecked for manual test), commit excluding the settings file,
push, PR #117 against develop, then a `sleep`-loop poll of `gh pr checks` until green.

**Phase 5 — CodeRabbit round-trip.** Three findings. The AI assessed each against the
real code: (1) a **valid Major bug** — the direct `pending:true` broadcast bypassed
the wrappers' JSON-diff guard, so a repeated empty poll could suppress the terminal
clear and leave the spinner stuck; fixed with a module `Set` tracking emitted cwds,
OR'd into the broadcast condition. (2) a valid test-coverage gap — added order
assertions + a two-real-ticks fake-timer test, and *verified it fails without the
fix.* (3) an **invalid** minor about artifacts under `archive/` — that's the standard
CLI output; **skipped with a posted reason.** Merge (squash, delete branch), manual
remote-branch delete (gh's cleanup failed because develop is checked out in main),
`git worktree remove --force`.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change emit-openspec-pending-from-poll`.**
  Effective because it names both the skill and the exact change, so the AI needs no
  disambiguation. (The literal first prompt, `rebase to develop`, was just prep.)
- **`Archive it, I will test later`** — a high-leverage one-liner: it explicitly
  releases the AI from the un-runnable manual-verification task, so it archives
  cleanly and leaves 4.3 unchecked instead of stalling.
- **`commit, create PR and monitor CI`** — bundles three steps and authorizes the
  sleep-loop watch; the AI drove it to green unattended.
- **`fix coderabbit review issues`** — short, but unlocked a full triage-fix-verify
  loop. Stronger version: *"triage each CodeRabbit finding; fix valid ones with a
  regression test, reply-with-reason on any you skip."*
- **`mrege PR, delete branch and delete worktree`** (typo and all) — a clear terminal
  instruction; the AI handled the gh-cleanup failure gracefully.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Keep implementing without a stop signal | "Archive it, I will test later" | State up front which tasks are manual-only and to leave them unchecked |
| Wait after apply for next instruction | "commit, create PR and monitor CI" | Authorize the commit→PR→CI chain in the apply prompt itself |
| Treat CodeRabbit findings as all-valid | "fix coderabbit review issues" | Ask for per-finding triage: fix-with-test or skip-with-reason |
| Rely on gh's branch auto-cleanup | (implicit, from the merge prompt) | Expect gh cleanup to fail when the base branch is checked out in main; delete remote branch + worktree manually |

The consistent quality bar the human imposed: **land it fully** — not just code, but
archived spec, green CI, resolved review, and a clean worktree.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing rails
(`openspec-apply-change`, `gh`, `openspec` CLI). But the session demonstrates a
repeatable pattern worth a skill: **"apply-change → ship → CodeRabbit-resolve →
merge-and-clean"**, which the repo already partially captures in `ship-change` /
`ship-it`. The reusable, non-obvious moves are:

- **Ephemeral-HOME vitest** (`HOME=$(mktemp -d) npx vitest run …`) to isolate
  config-sensitive server tests.
- **Stash-guard the local `.pi/settings.json`** on every rebase/commit so the
  machine-local absolute path never lands upstream.
- **Prove-pre-existing-failures by re-running with the change stashed** — turns a
  scary red suite into a documented non-issue.

If this pattern recurs, formalize the CodeRabbit triage step (fix-with-regression-test
vs skip-with-reason) into the ship skill.

## 7. Pitfalls & dead ends

- **Vitest needs a real HOME.** A bare `npx vitest run` misbehaved; the fix was
  `HOME=$(mktemp -d)`. Reach for the ephemeral HOME immediately on server tests.
- **The JSON-diff guard eats terminal broadcasts.** Emitting `pending:true` directly
  bypassed the wrappers' diff guard, so a second identical empty poll skipped the
  clear → **spinner stuck forever.** Route state changes so the terminal clear always
  lands (module `Set` OR'd into the broadcast condition).
- **19 "failures" that aren't yours.** `doctor-route`, `event-wiring-source-stamp`,
  and jimp/`image-fit` type+test errors are pre-existing/environmental — confirm by
  stashing your change, don't chase them.
- **gh auto-cleanup fails on a checked-out base.** `gh pr merge --delete-branch`
  couldn't delete the branch because `develop` was checked out in the main worktree;
  delete the remote branch manually, then `git worktree remove --force`.

## 8. Reproduce it faster — checklist

- [ ] Stash-guard `.pi/settings.json`, rebase onto `origin/develop`, pop.
- [ ] `/skill:openspec-apply-change <change>`; read all context + source first.
- [ ] Grep every caller of the poll wrapper; emit at the single choke point.
- [ ] Write the test, run with `HOME=$(mktemp -d) npx vitest run`, confirm red → implement → green.
- [ ] Re-run any failing suites with your change stashed; document pre-existing failures.
- [ ] `openspec validate --strict` → `openspec archive <change> --yes` (leave manual task unchecked).
- [ ] Commit excluding `.pi/settings.json`; push; `gh pr create --base develop`.
- [ ] Poll `gh pr checks` to green; triage CodeRabbit (fix-with-test / skip-with-reason).
- [ ] `gh pr merge --squash --delete-branch`; manually delete remote branch + `git worktree remove --force`.

**Inputs to have ready:** a pre-authored OpenSpec change name, `gh` authenticated,
write access to `develop`, the worktree checked out. **Final artifacts:** merged
PR #117 into develop; `emitPendingIfDiscovered` + terminal-clear fix in
`packages/server/src/directory-service.ts`; 6 passing tests in
`packages/server/src/__tests__/directory-service-pending-emit.test.ts`; archived
change under `openspec/changes/archive/2026-06-14-emit-openspec-pending-from-poll/`.

---

_Generated from session `019ec574` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: session facts sheet (deterministic extract)._
