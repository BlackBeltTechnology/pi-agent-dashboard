---
session: 019e99d3
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (8 user prompts); large facts sheet (~13056 tok)"
upgrade_status: pending
openspec_changes: [worktree-checkout-existing-branch]
proposal_excerpt: "Today `WorktreeSpawnDialog` has exactly one branch-mode workflow: **fork to new branch**. The user must always type a new branch name; the picker only chooses a *base* to fork from. This is wrong for the common case w…"
---

# How we did it: Implement + ship "check out existing branch" worktree mode — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a small, ambiguous question — *"Is this branch need to implement?"* — about the OpenSpec change `worktree-checkout-existing-branch`. The AI answered decisively (no, the 15 tasks were all unchecked and the source was untouched), and the user's *real* objective crystallized across the next seven steering turns: **fully implement the OpenSpec change end-to-end, verify it in a real browser without disturbing the live dashboard, then archive it, watch CI, merge the PR, and clean up the worktree.** In plain terms: take a proposed-but-unbuilt change from zero to merged-on-`develop`, TDD-first, in an isolated worktree.

The feature itself: `WorktreeSpawnDialog` only supported *fork to new branch* (you must type a new branch name). This change adds a **"Check out existing branch"** mode so users can resume work on an existing local or remote-only branch in an isolated worktree — making `newBranch` optional end-to-end (client → route → server → shared helper).

## 2. TL;DR playbook

1. **Ground the state first.** Before touching code, confirm whether the change is actually implemented: `grep` the required signatures (`newBranch?:`, mode types) + check `origin/develop..HEAD` for commits. Report evidence, not a guess.
2. **Check dependencies.** This change assumed `add-worktree-from-pull-request` landed first. Verify it's archived — if yes, follow the main path (ternary toggle); if not, the §12 fallback. It *was* landed, so widen its `sourceMode: "branch"|"pr"` toggle to a ternary.
3. **Run the apply skill:** `/skill:openspec-apply-change worktree-checkout-existing-branch`. Follow tasks.md in order, TDD.
4. **`npm install` inside the worktree BEFORE running tests** — the worktree has no `node_modules`, so workspace packages resolve to the *main* checkout and your edits silently don't load. This is the #1 time-sink; do it up front.
5. **Implement server→shared→route→client**, running focused vitest per layer. Reconcile spec text against *real* landed code (testids, key names) — adapt to reality, don't invent the spec's assumed shape.
6. **Verify in an isolated dashboard:** build the worktree client, launch a *second* server on non-default ports (8088/9988) with an **isolated `$HOME`** and `--no-tunnel`. Never touch the live 8000/9999 instance.
7. **Archive via the CLI, not by hand:** `openspec archive <change>` auto-syncs delta specs into main specs. If it aborts on a `MODIFIED` requirement that doesn't exist in main, flip it to `ADDED` and re-run.
8. **Ship:** push, `gh pr create --base develop`, poll CI to green, merge with the repo's convention (merge-commit), then clean up the worktree **from the main checkout** (never from inside the worktree you're deleting).

## 3. How the collaboration unfolded

**Phase 1 — Discovery / grounding.** The AI resisted the temptation to just start coding. It grepped the required code signatures, checked commit history, and produced a 4-point evidence list proving the change was *proposed but unimplemented*. It also surfaced a dependency note (does `add-worktree-from-pull-request` need to land first?) and offered two branches instead of silently picking one. **Why it worked:** grounding in file reality turned an ambiguous yes/no into a defensible plan.

**Phase 2 — Reconcile spec vs. reality.** Reading the *landed* PR change revealed its toggle used `sourceMode: "branch"|"pr"` with testids `worktree-source-branch/-pr`, not the `"from-branch"/"from-pr"` radio shape the spec text assumed. The AI chose to widen to `"fork" | "checkout" | "pr"`, keeping the `"pr"` key to avoid gratuitously breaking PR tests. **Decision point:** adapt to real code over literal spec text.

**Phase 3 — TDD implementation, layer by layer.** Server (`git-operations.ts` — `newBranch` optional, checkout git path), shared (`localNameOf` helper, re-exported), route validation, then client (`git-api.ts`, `WorktreeSpawnDialog.tsx` ternary toggle). Focused vitest ran per layer. A real-git test exposed that `git worktree add <path> origin/old` produces a *detached HEAD*, not a tracking branch — so the AI satisfied the spec's **intent** (local branch created) by resolving the local name via `git show-ref --verify refs/heads/<base>` and passing it as the commit-ish.

**Phase 4 — Full-suite + isolated browser verification.** `npm test` (7291 passed; one unrelated image-fit perf flake). Then the AI built the client and stood up a fully isolated second dashboard (ports 8088/9988, isolated `$HOME`, `--no-tunnel`) to smoke-test the built UI — confirming the ternary toggle renders, plain +Worktree defaults to *checkout*, and fork-toggle reveals the new-branch input.

**Phase 5 — Archive, CI, merge, cleanup.** `openspec archive` (with a delta-spec fix), push, CI poll to green, CodeRabbit pass, merge PR #84 via merge-commit, then delete remote branch + remove the worktree from the main checkout. **Decision points came from the user:** "the task is completed, check it" → "archive" → "monitor ci" → "merge PR" → "both" (cleanup).

