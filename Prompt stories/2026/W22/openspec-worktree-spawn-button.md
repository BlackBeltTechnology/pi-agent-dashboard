---
session: 019e78d2
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (12 user prompts)"
upgrade_status: pending
openspec_changes: [openspec-worktree-spawn-button]
proposal_excerpt: "When a user is working through an OpenSpec change attached to a folder, the natural next action is often \"give this change its own branch + working tree so I can iterate without disturbing the main checkout.\" Today th…"
---

# How we did it: Rescue a red CI run and reconcile OpenSpec drift for the worktree-spawn-button change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The first prompt was terse:

> "the proposal is: openspec-worktree-spawn-button - ci errors presented: https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/26683373448."

The **real** objective, once the steering turns clarified it: make a red CI run
green for the `openspec-worktree-spawn-button` PR **without amputating supported
platforms**, then reconcile the OpenSpec paper trail (proposal / design / tasks /
delta specs) that had drifted out of sync because four commits landed *after* the
change was archived mid-PR. It ended as a full land-and-archive cycle: fix CI →
sync specs → restore the active change dir for the stepper → apply remaining tasks
→ push → monitor CI to green → archive onto develop with `[ci skip]`.

## 2. TL;DR playbook

1. **Read the failing run first, not the code.** Open the CI URL; identify each red
   job and trace every failure to a single root commit (`git log --oneline`,
   `git show <sha>`). Here both failures came from one commit that added a Node
   engines guard.
2. **Diagnose before you delete.** When a guard refuses a platform (Node 25),
   confirm whether the platform actually breaks — the CI matrix history is the
   smoking gun. It had smoked Node 25 green for weeks, so the guard, not Node 25,
   was wrong.
3. **Fix at the source, not the symptom.** Bump `engines.node` cap (`<25` → `<26`)
   so the predicate, the message text, the test arms, and both CI matrices move in
   lockstep — instead of dropping Node 25 from CI.
4. **Reconcile the OpenSpec drift.** Fold post-archive behavior (engines guard,
   orphan cleanup) into the archived change dir AND the main `openspec/specs/`
   location; restore proposal/design/tasks into the *active* dir so the stepper UI
   shows all four steps populated.
5. **Commit in independently-revertable units.** One commit per logical concern
   (CI fix / spec sync / stepper restore / task ticks / engines bump).
6. **Verify locally, then push.** `openspec validate <change>`, targeted
   `vitest run` on the guard test, full `npm test` for regressions.
7. **Push, then poll CI to conclusion** with a bounded `gh run view` loop; confirm
   every Node-25 job is green.
8. **Archive last**, onto `develop` with `[ci skip]` for a docs-only reorg, and
   clean up the stranded branch.

## 3. How the collaboration unfolded

**Phase 1 — Diagnose the red run (Discovery).** The AI opened the run, read both
failures, and traced them to commit `63a8d531` (`feat(node-guard): refuse server
start on Node outside engines range`). Failure A: a `no-managed-dir-reference` lint
tripped on advisory `~/.pi-dashboard/...` help-text in `node-guard.ts`. Failure B:
`standalone-install-smoke` refused to boot on Node 25 (linux ×2 + windows).
*Why it worked:* every symptom collapsed to one root commit, so the fix surface was
tiny.

**Phase 2 — First (wrong) fix.** The AI's initial move: allowlist the help-text
line, and **drop Node 25 from both smoke matrices** to match the new `<25` engines
cap. This is where the human intervened (see §5).

**Phase 3 — Reconcile OpenSpec drift (Design).** The human flagged that "the
proposal is missing parts which was OK earlier." The AI discovered the change had
been **archived mid-PR** (commit `16c84ba6`), and four commits landed afterward
without updating the archived spec. It folded the new `server-startup-node-version-guard`
capability into the archive, synced it into main `openspec/specs/`, created a
`design.md`, and — prompted by a screenshot of the stepper — restored
proposal/design/tasks into the *active* dir so the UI badges filled in.

**Phase 4 — The real fix (course correction).** The human refused to drop Node 25.
The AI audited everything tied to the `<25` cap, then bumped `engines.node` to
`<26`: the guard now mirrors a real npm constraint (Node 26+), Node 25 is fully
supported, and both CI matrices were restored to `[22, 24, 25]`. It updated the
predicate, message text, test arms, spec scenarios, and design history in lockstep.

**Phase 5 — Apply remaining tasks + verify.** Ran `openspec-apply-change`; found
§6 orphan-cleanup tasks were already shipped (in `070fb2e2`) but unticked because
the archive snapshotted them too early. Ticked only the implemented tasks; left
manual-verification (8.5, 8.6) and a forward-audit (9.7) unticked. Full suite:
6743 passed / 19 skipped / 0 failed.

**Phase 6 — Push, monitor, archive.** Pushed the five-commit stack, rewrote the PR
body to tell the full story, polled CI to green (all three Node-25 jobs passed),
then archived the change onto develop with `[ci skip]` and removed the stranded
branch.

## 4. Prompts that worked

- **Goal prompt** — "the proposal is: X - ci errors: <run URL>." Effective because
  it names the change *and* hands over the exact failing run. A stronger version
  would add the intent: *"diagnose and fix this run; don't drop supported
  platforms without proof they're broken."*
