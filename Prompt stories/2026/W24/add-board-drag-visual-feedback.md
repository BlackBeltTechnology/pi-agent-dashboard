---
session: 019ec6b3
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [add-board-drag-visual-feedback]
proposal_excerpt: "Drag-and-drop on the full-page OpenSpec board (`/folder/:encodedCwd/openspec`, `packages/client/src/components/OpenSpecBoardView.tsx`) **works** — cards reassign groups and reorder, columns reorder, everything persist…"
---

# How we did it: Add drag visual feedback to the OpenSpec board — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation: `/skill:openspec-apply-change
add-board-drag-visual-feedback`. The real objective, spelled out in the change's
proposal, was purely cosmetic: the OpenSpec board's drag-and-drop **already worked**
(cards reassign/reorder, columns reorder, everything persists) — what it lacked was
*visual feedback* during a drag. Cards needed a grab cursor, dragging needed a
pointer-following preview chip, and drop targets needed a highlight. The whole change
was additive to the render path with **drag behavior untouched**. The session then rode
the full landing pipeline: apply → archive → commit → PR → CI → CodeRabbit → merge → clean up.

## 2. TL;DR playbook

1. Kick off with the skill: `/skill:openspec-apply-change add-board-drag-visual-feedback`.
   Let the AI read the target component and the existing tests first.
2. Implement all three additive feedback layers in one component
   (`OpenSpecBoardView.tsx`): `cursor-grab active:cursor-grabbing` on the card root; a
   `<DragOverlay>` + lightweight `DragChip` driven by existing `activeDrag` state; and a
   `ring-2 ring-inset ring-blue-500/60` highlight from the previously-discarded `isOver`
   of `useDroppable`.
3. Add a **feasible** test — assert the static grab-cursor class, not the mid-drag chip
   (jsdom can't simulate the pointer-follow overlay). Run vitest with a throwaway
   `HOME=$(mktemp -d)`.
4. Verify: component tests green, `tsc --noEmit`, then a full `npm run build`. Ignore the
   pre-existing project-reference tsc config error unrelated to your file.
5. Archive: `/skill:openspec-archive-change`. Sync the delta spec into the main spec via a
   subagent (skill mandates it), then confirm the new scenarios landed before archiving.
6. Commit only your files — **stage explicitly**, leaving the local `.pi/settings.json`
   path edit unstaged. `commit, create PR and monitor CI`.
7. Push, `gh pr create --base develop`, write the PR body to a **file** (`--body-file`) to
   dodge heredoc backtick breakage. `gh run watch` to green.
8. `fix coderabbit issues` → read the actual review; if it approved cleanly, say so and
   change nothing. `merge PR, delete branch and delete worktree` → squash-merge, then
   `git worktree remove --force` from the **main repo** (not from inside the worktree).

## 3. How the collaboration unfolded

**Phase 1 — Apply (implement the feedback).** The AI read `OpenSpecBoardView.tsx` and the
existing test file, then made all edits in one pass: grab cursor on `ProposalCard`, a
`DragOverlay` + `DragChip` inside `<DndContext>`, and the drop-zone ring in `BoardColumn`.
The winning design decision: the chip renders a *cheap* preview (name + state pill / color
dot + name) rather than the heavy `ProposalCard` subtree, keeping the drag at 60fps. It
then added one static test, ran the 13-test suite green, typechecked, and did a full build.

**Phase 2 — Archive (sync specs).** Triggered by `/skill:openspec-archive-change`. The AI
diffed the delta spec against the main `openspec-board` spec, identified the two modified
requirements and three new scenarios, then — per the skill — ran the spec sync through a
`general-purpose` subagent, verified all three scenarios appeared in the main spec, and
archived to `openspec/changes/archive/2026-06-14-add-board-drag-visual-feedback/`. It
correctly flagged the optional `design` artifact as `ready` (never authored) and non-blocking.

**Phase 3 — Commit + PR + CI.** On `commit, create PR and monitor CI`, the AI first
inspected `git status`, noticed the unrelated `.pi/settings.json` path edit, and
deliberately excluded it by staging files explicitly. It re-ran tests, committed, pushed,
created PR #119 against `develop`, and used `gh run watch` to block until CI was green (7m19s).

**Phase 4 — Review + merge + cleanup.** `fix coderabbit issues` prompted a real fetch of
the CodeRabbit review — which had **no actionable findings** (5/5 pre-merge checks passed).
The AI reported "nothing to change" instead of inventing fixes. `merge PR, delete branch and
delete worktree` → squash-merge (matching repo convention), then remove the worktree with
`--force` from the main repo, discarding only the intentional local settings edit.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-board-drag-visual-feedback`. A
  bare skill invocation works here because the *proposal* already carried the full spec
  (what works, what's missing, exact file path). The skill + proposal do the heavy lifting;
  no prose brief needed.
- **`commit, create PR and monitor CI`** — high-leverage: one short line chained four
  actions and, crucially, "monitor CI" made the AI *block on* `gh run watch` rather than
  fire-and-forget.
- **`fix coderabbit issues`** — effective precisely because the AI treated it as "check
  whether there are any," not "manufacture changes." A good guardrail prompt would add:
  "only fix real findings; if the review is clean, say so."
- **`merge PR, delete branch and delete worktree`** — an explicit end-to-end cleanup
  instruction that left no dangling worktree/branch. Reuse this exact phrasing to close out.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation | `/skill:openspec-archive-change` as a separate turn | State up front: "apply, then archive + sync specs" as one goal |
| Treat commit/PR/CI as separate asks | `commit, create PR and monitor CI` in one line | Chain the landing steps in the kickoff so the AI plans the whole pipeline |
| Potentially fabricate review fixes | `fix coderabbit issues` (AI correctly found none) | Add "only fix actionable findings; report clean if none" |
| Leave the worktree/branch dangling | `merge PR, delete branch and delete worktree` | Make cleanup an explicit closing instruction every time |

The session needed **five prompts** because each landing stage (apply / archive / PR /
review / merge) was a separate turn. A future operator can collapse most of this by stating
the full pipeline in the kickoff.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session was a straight application of the
existing OpenSpec landing skills. The reusable assets it *exercised*:

- **`openspec-apply-change`** — turns a proposal's tasks into surgical edits + tests. Invoke
  when a change proposal is ready to implement.
- **`openspec-archive-change`** — archives a completed change and, via a subagent, syncs the
  delta spec into the main spec so `openspec/specs/*` stays the source of truth. Invoke once
  tasks are complete and verified.
- **Spec-sync subagent** (`general-purpose`) — isolates the delta→main spec merge so it
  doesn't pollute the main context; the skill mandates delegating it.

The chained landing sequence (apply → archive → commit → PR → CI-watch → review → merge →
worktree cleanup) is itself repeatable — this repo already captures it as the `ship-change`
/ `ship-it` skills; prefer those to collapse the five manual turns into one.

## 7. Pitfalls & dead ends

- **jsdom can't simulate the drag overlay** — the chip only renders mid-drag. Don't try to
  assert it; assert the static grab-cursor class instead (feasible with the harness).
- **Pre-existing tsc project-reference error** — `tsc --noEmit -p packages/client/tsconfig.json`
  emits a config error unrelated to your file. Confirm there are no errors *in your component*
  and move on; don't chase it.
- **Heredoc PR body breaks on backticks** — `gh pr create --body "$(...)"` fails when the
  body contains backticks. Write the body to a file and use `--body-file` instead.
- **`gh pr merge --squash --delete-branch` local-checkout step fails in a worktree** — the
  remote merge still succeeds; gh's local `develop` checkout errors because `develop` is
  held by the main worktree. Verify PR state (`MERGED`) directly instead of trusting gh's exit.
- **Can't remove the worktree you're standing in** — run `git worktree remove --force` from
  the **main repo**, and expect `--force` to be needed to discard the intentional local
  `.pi/settings.json` edit.
- **Unrelated local settings edit** — `.pi/settings.json` carried an env-specific path change;
  stage files explicitly so it never lands in the commit.

## 8. Reproduce it faster — checklist

- [ ] Proposal exists at `openspec/changes/<name>/` with tasks + delta spec.
- [ ] `/skill:openspec-apply-change <name>` — implement additive render-layer changes only;
      keep drag behavior untouched.
- [ ] Add a **feasible** test (static class assertion, not mid-drag); `HOME=$(mktemp -d) npx
      vitest run <test>`; `tsc --noEmit`; `npm run build`.
- [ ] `/skill:openspec-archive-change <name>` — sync delta→main spec via subagent, verify
      scenarios, archive.
- [ ] Stage YOUR files explicitly (leave `.pi/settings.json` unstaged); commit.
- [ ] `gh pr create --base develop --body-file <file>`; `gh run watch` to green.
- [ ] Read the CodeRabbit review; fix only real findings, else report clean.
- [ ] `gh pr merge <#> --squash --delete-branch`; verify `MERGED`; then from the **main repo**
      `git worktree remove --force .worktrees/<name>` + `git branch -D <branch>`.

**Key inputs:** an OpenSpec change with a ready proposal; `gh` authenticated; repo default
branch `develop`. **Artifacts produced:** edits to `packages/client/src/components/OpenSpecBoardView.tsx`
(+ its test), synced `openspec/specs/openspec-board/spec.md`, archived change under
`openspec/changes/archive/2026-06-14-add-board-drag-visual-feedback/`, merged PR #119.

---

_Generated from session `019ec6b3-e576-7c9e-a6c1-4f4c5bc2c11c` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-add-board-drag-visual-feedback` · 2026-06-14. Source extract: deterministic facts sheet._
