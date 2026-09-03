---
session: 019e9545
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (12 user prompts)"
upgrade_status: pending
openspec_changes: [fix-file-mention-search-ranking]
proposal_excerpt: "Typing `@` in the chat composer opens a file-mention dropdown. Users report it \"does not show all matched files — only a portion\". Two defects in the bridge's `searchFiles` (`packages/extension/src/command-handler.ts`…"
---

# How we did it: Fix file-mention search ranking — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

> `/skill:openspec-apply-change fix-file-mention-search-ranking`

The real objective, drawn from the change's proposal: typing `@` in the chat composer
opens a file-mention dropdown that "does not show all matched files — only a portion."
The bridge's `searchFiles` (`packages/extension/src/command-handler.ts`) had two
defects — a display cap that was too low and a traversal that starved shallow matches
in large repos. The task was to implement the OpenSpec change end-to-end: rewrite the
search, add regression tests, sync the spec, land the PR, and archive. The user's later
prompts show the *true* scope was not just "write the fix" but "drive the whole ship
pipeline" — commit, PR, CodeRabbit triage, CI monitoring, merge, and worktree cleanup.

## 2. TL;DR playbook

1. **Run the apply skill** on the change: `/skill:openspec-apply-change fix-file-mention-search-ranking`. Read `proposal.md` + `design.md` + `tasks.md` first.
2. **Rewrite `searchFiles`**: decouple the visit budget (`MAX_VISITS=4000`, entries scanned) from the display cap (`MAX_RESULTS=50`, raised from 20). Collect all candidates within budget, rank, then cap.
3. **Write a real-tmp-tree test** (`search-files-ranking.test.ts`) covering scoring tiers, bare-`@` ordering, the cap, and the budget-starvation case.
4. **Smoke against the real repo cwd** — this is what exposed the DFS starvation bug. Don't skip it; unit tests alone missed it.
5. **Switch traversal to BFS** when the smoke shows deep `openspec/changes/archive/*` matches drowning root `package.json`. Record the rationale in `design.md` (it contradicts the "Alternatives considered" section, so document why).
6. **Verify green in your package only**: `HOME=$(mktemp -d) npx vitest run …` in `packages/extension`; ignore pre-existing failures in unrelated packages (`pi-image-fit`, `browse-endpoint`).
7. **Commit only the change's files** (exclude local `.pi/settings.json`), push, `gh pr create --base develop` (NOT `main` — it doesn't exist here).
8. **Triage CodeRabbit**: fix legit findings (caveman-style docs row, readdir error-path test), decline out-of-scope ones (config-ize constants) with a stated reason. Ignore comments on files you didn't touch (stale merge-base noise).
9. **Sync the delta spec** into `openspec/specs/file-autocomplete/spec.md`, archive via `git mv`, then merge PR and remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & implement (autonomous).** From the single apply-skill prompt,
the AI read all three OpenSpec artifacts, rewrote `searchFiles` (budget/cap decoupling,
`splitQuery`, `scoreMatch` tiers 0–4), and wrote a 20-case test against a real tmp tree.
*Why it worked:* it treated the spec as normative — when the pathLen tie-break conflicted
with the spec's "bare-`@` → depth then alphabetically", it made the empty-query case
alpha-dominant rather than bending the spec.

**Phase 2 — The smoke test that changed the design.** The AI ran `searchFiles` against
the *real* repo cwd and found `@package` surfaced deep archive dirs before root
`package.json`. Root cause: DFS + a visit budget drains the budget inside an early huge
subtree before shallow siblings are ever visited — the exact anti-starvation failure the
spec forbids. *Decision point:* the AI switched to **BFS** (visits shallowest first),
added a budget-starvation regression test, and — crucially — documented the reversal in
`design.md`, which had explicitly rejected pure BFS. This is the session's best move:
verify against reality, then honestly record why the design changed.

**Phase 3 — Ship (human-steered, one verb at a time).** The user drove the pipeline with
terse prompts: `commit and push` → `create PR` → `is it merged?` → `is CI ok and
coderabbit issues?` → `fix coderebbot` → `merge develop`. Each unblocked one concrete
step. The AI committed cleanly (excluding `.pi/settings.json`), corrected the PR base from
`main` to `develop`, and fixed a mangled PR body (unquoted heredoc expanded backticks) via
`--body-file`.

**Phase 4 — CodeRabbit triage.** 5 comments, but only 2 were on this change's files. The
AI distinguished its own diff from stale merge-base noise (`redesign-ask-user-question-cards`
files already in `develop`), fixed the caveman-style docs row and added a readdir
error-path test, and *declined* the "move constants to config" refactor with a design-backed
rationale. It later merged `develop` to clear the stale diff.