- **"But earlier it worked with node 25. What happened?"** — the single
  highest-leverage prompt. It forced a root-cause audit that overturned the AI's
  first fix. Domain memory ("the matrix worked before") beat the AI's local
  reasoning.
- **"Do not drop node 25. Fix it. It may was a local nvm problem for spawn,
  because the matrix worked earlier well."** — a precise, hypothesis-carrying
  correction. It gave the AI both the constraint (keep Node 25) *and* the likely
  root cause (nvm subprocess-PATH artifact, not a real engines break).
- **"separated commit"** — two words that enforced independently-revertable commit
  hygiene.
- **"commit to develop with '[ci skip]'"** — precise final instruction for a
  docs-only reorg.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Fix a red matrix by **removing the failing platform** (drop Node 25) | "Do not drop node 25. Fix it… the matrix worked earlier well." | State up front: *treat a passing-history platform as correct; fix the guard, not the coverage.* |
| Trust the guard's stated intent over CI evidence | "But earlier it worked with node 25. What happened?" | Check matrix/run history before accepting any "this platform is unsupported" claim. |
| Leave OpenSpec drift implicit | "the openspec proposal missing some parts - which was ok earlier" + a stepper screenshot | Audit archive vs. post-archive commits whenever a PR archived mid-flight. |
| Batch unrelated changes | "separated commit" | Default to one commit per logical concern; make each independently revertable. |
| Tick tasks that were only auto-ticked by the UI | (the user had confirmed 8.5/8.6/9.7 unverified) | An honest archive reflects reality — revert false ticks before archiving. |

Scope expansions the human imposed: reconcile the *entire* OpenSpec paper trail (not
just CI), keep the git-operations-api orphan-cleanup sync in mind, and finish with a
clean archive on develop.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created in this session. The workflow leaned on
existing project skills (`openspec-apply-change`, `openspec-archive-change`) and the
`gh` CLI.

**Skill that should exist:** *ci-guard-vs-platform-drop* — a decision procedure for
"a guard/engines cap is failing a CI matrix job." Steps: (1) trace the failure to
its introducing commit; (2) check whether the platform has passing history — if yes,
the guard is over-broad; (3) fix at the source (bump the cap / narrow the predicate)
and move predicate + message + tests + matrices in lockstep; (4) never drop a
historically-green platform to satisfy a new guard. This session *is* the reference
implementation; capturing it would remove the wrong-first-fix detour.

## 7. Pitfalls & dead ends

- **Wrong-first-fix: dropping Node 25.** Cost a full extra fix cycle (commit
  `2c34cdbf` had to be walked back by `84726186`). Avoid by checking CI history
  before removing a platform.
- **`ctx_execute` ran from the wrong tree.** Early file reads showed
  proposal.md/tasks.md content that didn't exist on the PR branch — they came from
  the main `develop` checkout, which lacked the archive commit. *If file contents
  contradict the branch, confirm which working tree the command ran in.*
- **Stale test-log reads.** `grep` on the vitest log showed a transient "1 failed"
  mid-run; the final summary was 0 failed. *Trust the final summary line, not
  interim output.* (Used `strings`/`grep 'Test Files|Tests'` to confirm.)
- **UI auto-ticked tasks.** The openspec stepper silently ticked 8.5/8.6/9.7 between
  prompts; the AI had to revert them for an honest archive.
- **Archived against a merged PR.** PR #46 merged while the archive commit was being
  prepared, stranding it on a recreated branch. Recovered by cherry-picking the
  archive onto develop with `[ci skip]` and deleting the stranded branch.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing CI run URL, the OpenSpec change name, `gh` CLI
authenticated, the worktree checked out on the PR branch.

- [ ] Open the run; list red jobs; trace each to one root commit.
- [ ] For any platform-refusal failure, check the platform's CI history *before*
      dropping it. Passing history ⇒ fix the guard, not the matrix.
- [ ] Fix at the source (engines cap / predicate) and move predicate + message +
      tests + CI matrices in lockstep.
- [ ] Audit OpenSpec: archive vs. post-archive commits; fold missing behavior into
      archive **and** `openspec/specs/`; restore proposal/design/tasks into the
      active dir for the stepper.
- [ ] Commit one logical concern per commit (independently revertable).
- [ ] Verify: `openspec validate <change>`, targeted `vitest run <guard test>`,
      full `npm test`.
- [ ] Push; rewrite the PR body to tell the full story; poll CI to green with a
      bounded `gh run view` loop.
- [ ] Archive last onto develop with `[ci skip]`; delete any stranded branch.

**Final artifacts produced:**
- `packages/server/src/node-guard.ts` (`<26` cap), `packages/server/src/__tests__/node-guard.test.ts`
- `.github/workflows/ci.yml` (matrix restored to `[22, 24, 25]`)
- `openspec/specs/server-startup-node-version-guard/spec.md` + `openspec/specs/git-operations-api/spec.md` (orphan-cleanup requirement)
- `openspec/changes/archive/2026-05-30-openspec-worktree-spawn-button/` (final archive)
- PR #46 merged at `47c5d7d4`; develop archive commit `f9b92213 [ci skip]`

---

_Generated from session `019e78d2-316c-7f46-9e78-b8a1c85b426e` · `pi-agent-dashboard` · 2026-05-30. Source extract: session facts for openspec-worktree-spawn-button._
