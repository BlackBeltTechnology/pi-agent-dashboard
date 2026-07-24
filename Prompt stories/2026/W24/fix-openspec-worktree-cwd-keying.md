---
session: 019ec53d
week: 2026/W24
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-openspec-worktree-cwd-keying, redesign-openspec-board]
---

# How we did it: Fix OpenSpec worktree cwd-keying — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single skill invocation:

```
/skill:openspec-apply-change fix-openspec-worktree-cwd-keying
```

The real objective: implement an already-scoped OpenSpec change so the **folder-level
OpenSpec card reflects task edits made inside a git worktree**, not just the main
checkout. A worktree session carries its own `tasks.md`; ticking a box in the folder
card was silently writing to *main* while the human worked in a worktree. The change
threads a per-change `sourceCwd` through the aggregation so each change row targets its
true origin working copy. The two later prompts (`archive`, then `commit, create PR and
monitor CI`) were the standard land-the-change follow-through — but that follow-through
is where the real lesson of this session surfaced.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — it reads the proposal,
   design, and `tasks.md` and drives the implementation.
2. Let the AI produce a numbered plan tied to task IDs (1.x, 2.x…) before it edits; skim
   it, then let it implement type → helper+tests → wiring in that order.
3. Run the **scoped** vitest project with a throwaway HOME to dodce home-dir pollution:
   `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-web <files>`.
4. Treat a lone `tsc` project-reference error and flaky perf-smoke failures as noise —
   confirm they pass in isolation, don't chase them.
5. `archive` — but expect the archive to surface **pre-existing spec corruption** in the
   target main spec; repair the header/Purpose/SHALL-wrap and re-run `openspec archive … --yes`.
6. **Before you commit: `git fetch origin develop` and check whether develop moved.** A
   conflicting PR base is a red flag that your change may be superseded, not just stale.
7. If the merge conflict is a ~600-line rewrite (not a mechanical 3-liner), STOP and
   audit develop's new design against your change's *requirements* — abort the merge, read
   the landed code, and decide whether your change still has a gap to close.
8. If superseded, say so plainly with a requirement-by-requirement verdict table instead
   of force-merging dead UI.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (find the surfaces to change).** The AI located the change
artifacts, ran `openspec status --json`, and grepped for the components named in the
tasks (`SessionList`, `FolderOpenSpecSection`, `TasksPopover`) plus the shared types
(`OpenSpecChange`). *Why it worked:* it mapped every task ID to a concrete file before
writing a line, so the plan was grounded in real code, not guesses.

**Phase 2 — Design + generate.** It posted a 5-step plan keyed to task IDs, then
implemented in dependency order: add `sourceCwd?` to the shared type → create
`openspec-aggregate.ts` (unions OpenSpec data across the group cwd + every worktree
member cwd, de-dupes by name with group-cwd-wins, OR-folds the boolean flags) → unit
tests → wire the aggregate into `SessionList.tsx` → thread `rowCwd = c.sourceCwd ?? cwd`
through `FolderOpenSpecSection`'s popover/spawn/read-artifact actions. *Decision point:*
helper-plus-tests-first isolated the pure logic from the React wiring.

**Phase 3 — Verify.** Scoped vitest, then the full web project. A `tsc` project-reference
error and two perf-smoke failures appeared; the AI reran them in isolation, confirmed
green, and correctly labelled them unrelated flake rather than derailing. 12/14 tasks
done, the remaining two being manual live-worktree QA.

**Phase 4 — Archive (unblock a corrupt spec).** `archive` refused because the target main
spec `openspec-folder-section/spec.md` was malformed from a *prior* archive: its top
header was `## ADDED Requirements` (a leaked delta header hiding every requirement), it
lacked a `## Purpose` section, and requirement #1's `SHALL` was wrapped onto line 2 where
the validator can't see it. The AI diagnosed each with `openspec validate`/`show --json`,
made minimal repairs, and archived cleanly — flagging that these were latent committed
bugs, not from this change.

