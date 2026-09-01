---
session: 019f6190
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-session-diff-open-nongit-and-preview]
proposal_excerpt: "Clicking a file row in the per-turn `ChangeSummaryBlock` (the \"N files · +X\" block in chat) opens a `diff:` tab that renders **\"No changes for this file\"** for newly written files. The additive diff is never shown eve…"
---

# How we did it: Fix session diff for non-git & preview — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change fix-session-diff-open-nongit-and-preview`. The real objective, once the proposal was read, was concrete: **clicking a file row in the per-turn `ChangeSummaryBlock` ("N files · +X" block in chat) opened a `diff:` tab that showed "No changes for this file" for newly written files** — the additive diff never rendered. The task was to root-cause that blank tab, fix it end-to-end (including the non-git case and the Diff/File preview toggle), and land the change through the full ship pipeline: apply → archive/sync-specs → PR → CI → CodeRabbit → squash-merge → worktree cleanup.

## 2. TL;DR playbook

1. **Apply the change with the skill**: `/skill:openspec-apply-change <name>` — read `proposal.md`, `design.md`, `tasks.md` first, then implement task-by-task with TDD.
2. **Find the root cause before coding**: grep the client (`ChatView.tsx`, `DiffViewer.tsx`, `DiffPanel.tsx`) and the server (`session-diff.ts::normalizePath`). Root cause here = **client/server path-format mismatch** (client passes absolute Write path, server keys diffs by relative-posix).
3. **Normalize at the source**: create `packages/client/src/lib/normalize-path.ts` mirroring the server's `normalizePath`; write its unit test first (`HOME=$(mktemp -d) npx vitest run <test>`), watch it fail, then implement.
4. **Wire it once**: normalize in `ChatView` so the displayed row and the `openDiffTab` argument share the same relative key — they can never diverge.
5. **Add a defensive fallback** in `DiffViewer` (exact-match miss → retry with cwd-normalized path) and make the git ⇒ gitDiff / else session-derived precedence an explicit contract comment in `DiffPanel`.
6. **Lock behavior with tests**: reproduction test, non-git render test, and the Diff/File preview-toggle test. Run the full suite once to a log: `npm test 2>&1 | tee /tmp/pi-test.log`.
7. **Ship**: run `/skill:ship-change` (or `ship-change`) — archive + sync-specs, commit, push, open PR against `develop`, watch CI, wait for CodeRabbit, apply safe fixes, squash-merge, remove worktree.
8. **When CI won't start**: check `mergeStateStatus` — `DIRTY`/`CONFLICTING` blocks CI. Merge `develop`, resolve conflicts, push to flip to `MERGEABLE`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before touching).** The AI read `proposal.md`/`design.md`/`tasks.md`, then the four implicated sources (`ChatView`, `DiffViewer`, `DiffPanel`, `SessionDiffContext`) and the server's `session-diff.ts`. It ran the existing tests for a baseline. *Why it worked:* the blank tab was a symptom; reading both sides revealed the real cause was a **path-format contract mismatch**, not a rendering bug.

**Phase 2 — TDD implementation.** Task-ordered: `normalize-path.ts` helper + unit test first (Task 2.1), then the failing reproduction test tying `buildTurnSummaries`' absolute path through client normalization to the server's relative `data.files` key (Task 1.1), then the `DiffViewer` fallback (2.3), the `DiffPanel` precedence contract (3.1), and the preview-toggle lock (4.1). *Why it worked:* each behavior was pinned by a test before the code existed, and the fix was made **at the source** (one normalization point) rather than patched at every call site.

**Phase 3 — Test isolation.** `DiffPanel` had heavy deps (ThemeProvider, `/api/session-file`, SyntaxHighlighter). The AI mocked `DiffPanel` to a probe so `DiffViewer` tests isolated *file resolution* only. It also exported the raw `SessionDiffContext` for test injection. *Decision point:* keep the test surface small and honest — test what the unit actually does.

**Phase 4 — Full-suite triage.** The full run showed 17 failures, all in `pi-image-fit-extension` (`Jimp is not a constructor` — a jimp/ESM version issue). The AI stashed changes, confirmed the failures were **pre-existing on the base branch and unrelated** to `packages/client`, then restored. *Why it worked:* it did not chase a red herring; it proved the failures were environmental and out of scope.

**Phase 5 — Ship pipeline.** `ship-change`: synced 3 MODIFIED-Requirement deltas into their main specs, archived to `openspec/changes/archive/2026-07-15-…`, fixed a pre-existing malformed `file-diff-view/spec.md` (missing `## Purpose`) so the sync validated, committed, pushed, opened PR #336 against `develop`.

