---
session: 019f1615
week: 2026/W27
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [card-gradient-state-animation]
proposal_excerpt: "Session-card state today is signalled by 45° barber-pole stripes that drift and pulse (`card-stripes-running` amber, `card-stripes-unread` cyan, `card-stripes-input` purple). The high-contrast diagonal edges run *unde…"
---

# How we did it: card-gradient-state-animation — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single skill invocation:

```
/skill:openspec-apply-change card-gradient-state-animation
```

The real objective: take an already-drafted OpenSpec change — swap the session
card's distracting 45° barber-pole stripes for a calm **horizontal seamless sweep
gradient** — through the full apply→verify→ship pipeline. The whole thing turned
out to be a **single CSS edit** (`packages/client/src/index.css`) plus the OpenSpec
bookkeeping (tasks, delta spec, archive, sync) and a shipped PR. Total wall time:
~36 minutes, 10/10 tasks, PR #201 merged.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change card-gradient-state-animation` — let the apply skill read `tasks.md`, `design.md`, and the delta spec first.
2. Confirm the design intent (candidate A: horizontal sweep, not the pulse variant) before touching code.
3. Make the **one** CSS edit in `packages/client/src/index.css`: replace diagonal `card-stripes-fx::before` with an over-wide (`left/right:-460px`) `repeating-linear-gradient(90deg, …)` band + flat tint underlay, add a single-period `card-sweep-scroll` `translateX(0→460px)` keyframe (pixel-identical loop = no snap), keep `prefers-reduced-motion` + `:root.app-hidden` pause.
4. Grep for orphaned refs (`card-stripe-scroll`, `card-working-opacity-pulse`) and drop the keyframe the candidate no longer needs. Confirm wiring (`getCardStripeFxClass`, `deriveProposalCardState`) is untouched.
5. Run the **targeted** client tests first (`session-status-visuals`, `OpenSpecBoardView`) — they must pass; a CSS-only diff can't touch server/extension packages.
6. Delegate the docs-row annotation (task 4.3) to a `general-purpose` subagent per the docs protocol; mark all tasks done.
7. `use ship-change skill` → verify gate (`npm run build` + relevant tests), then archive + sync specs.
8. When `openspec archive` fails on renamed requirement headers, add a `## RENAMED Requirements` section to the delta so renames resolve before MODIFIED matches, re-validate, archive.
9. Commit via a **message file** (`git commit -F /tmp/commit-msg.txt`) to avoid backtick eval, push, open PR, watch CI to green.
10. Squash-merge; if the local `--delete-branch` collides with the worktree, verify the merge landed on GitHub anyway, then delete remote branch + remove worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 · Discovery (read the plan).** The AI read `tasks.md`, `design.md`, and
the delta spec, and resolved the openspec skills from the parent repo (worktree
convention) rather than the checkout. *Why it worked:* it anchored on the design's
"candidate A = horizontal sweep" intent before writing a single line, so the CSS
edit was one-shot.

**Phase 2 · The single edit.** One `edit` on `index.css`: swapped keyframes +
`::before` rules for the over-wide sweep band, wired three state alphas
(running/amber `.16`, unread/cyan `.20`, ask_user/purple `.22`), preserved the
reduced-motion + hidden-tab pause rules, and dropped the orphaned
`card-working-opacity-pulse` keyframe. *Decision point:* keep the loop period equal
to the translate distance (460px) so start/end frames are pixel-identical — no snap,
compositor-only animation.

**Phase 3 · Verify locally.** Targeted client tests passed immediately. The full
suite showed 22 failures — all in `pi-image-fit-extension` (jimp `JimpMime`
undefined) and `pi-dashboard-server` (port races). The AI correctly reasoned a
CSS-only client diff **cannot** cause those, flagged them as pre-existing
environmental flakes, and moved on instead of chasing them.

**Phase 4 · Ship (steered).** The user said `use ship-change skill`. The AI ran the
verify gate, then hit the OpenSpec archive on renamed requirements, fixed the delta
with a `## RENAMED Requirements` section, archived, synced, committed via a message
file, pushed, and opened PR #201.

