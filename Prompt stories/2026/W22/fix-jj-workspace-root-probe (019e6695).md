---
session: 019e6695
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-jj-workspace-root-probe]
---

# How we did it: fix-jj-workspace-root-probe — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was:

> "Proposal: fix-jj-workspace-root-probe — git worktree addresses similar problems.
> Can proposal update with the patterns used in git worktree?"

The literal ask was a **spec refinement**: mine the mature `git worktree` design for
patterns and fold them into an existing OpenSpec proposal (`fix-jj-workspace-root-probe`).
The *real* objective, revealed as the session unfolded, was bigger: correctly derive
**the parent repo root** for a Jujutsu (`jj`) non-default workspace so that dashboard
session cards group under their parent folder — then implement it, test it, and land
it as a clean stacked PR. The proposal's original premise (`jj root` gives the parent
root) turned out to be *false*, so the session became as much about **discovering the
right mechanism** as about writing code.

## 2. TL;DR playbook

1. **Frame the analogy first.** Ask the AI to map the target problem onto a
   battle-tested primitive (`git worktree`) in a table before editing anything —
   concern → git pattern → jj equivalent.
2. **Amend the spec, not the code, in phase 1.** Update `design.md` + `tasks.md`
   with the borrowed patterns; run `openspec validate <change>` after every edit.
3. **Commit the spec change on its own** with `jj split` and push a bookmark; open a
   PR *targeting the right base* (verify base immediately — see §5).
4. **Run `openspec-apply-change`** to implement. Let the AI pause the moment a task
   is non-implementable rather than forcing the design.
5. **Verify every borrowed assumption against the real tool** (`jj workspace list`,
   `jj root --help`) before trusting it — the git analog can be a false friend.
6. **When the mechanism is wrong, correct the spec inline** (design/spec/proposal/tasks),
   then implement the *verified* mechanism (`.jj/repo` filesystem read).
7. **Prove it with a live integration test** (real `jj git init --colocate` +
   `jj workspace add` in `/tmp`), plus the symlink/`/private/tmp` canonicalization case.
8. **Delegate `docs/` writes to a subagent** in caveman style; run the full test
   sweep; `jj split` the implementation into its own commit; push; confirm PR commit count.

## 3. How the collaboration unfolded

**Phase A — Analogy & spec refinement (01:25–01:44).** The AI opened with a
concern→pattern→jj-equivalent table lifted from `git worktree`, called out what the
proposal already got right, then edited `design.md` (new "Prior art — git worktree"
section, expanded Decision 2 into a three-step fallback chain, new Decision 4
"canonicalize before emit") and `tasks.md`. **Why it worked:** grounding the design in
a mature primitive gave a vocabulary and a checklist for free. **Decision point:** the
human let the AI drive the analogy but the AI over-trusted it (see §5/§7).

**Phase B — Commit & PR hygiene (01:44–01:53).** The human steered: "commit changes
except fix reload and create a PR", then "add to PR the related commits only". The AI
detected the repo was **jj-colocated in detached HEAD**, so it used `jj split` (never
raw `git commit`), created bookmark `fix-jj-workspace-root-probe-design`, and opened
PR #37. It then discovered the PR base was wrong and that PR #36 had been squash-merged,
orphaning 17 intermediate commits — and recovered with `jj git fetch` + `jj rebase -r
<commit> -d develop@origin` to leave exactly **1 clean commit**.

**Phase C — Apply & first design failure (01:53–01:58).** Running
`openspec-apply-change`, the AI verified step 2 of its own fallback chain against real
`jj workspace list` output and found **it emits no paths** — the git-worktree
`--porcelain` analog was a false friend. It *paused implementation*, updated the spec
to drop the unimplementable step, and continued.

**Phase D — Second (fatal) design failure & real fix (01:58–02:38).** Mid-implementation
the live integration test failed for the non-default workspace. `jj root --help` revealed
`jj root` is **literally a shortcut for `jj workspace root`** — the entire premise of
Decision 1 was wrong. The AI paused again, weighed `jj workspace root --name default`
(subprocess) vs reading `.jj/repo` (filesystem), chose the filesystem read, rewrote
`design.md`/`spec.md`/`proposal.md`/`tasks.md`, reverted the misguided `JJ_REPO_ROOT`
recipe, implemented `deriveJjRepoRoot` in `vcs-info.ts`, and got **50 tests green**
including the live and symlink cases.

**Phase E — Docs, sweep & land (02:38–02:55).** Per the docs-update protocol, the AI
reverted its own `architecture.md` edit and **delegated the `docs/` write to a
general-purpose subagent** in caveman style. It ran the full sweep (**6,340 tests pass,
0 failed**), split the implementation into commit `2302fdbf`, kept the unrelated
`plans/jj-parallel-work.md` untouched, and pushed — PR #37 ended with **2 clean commits**.

## 4. Prompts that worked