**Phase 6 — Conflict + CI + CodeRabbit loop.** The PR was `CONFLICTING` (`DIRTY`) so CI never started. The AI merged `develop`, resolved two conflicts (dedup'd ChatView imports keeping only `normalizeUnderCwd`; relocated a `test-plan.md` develop added into the archive dir), pushed to flip to `MERGEABLE`. CI went green. CodeRabbit posted 3 threads → applied 2 (Windows `\`-rooted/UNC path handling in `normalize-path.ts`; a docs clarity fix via subagent), skipped 1 false positive (archive location) with a reply, resolved it, and squash-merged. Worktree removed from the **parent** repo.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-session-diff-open-nongit-and-preview`. Effective because the change already carried a written `proposal.md`/`design.md`/`tasks.md`; the skill turned a one-liner into a task-ordered TDD plan. *Lesson:* front-load the spec so a single skill invocation is enough.
- **`ship-change`** — a single word that ran the entire archive→PR→CI→CodeRabbit→merge pipeline. High leverage because the skill encodes every gate; the operator didn't re-explain steps.
- **`go on`** (×2) — used only to resume after long background test runs / RPC timeouts. Low-content but sufficient because the AI held the plan state.

Rewrite of the weak resumes: instead of a bare `go on`, prefer `resume from the verify gate — the client suite already passed 3406/0` so intent survives if context is lost.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stall on a long-running background test / RPC timeout | "agent stuck" / "go on" | Run big suites to a log file in the background from the start (`> /tmp/x.log 2>&1 &`) and poll, instead of blocking the RPC |
| Treat 17 unrelated `image-fit`/Jimp failures as in-scope | Implicitly, via the "verify gate" discipline | State up front: "only `packages/client` is in scope; confirm any other failures are pre-existing on base and move on" |
| Need an explicit push to finish landing | "ship-change" | Chain apply→ship in the goal, or let the ship skill own the full pipeline |
| Use `vitest -w` thinking it means "workspace" | (self-caught) it means **watch** | Remember: `-w` = watch in vitest; scope with a path/`--project`, kill the watcher after the run |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session; the work rode two existing skills:

- **`openspec-apply-change`** — turns a spec'd change into a task-ordered TDD implementation loop. Invoke it whenever a change has `proposal.md`/`design.md`/`tasks.md` ready.
- **`ship-change`** — owns archive→sync-specs→commit→PR→CI→CodeRabbit→squash-merge→worktree-cleanup, including the known pitfalls (CONFLICTING blocks CI; worktree must be removed from the parent repo). Invoke after implementation is done and tasks are `[x]`.

Two `general-purpose` subagents were spawned to write `docs/architecture.md` prose (path-agreement note; pre-fix wording clarification) — correctly honoring the repo's Rule-6 "all `docs/` writes go through a subagent in caveman style."

*Worth a memory:* "the local `pi-image-fit-extension` Jimp failures are a pre-existing environment quirk; CI's `npm test` is green — never treat them as a regression."

## 7. Pitfalls & dead ends

- **Aborted command lost tracked edits into a stash.** A `git stash`-wrapping command was interrupted; edits landed in `stash@{0}`. Recovery: `git stash list` → `git stash pop`. *If you hit this:* check the stash before assuming work was lost.
- **`image-fit`/Jimp red herring.** 17 failures that look scary are `Jimp is not a constructor` in an unrelated package. *Do:* stash your change, run the base, confirm pre-existing, restore — don't debug it.
- **PR `CONFLICTING`/`DIRTY` silently blocks CI.** No Actions run appears. *Do:* `gh pr view --json mergeStateStatus`; if dirty, merge `develop`, resolve, push.
- **`vitest -w` = watch, not workspace.** The run "hung" because it entered watch mode after completing. *Do:* kill the watcher (`pkill -f 'vitest.*packages/client'`) once the summary prints.
- **`--delete-branch` fails inside a worktree** (develop is checked out in the parent). *Do:* delete the remote branch, then `git worktree remove` from the **parent** repo, then delete the local branch — and re-anchor your shell cwd out of the removed worktree.
- **Malformed main spec blocks sync.** `file-diff-view/spec.md` lacked `## Purpose`. *Do:* add the required section headers so the synced delta validates.

## 8. Reproduce it faster — checklist

- [ ] `gh` authed; on a worktree branch off `develop`; the change dir has `proposal.md`/`design.md`/`tasks.md`.
- [ ] `/skill:openspec-apply-change <name>` — read specs, implement task-by-task, TDD.
- [ ] Root-cause first: compare client path (`ChatView`) vs server key (`session-diff.ts::normalizePath`).
- [ ] `packages/client/src/lib/normalize-path.ts` + unit test (write test, watch fail, implement). Handle Windows `\`/UNC, trailing slash, sibling-prefix false positives.
- [ ] Normalize in `ChatView` at the source; add `DiffViewer` fallback; make `DiffPanel` precedence an explicit contract comment.
- [ ] Tests: reproduction, non-git render, preview toggle. Mock heavy `DiffPanel` deps to a probe.
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log`; confirm only pre-existing `image-fit`/Jimp failures remain.
- [ ] `ship-change` — sync 3 deltas, archive, commit, push, open PR vs `develop`.
- [ ] If CI won't start: check `mergeStateStatus`, merge `develop`, resolve, push.
- [ ] Apply safe CodeRabbit fixes, reply-and-resolve false positives, squash-merge, remove worktree from parent.

**Key inputs:** an OpenSpec change with all three artifacts; `gh` auth; a worktree off `develop`.
**Artifacts produced:** `normalize-path.ts` (+tests), edits to `ChatView.tsx`/`DiffViewer.tsx`/`DiffPanel.tsx`/`SessionDiffContext.tsx`, 3 synced specs, archived change, PR #336 (merged, squash `268d47e9`).

---

_Generated from session `019f6190-c2a1-787f-bebf-672adef77736` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-15. Source extract: deterministic session facts sheet._