**Phase 5 — Ship, and discover supersession.** On `commit, create PR and monitor CI`, the
PR (#113, base `develop`) came back **CONFLICTING**. Instead of blindly resolving, the AI
merged develop into a scratch state, saw a ~600-line conflict, and investigated: PR #112
(`redesign-openspec-board`) had **replaced the entire inline accordion this change patched
with a full-page kanban board** (`OpenSpecBoardView.tsx` + `openspec-board-worktree.ts`).
It aborted the merge, audited the landed board against each of this change's three
requirements, and returned a verdict table showing the original bug was already closed by
design — rather than force-fitting a patch onto deleted UI.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <name>` is the ideal kickoff: it
  hands the AI a fully-scoped change (proposal + design + tasks) so there's no ambiguity
  to negotiate. When you already have an OpenSpec change, always enter through its skill.
- **`archive`** — one word, high leverage: it triggers the full validate-and-merge-to-spec
  path, which is exactly where latent spec corruption gets caught.
- **`commit, create PR and monitor CI`** — the compact land-it instruction. Its real value
  here was *monitor CI*: watching the PR state is what surfaced the CONFLICTING base and,
  through it, the supersession. A weaker prompt would have been "just merge it" — which
  would have silently rebuilt deleted UI.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat implementation-complete as done | `archive` | Always chain implement → archive → ship; archive is where spec-merge problems appear |
| Stop after archive | `commit, create PR and monitor CI` | Make "commit + PR + watch CI" the standard tail of every change |
| (Self-corrected well) risk force-resolving a conflict | — | When a PR base conflicts, first ask "did develop supersede me?" before resolving |

The human steered lightly (3 prompts) because the apply-change skill carried the scope.
The pivotal judgment — not force-merging a superseded change — the AI made on its own once
`monitor CI` exposed the conflict.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work ran entirely through the
existing `openspec-apply-change` skill and standard git/gh/vitest tooling.

**Skill worth having (recommended):** a *"check develop before shipping a long-lived
change"* guardrail — `git fetch origin develop && git log --oneline HEAD...origin/develop
-- <your touched files>` before committing. When a change has sat in review while other
PRs land, the conflict may be *semantic supersession*, not a mechanical rebase. Detecting
that early (as happened here) saves rebuilding UI that no longer exists.

## 7. Pitfalls & dead ends

- **Archive blocked by a leaked delta header.** If `openspec archive` fails on a spec whose
  top line is `## ADDED Requirements`, that's a prior archive's delta header that leaked
  into the main spec — change it to `## Requirements`, add a `## Purpose` if missing.
- **`SHALL` wrapped onto line 2.** The validator only reads a requirement statement's first
  line for the keyword. If a requirement "clearly has SHALL" but still fails, reflow so the
  keyword lands on line 1.
- **`tsc` project-reference error.** A lone typecheck error in a project-reference monorepo
  can be a config quirk unrelated to your diff — confirm by running the scoped build, don't
  chase it into your change.
- **Flaky perf-smoke tests.** Two timing-sensitive perf tests failed then passed on rerun
  in isolation; treat as flake, not regression.
- **Conflicting PR base = investigate, don't resolve.** A ~600-line conflict is a signal to
  read the landed design, not to hand-merge. `git merge --abort`, audit, then decide.

## 8. Reproduce it faster — checklist

- [ ] Enter through the change's skill: `/skill:openspec-apply-change <name>`.
- [ ] Get a task-ID-keyed plan; implement type → pure helper + tests → React wiring.
- [ ] Verify scoped: `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-web <files>`.
- [ ] Ignore known-noise (project-ref `tsc` quirk, perf-smoke flake) after confirming in isolation.
- [ ] `archive`; if it fails, repair spec header / `## Purpose` / SHALL-on-line-1, re-run `openspec archive … --yes`.
- [ ] **`git fetch origin develop`; diff your touched files against develop before committing.**
- [ ] Commit (exclude local `.pi/settings.json`), push, `gh pr create`, monitor CI + PR mergeability.
- [ ] If base CONFLICTING with a big rewrite → abort merge, audit landed design vs your
      requirements, report a supersession verdict rather than force-merging.

**Inputs to have ready:** the OpenSpec change artifacts (`openspec/changes/<name>/`), a
clean worktree, `gh` authenticated.
**Artifacts produced:** `packages/client/src/lib/openspec-aggregate.ts` (+ tests),
edits to `packages/shared/src/types.ts`, `SessionList.tsx`, `FolderOpenSpecSection.tsx`;
archived change at `openspec/changes/archive/2026-06-14-fix-openspec-worktree-cwd-keying/`;
PR #113 (ultimately superseded by the landed board redesign).

---

_Generated from session `019ec53d` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-fix-openspec-worktree-cwd-keying` · 2026-06-14. Source extract: deterministic facts sheet._
