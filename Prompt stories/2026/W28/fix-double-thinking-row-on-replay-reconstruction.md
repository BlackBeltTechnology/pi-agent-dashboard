---
session: 019f34e6
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-double-thinking-row-on-replay-reconstruction]
proposal_excerpt: "`develop` CI is red. `CI / npm test` fails 3 client reducer tests, all asserting a single `thinking` row where the reducer now produces two:"
---

# How we did it: Fix the double `thinking` row on replay reconstruction — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

`develop` CI was red: three client reducer tests each asserted exactly one `thinking`
row, but the `event-reducer` was now emitting two. The first prompt was simply
`/skill:openspec-apply-change fix-double-thinking-row-on-replay-reconstruction`.

The **real objective**, once the steering turns landed, was end-to-end: not just fix
the bug, but land it — apply the OpenSpec change with a red→green regression test,
then ship it (archive specs, open a PR against `develop`, get CI green, wait for a
*real* CodeRabbit review, and squash-merge with worktree cleanup).

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` — let the apply skill drive the fix.
2. Reproduce red first: run the 3 failing reducer tests, confirm they fail.
3. Add a regression test that pins the exact bug (streamed thinking + non-live
   `message_end` → **exactly one** thinking row); confirm it goes red.
4. Fix the reducer: replace the `!isLive` guard with a real dedupe that walks back to
   the turn boundary and skips reconstruction if a `role:"thinking"` row already
   exists in the current turn window.
5. Re-run the previously-failing tests + the new regression → all green; run the full
   client suite + `npm run quality:changed`.
6. `use ship-change skill` — verify preconditions, archive + sync specs
   (`openspec archive <name> -y`), commit via a message file, push, open PR.
7. Watch CI (`gh pr checks <pr> --watch`) until green.
8. Do **not** treat a rate-limited CodeRabbit "pass" as a review — wait for the real
   one, re-trigger with `@coderabbitai full review`, poll until "Full review finished."
9. Squash-merge (`gh pr merge <pr> --squash --delete-branch`), then clean up remote
   branch + worktree from the **parent** repo, not the worktree cwd.

## 3. How the collaboration unfolded

**Phase 1 — Apply (red → green).** The AI located the reducer + test files, confirmed
the 3 failures were real, then wrote the regression test *before* the fix and watched
it go red. It replaced the fragile `!isLive` guard with a turn-window dedupe, re-ran
the targeted tests (green) and the full client suite (2990 passed / 3 skipped). It
updated the per-file doc row and marked tasks done. *Why it worked:* strict TDD
ordering — reproduce red, pin the bug in a test, minimal fix, verify green — meant the
root cause was proven, not guessed.

**Phase 2 — Ship gate.** On `use ship-change skill`, the AI ran the full-repo verify
gate. `npm test` surfaced 18 failures in *unrelated* packages (`pi-image-fit`,
`pi-dashboard-server` browse-endpoint). Instead of trusting or panicking, it re-ran
those exact tests on the parent `develop` checkout — they passed there. *Decision
point:* the AI diagnosed the failures as **worktree-environment artifacts** (stale
`node_modules` → `Jimp is not a constructor`) that a clean CI `npm ci` would never
hit, and proceeded.

**Phase 3 — Archive + PR.** Used the `openspec archive <name> -y` CLI to sync spec
deltas and archive the change, committed with a message *file* (to dodge backtick
issues), pushed, and opened PR #248 against `develop`.

**Phase 4 — CI + the CodeRabbit honesty check.** CI went green in 9m14s. CodeRabbit
showed "Review completed" — but the AI caught that it was **rate-limited**: the "pass"
was an ACK, not a review ("Next review available in: 31 minutes"). It stopped and
asked the human rather than merge on a fake-green. *This is the key judgment call.*

**Phase 5 — Real review + merge.** After the human's `coderabbit available now`, the
AI re-triggered `@coderabbitai full review`, polled ~60s until "Full review finished"
(clean, 0 inline threads), then squash-merged. Cleanup hit the expected worktree
collision (its own cwd was deleted); it recovered by finishing cleanup from the
parent repo.

## 4. Prompts that worked

- **Goal prompt:** `/skill:openspec-apply-change fix-double-thinking-row-on-replay-reconstruction`
  — a slash-skill invocation naming the exact change. Effective because it hands the
  whole TDD apply loop to a skill instead of describing the bug by hand.
- **`use ship-change skill`** — a 3-word high-leverage follow-up that switched the AI
  from "fix done" to "land it end-to-end" (archive → PR → CI → merge → cleanup).
- **`Lot of time happens, coderabbit available now`** — unblocked the one thing the AI
  had correctly refused to fake: it resumed and drove the real review to completion.

Stronger goal-prompt for next time: *"Apply openspec change X with a red-first
regression test, then ship-change it; do not merge on a rate-limited CodeRabbit —
wait for a real review."* — bakes the whole intent in so no steering is needed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after the fix ("green, done") | `use ship-change skill` | State "apply **and** ship" in the goal prompt |
| Block on a rate-limited CodeRabbit and ask how to proceed | `coderabbit available now` (after a wait) | Tell it up front: "wait/re-trigger for a real review; a rate-limited pass is not a review" |

Notably the AI **self-corrected** the two most dangerous traps without prompting: it
refused to trust the 18 unrelated worktree test failures (proved them env-only on
parent `develop`), and it refused to treat the rate-limited CodeRabbit ACK as a green
review. Those are the quality bars to preserve.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session ran entirely on existing ones,
which is the point:

- **`openspec-apply-change`** — drove the red→green TDD fix loop (reproduce, pin,
  minimal fix, verify). Invoke it whenever a change has tasks to implement.
- **`ship-change`** — the land-it pipeline: verify gate → archive/sync specs → commit
  → PR → watch CI → real review → squash-merge → cleanup. Invoke once tasks are done.

Worth saving as a memory: **"A rate-limited CodeRabbit 'Review completed' is an ACK,
not a review — re-trigger `@coderabbitai full review` and poll for 'Full review
finished' before merging."** and **"Worktree pre-push test failures are usually stale
`node_modules` artifacts; confirm on parent `develop` before trusting them."**

## 7. Pitfalls & dead ends

- **Stale worktree `node_modules`** → `Jimp is not a constructor` and bogus
  browse-endpoint failures. *If you hit unexplained failures in unrelated packages,
  re-run those exact tests on the parent `develop` checkout before believing them.*
- **Fake-green CodeRabbit** → a rate-limited bot posts "Review completed" without
  reviewing. *Check for "Review limit reached / Next review available in…" before
  merging; wait and re-trigger.*
- **Worktree = session cwd collision** → `gh pr merge --delete-branch` and
  `git worktree remove` fail because the shell's cwd is the directory being deleted.
  *Finish branch/worktree cleanup from the parent repo; recreate the empty dir if the
  Bash tool refuses to launch, then remove it last.*
- **Squash merges leave no merge trace** → local `git branch -d` won't see the branch
  as merged. *Force-delete (`-D`) after confirming the PR is MERGED on remote.*
- **Backticks in commit messages** → write the message to a file and use `-F`.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Reproduce the failing tests red; add a regression test that pins the exact bug; confirm red.
- [ ] Minimal fix; re-run targeted tests + full client suite + `npm run quality:changed` → green.
- [ ] `use ship-change skill`: run verify gate; if unrelated packages fail, prove them green on parent `develop`.
- [ ] `openspec archive <name> -y`; commit via message file; push; open PR against `develop`.
- [ ] `gh pr checks <pr> --watch` until green.
- [ ] Verify CodeRabbit is a **real** review (not rate-limited); re-trigger `@coderabbitai full review` and poll to "Full review finished."
- [ ] `gh pr merge <pr> --squash --delete-branch`; finish branch + worktree cleanup from the parent repo.

**Inputs to have ready:** `gh` auth, the OpenSpec change name, a clean parent
`develop` checkout for cross-checking env-only failures.
**Artifacts produced:** patched `packages/client/src/lib/event-reducer.ts` + regression
test, synced `openspec/specs/event-reducer/spec.md`, archived change, merged PR #248.

---

_Generated from session `019f34e6-9b57-7335-a181-3457262b387e` · `pi-agent-dashboard` · 2026-07-06. Source extract: `/tmp/facts-91033.md`._