- **The goal prompt** ("git worktree addresses similar problems. Can proposal update
  with the patterns used in git worktree?"). *Why effective:* it named a concrete,
  mature reference system to mine — far stronger than "improve the proposal." A future
  operator should also add the acceptance bar: *"…and verify each borrowed pattern is
  actually implementable in jj before committing to it."*
- **"commit changes except fix reload and create a PR"** — a scope-bounded landing
  instruction ("except X") that kept unrelated work out of the commit.
- **"I would like to add to PR the related commits only"** — a high-leverage one-liner
  that triggered the whole rebase-off-squash-merge recovery.
- **Pasting the `openspec-apply-change` skill** — invoking the skill explicitly moved
  from spec to implementation with the right guardrails.
- **"stack a PR on develop"** — a terminal directive that set the final PR topology.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the `git worktree` analogy verbatim (assume `jj workspace list` carries paths, assume `jj root` = parent root) | Implementation + `--help` reproduced the truth and forced two spec rewrites | State up front: **verify each borrowed primitive against the real tool's actual output before designing on it** |
| Create the PR against the wrong base (`develop` instead of the intended stack target) | "add the related commits only" → AI caught base mismatch + squash-merge orphaning | Verify PR base with `gh pr view <n> --json baseRefName` *immediately* after `gh pr create` |
| Reach for raw `git commit` | AI self-corrected: repo is jj-colocated/detached-HEAD, use `jj split` | Encode "jj-colocated → never raw git commit; use jj split/bookmark" as a repo rule/memory |
| Edit `docs/architecture.md` directly | Docs-update protocol → revert + delegate to subagent in caveman style | Route every `docs/` prose write through a DocScribe/general-purpose subagent |
| Keep unrelated files in the commit | "except fix reload"; later kept `plans/jj-parallel-work.md` out | Use `jj split` to isolate exactly the intended files before pushing |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session, but the workflow is highly
repeatable and *should* be captured:

- **Recommended skill — "verify-borrowed-primitive-before-design":** before folding a
  pattern from tool A (git) into tool B (jj), run tool B's real command + `--help`,
  capture the actual output shape, and only then design. This session lost ~40 minutes
  and two spec rewrites to skipping that step.
- **Existing skill leveraged — `openspec-apply-change`:** invoked explicitly to drive
  spec→implementation with pause-on-non-implementable discipline. Effective because it
  gave the AI license to *stop and re-spec* instead of forcing a broken design.
- **Pattern worth a memory — jj-colocated PR hygiene:** `jj split` for atomic commits,
  `jj bookmark create/set` + `jj git push --bookmark`, and `jj rebase -r <c> -d
  develop@origin` to recover after an upstream squash-merge orphans your stack.

## 7. Pitfalls & dead ends

- **`jj workspace list` has no paths.** Its format is `<name>: <change-id> <commit-id>
  <markers> <desc>`. If you copied the `git worktree list --porcelain` idea, it won't
  parse — abandon path-from-list.
- **`jj root` is a shortcut for `jj workspace root`.** Both return the *current*
  workspace root, never the parent. Do not build a "parent root" derivation on `jj root`.
- **The real mechanism is a filesystem read of `.jj/repo`:** in a linked workspace it's
  a *file* pointing at the main `.jj`; in the default workspace it's a *directory*.
  Derive the parent root from that (mirrors reading `.git`-as-file in a git worktree).
- **Squash-merge orphans your stack.** After the base PR is squash-merged, `jj git
  fetch` then `jj rebase -r <your-commit> -d develop@origin` to replant just your commit.
- **PR base defaults can surprise you** (`gh pr create` landed base=`develop`
  unexpectedly). Always re-check `baseRefName` right after creation.
- **macOS `/tmp` ↔ `/private/tmp`** symlink divergence breaks naive string path
  compares — `realpath`/canonicalize before comparing (Decision 4 survived both rewrites).

## 8. Reproduce it faster — checklist

- [ ] Name the mature reference system in the goal prompt **and** require verification
      of each borrowed primitive against the real tool.
- [ ] `openspec validate <change>` after every spec edit.
- [ ] Confirm repo VCS mode first (`jj status`); jj-colocated → use `jj split`, never
      raw `git commit`.
- [ ] `gh pr create` → immediately `gh pr view <n> --json baseRefName` to confirm base.
- [ ] Run `openspec-apply-change`; let it pause and re-spec on any non-implementable task.
- [ ] Verify mechanism live: `jj git init --colocate` + `jj workspace add` in a scratch
      dir; test parent-root derivation + symlink/`/private/tmp` canonicalization.
- [ ] Delegate `docs/` writes to a subagent (caveman style); revert any direct edits.
- [ ] Full sweep (`HOME=$(mktemp -d) npm test`); expect 0 failed before landing.
- [ ] `jj split` the implementation into its own commit, keep unrelated files out,
      push bookmark, confirm final PR commit count.

**Key inputs to have ready:** the OpenSpec change name (`fix-jj-workspace-root-probe`),
`gh` auth, `jj` installed, a scratch dir for the live integration test.

**Final artifacts produced:** `packages/shared/src/platform/jj.ts`,
`packages/extension/src/vcs-info.ts` (`deriveJjRepoRoot`),
`packages/extension/src/__tests__/vcs-info-jj-probe.test.ts` (+ sibling tests),
corrected `design.md`/`spec.md`/`proposal.md`/`tasks.md`, `docs/architecture.md`;
PR #37 with 2 commits (`767927c1` spec, `2302fdbf` implementation).

---

_Generated from session `019e6695-51b0-7c4e-af90-368fd3e3ccf3` · `pi-agent-dashboard` · 2026-05-27. Source extract: `facts-XXXXXX.4WsvXhSZUX`._