**Phase 5 · CI + review + merge.** CI went green in 8m2s — confirming the local
failures were environment-only. CodeRabbit returned a rate-limited ACK ("Review
limit reached, next review available in 44 minutes"), which the AI recognized as
*not* a real review. Squash-merge landed on GitHub (SHA `f6ee0bb`); the local
`--delete-branch` collided with the worktree, so the AI verified the merge state
remotely and cleaned up branch + worktree from the parent repo.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change card-gradient-state-animation`.
  Effective because the heavy lifting (design decision, task list, delta spec) was
  already captured in the OpenSpec change; the skill just needed to execute it. The
  lesson: **front-load the design into the proposal**, then apply is nearly
  deterministic.
- **High-leverage follow-up** — `use ship-change skill`. Four words that handed off
  the entire archive→commit→PR→CI→merge→cleanup pipeline to a codified skill instead
  of ad-hoc git commands.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation + local verify | "use ship-change skill" | Chain apply→ship in the initial ask when the change is ready to land |
| Treat the full test suite as a hard gate | (self-corrected) reason that CSS-only diffs can't affect server/extension packages | Run targeted tests first; only escalate to full suite for cross-cutting changes |
| Trust CodeRabbit's "pass" | (self-corrected) read the ACK text | Always inspect the review body — a rate-limited ACK is not a review |

Most redirection here was the AI self-correcting; the only human steer was the
explicit ship handoff.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session *consumed* three existing
skills (`openspec-apply-change`, `ship-change`, `openspec-archive-change`) and one
subagent:

- **`general-purpose` subagent — "Annotate file-index-client rows".** Offloaded the
  docs annotation (task 4.3) to an isolated context per the docs protocol, keeping
  the main context focused on the code+ship path. Invoke it whenever a task is
  "update the docs row for X" — it's mechanical and context-cheap to delegate.

Recommendation: the archive-on-renamed-requirements fix (add `## RENAMED
Requirements`) is a recurring OpenSpec papercut worth a one-line note in the
`ship-change` / `openspec-archive-change` skill pitfalls.

## 7. Pitfalls & dead ends

- **`openspec archive` can't match renamed requirement headers.** Symptom: archive
  fails to resolve a MODIFIED body. Fix: add a `## RENAMED Requirements` section to
  the delta so renames resolve *before* the MODIFIED match, then re-validate.
- **22 "failing" tests that aren't yours.** `pi-image-fit-extension` (jimp
  `JimpMime` undefined, ESM resolution) and `pi-dashboard-server` (port-binding
  races) fail environmentally. A CSS-only client diff cannot cause them — don't
  chase them; let CI confirm green.
- **CodeRabbit "pass / 0" can be a rate-limit ACK, not a review.** Read the body:
  "Review limit reached, next review available in 44 minutes." Wait or proceed
  knowingly — don't treat the ACK as a clean review.
- **Backtick eval in commit messages.** Use `git commit -F /tmp/commit-msg.txt`
  (message file) so backticks in the body aren't shell-evaluated.
- **`gh pr merge --delete-branch` collides with the active worktree.** The merge
  still lands on GitHub; verify with `gh pr view --json state,mergeCommit`, then
  delete the remote branch and remove the worktree from the **parent** repo.
- **Removing your own CWD worktree kills the shell.** After `git worktree remove`,
  subsequent commands can't resolve the (now-gone) directory — `cd` to the parent
  repo first, or run cleanup from there.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a completed OpenSpec change (proposal + design + tasks +
delta spec) in a worktree; `gh` authenticated; the parent repo path for skill
resolution and post-merge cleanup.

**Checklist:**
- [ ] `/skill:openspec-apply-change <change>` — read tasks/design/delta first
- [ ] Make the minimal code edit; grep for orphaned CSS refs; confirm wiring untouched
- [ ] Targeted client tests green (`session-status-visuals`, `OpenSpecBoardView`)
- [ ] Delegate docs-row annotation to a subagent; mark all tasks done
- [ ] `use ship-change skill` → build + verify gate
- [ ] If archive fails on renames, add `## RENAMED Requirements`, re-validate, archive
- [ ] Commit via message file; push; open PR; watch CI to green
- [ ] Squash-merge; verify merge on GitHub; delete remote branch + worktree from parent repo

**Final artifacts:**
- `packages/client/src/index.css` (the sole code edit — horizontal sweep gradient)
- `openspec/changes/archive/2026-06-30-card-gradient-state-animation/`
- PR [#201](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/201) → MERGED (squash, SHA `f6ee0bb`)

---

_Generated from session `019f1615-5d7a-7847-b688-fc2eec0d0267` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: session facts sheet (card-gradient-state-animation)._