**Phase 5 — Sync, archive, monitor, land.** The AI synced the delta into the main
`file-autocomplete` spec, normalized a *pre-existing* malformed `## ADDED Requirements`
header, archived via `git mv`, polled CI to green twice (after each new push), then
squash-merged PR #75 and removed the worktree — noting the session's own directory ceased
to exist.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-file-mention-search-ranking`. Effective because the change already had a proposal/design/tasks; the skill gave the AI a complete, bounded spec to execute. *Lesson:* front-load the spec so the kickoff can be one line.
- **`fix coderebbot`** (typo and all) — high leverage: a two-word prompt that triggered a full triage, selective fix, and reasoned decline. Works because the AI had already surfaced the comment list in the prior turn.
- **`is CI ok and coderabbit issues?`** — good because it asks for a *judgment*, not a raw dump; the AI separated "CI green" from "5 comments, 2 mine, 1 decline."
- **`merge develop`** — unblocked the stale-diff problem in one word.

Rewrite weak prompts: instead of `is it merged?`, prefer *"report PR #75 state: merged?, CI, CodeRabbit actionable comments"* to get the full picture in one turn.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation | `commit and push`, `create PR` | State up front: "apply, then ship the full pipeline through merge + cleanup" |
| Target `main` for the PR base | (AI self-corrected on `create PR`) | Save memory: this repo's default branch is `develop`, `main` does not exist |
| Leave CodeRabbit comments unaddressed | `fix coderebbot` | Add "triage + resolve CodeRabbit before asking to merge" to the ship step |
| Let the stale merge-base pollute the PR diff | `merge develop` | Merge `origin/develop` into the branch before requesting review |
| Treat archive as auto | `/skill:openspec-archive-change` (twice) | Chain apply → verify → archive in one plan |

Quality bars the human imposed implicitly by asking: CI must be green, CodeRabbit issues
must be triaged (fixed or reasoned-declined), and the change must be archived + spec-synced
before "done."

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session, but the workflow is highly repeatable
and two things *should* be captured:

- **A memory:** "pi-agent-dashboard default branch is `develop`; `main` does not exist —
  always `gh pr create --base develop`." This removes the recurring `main` misfire.
- **A skill (or an addition to `ship-change`):** "Smoke `searchFiles`-style traversal
  code against the real repo cwd, not just a tmp tree — DFS + visit-budget bugs only
  appear in large real trees." The BFS discovery would have been missed by unit tests alone.

Subagent note: the `Explore`/DocScribe subagent for the caveman docs row was **unavailable**
in this environment, so the AI edited `docs/file-index-extension.md` directly — which
CodeRabbit correctly flagged for style. When the subagent infra is up, delegate that row.

## 7. Pitfalls & dead ends

- **DFS + visit budget starves shallow matches.** If `@package` surfaces deep files before
  root `package.json`, switch to BFS — do not just raise the budget.
- **Unit tests passed while the feature was still broken.** Always smoke against the real
  repo cwd. The tmp-tree test conflated traversal with ranking; fix by making the root an
  equal-tier match so the depth tie-break — and thus BFS collection — is what's under test.
- **Unquoted heredoc mangled the PR body** (bash expanded backticks). Use `gh pr edit --body-file`.
- **`gh pr create --base main` fails** — repo default is `develop`.
- **`.pi/settings.json` blocks clean commits/merges.** Exclude it from commits; `git stash push .pi/settings.json` before merging, restore after.
- **`--delete-branch` fails when `develop` is checked out in the main worktree.** Squash-merged branches need `git branch -D` from the main checkout.
- **Ignore pre-existing failures** in `pi-image-fit` (jimp version mismatch) and `browse-endpoint` (expects `node_modules` absent in the worktree) — verify green in `packages/extension` only.
- **Pre-existing malformed spec header** (`## ADDED Requirements` instead of `## Purpose`/`## Requirements`) blocks `validate --strict`; confirm it predates your work via `git show HEAD:…`, then normalize it as part of the sync.

## 8. Reproduce it faster — checklist

Inputs to have ready: the OpenSpec change dir (`openspec/changes/fix-file-mention-search-ranking/`),
`gh` authenticated, and knowledge that the base branch is `develop`.

- [ ] `/skill:openspec-apply-change <change>` — read proposal/design/tasks first.
- [ ] Rewrite `searchFiles`: `MAX_VISITS=4000` (scan budget) ≠ `MAX_RESULTS=50` (cap); collect → rank → cap.
- [ ] Write `search-files-ranking.test.ts` (tiers, bare-`@`, cap, budget-starvation).
- [ ] **Smoke against real repo cwd** → expect the DFS starvation bug → switch to BFS → document in `design.md`.
- [ ] `HOME=$(mktemp -d) npx vitest run` in `packages/extension`; ignore unrelated-package failures.
- [ ] Commit (exclude `.pi/settings.json`), push, `gh pr create --base develop`; fix body via `--body-file`.
- [ ] Triage CodeRabbit: fix caveman docs row + readdir error-path test; decline config-ize with a reason; ignore stale-merge-base comments; `merge develop` to clean the diff.
- [ ] Sync delta → `openspec/specs/file-autocomplete/spec.md`; normalize pre-existing malformed header; archive via `git mv`.
- [ ] Poll CI to green after each push; squash-merge PR; remove worktree + delete branch (`-D`) from the main checkout.

Final artifacts: `packages/extension/src/command-handler.ts` (rewritten `searchFiles`),
`packages/extension/src/__tests__/search-files-ranking.test.ts` (new, 22 tests),
`openspec/specs/file-autocomplete/spec.md` (synced),
`openspec/changes/archive/2026-06-05-fix-file-mention-search-ranking/` (archived).
Landed as squash commit `a2e0140` on `develop` (PR #75).

---

_Generated from session `019e9545-4da2-7aa4-a07e-e02fdc6fd09e` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-fix-file-mention-search-ranking` · 2026-06-05. Source extract: session facts sheet._