## 4. Prompts that worked

- **The goal prompt** — *"Is this branch need to implement?"* was weak/ambiguous, but the AI rescued it by answering with evidence. A stronger kickoff: *"Check whether OpenSpec change X is implemented; if not, implement it TDD-first in this worktree and report a plan before coding."*
- **High-leverage follow-ups** (short prompts that unlocked whole phases):
  - `/skill:openspec-apply-change worktree-checkout-existing-branch` — one command drove the entire structured implementation.
  - *"rebuild in isolated environment and test with browser"* — triggered the whole safe-verification pattern.
  - *"the task is completed, check it"* — forced a completion audit that caught task 14 still unchecked.
  - *"monitor ci"*, *"merge PR"*, *"both"* — terse, unambiguous phase advances.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation and ask "want me to verify?" | *"rebuild in isolated environment and test with browser"* | State up front: implement **and** browser-verify in an isolated instance before reporting done. |
| Leave a manual/QA task (14) unchecked while claiming completeness | *"the task is completed, check it"* | Run a completion audit against tasks.md before declaring done. |
| Offer choices and wait at each phase boundary | *"monitor ci"* → *"merge PR"* → *"both"* | Pre-authorize the full ship chain (archive → CI → merge → cleanup) when the user says "ship it". |
| Risk disturbing the live dashboard | (implied by "isolated environment") | Always use non-default ports + isolated `$HOME` + `--no-tunnel` for verification. |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were persisted this session, but the workflow leaned on several existing ones and revealed a clearly repeatable pattern:

- **`/skill:openspec-apply-change`** and **`/skill:openspec-archive-change`** — drove the structured, tasks.md-ordered implementation and the delta-spec-syncing archive. Invoke these for any OpenSpec change lifecycle.
- **Recommended skill to create:** *"isolated-dashboard-browser-verification"* — capturing the exact recipe (build worktree client → second server on 8088/9988 → isolated `$HOME` → `--no-tunnel` → pre-seed a pinned folder → quiet the OpenSpec poll → drive via testids). This removes ~30 min of re-derivation and is reusable for every client-side change. *(A project skill `isolated-ui-verification` already exists and should be the first stop.)*

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** Tests silently ran against the *main* checkout's copy of workspace packages, so `localNameOf` "didn't exist." Fix: `npm install` inside the worktree first. **If a new export isn't found in a worktree, run `npm install` before debugging further.**
- **`git worktree add <path> origin/x` → detached HEAD**, not a tracking branch. Git only DWIMs to a tracking branch from the *bare* name. Resolve the local name (`git show-ref --verify refs/heads/<base>`) and pass that as the commit-ish.
- **Changing the dialog default broke ~14 fork-mode tests** that assumed a new-branch input renders by default. Expected fallout of a default-mode change — update the tests to explicitly select fork mode.
- **The subagent for docs edits failed** (model registry unavailable), so the AI applied the caveman-style file-index rows directly per protocol.
- **`openspec archive` aborted cleanly** because a delta requirement was marked `MODIFIED` but didn't exist in the main spec (the landed PR folded it into a scenario). Flip it to `ADDED`, re-validate, re-run.
- **The isolated browser blanked intermittently** under the heavy 73-change OpenSpec poll storm (24s ticks + WS churn) — environmental, always recovered on reload. Quiet the poll interval before driving the UI.
- **Never remove the worktree from inside it.** Run worktree removal + branch deletion from the **main checkout**; the session's cwd vanishes otherwise (it did — the session ended in a `cwdMissing` state).

## 8. Reproduce it faster — checklist

- [ ] Ground: grep required signatures + `origin/develop..HEAD`; report evidence, not a guess.
- [ ] Check the dependency change is archived → pick main path vs. fallback.
- [ ] `/skill:openspec-apply-change <change>`; follow tasks.md TDD.
- [ ] **`npm install` inside the worktree** before any test run.
- [ ] Implement server → shared → route → client; focused vitest per layer; reconcile spec vs. real testids/keys.
- [ ] `npm test` full suite; note pre-existing flakes.
- [ ] Isolated verify: build client → second server on 8088/9988 + isolated `$HOME` + `--no-tunnel`; drive via testids.
- [ ] Completion audit against tasks.md (catch manual/QA tasks).
- [ ] `openspec archive <change>` (flip stray `MODIFIED`→`ADDED` if it aborts).
- [ ] Push → `gh pr create --base develop` → poll CI green → merge (merge-commit).
- [ ] Clean up worktree + branches **from the main checkout**.

**Key inputs to have ready:** write access to the repo, the OpenSpec change name, a running live dashboard on 8000/9999 (to stay clear of), `gh` authenticated.

**Final artifacts produced:** feature commits `fae6ff41` → `2c15981f` → `2e9668ec`, merge commit `c3707c133` on `develop`, PR #84 (merged), archived change `openspec/changes/archive/2026-06-06-worktree-checkout-existing-branch/`, synced main specs (`git-operations-api`, `worktree-spawn-dialog`).

---

_Generated from session `019e99d3-a049-758b-869b-b341308cce85` · `pi-agent-dashboard` · 2026-06-06. Source extract: `facts.XXXXXX.md.LMH5yPPEcp`._
