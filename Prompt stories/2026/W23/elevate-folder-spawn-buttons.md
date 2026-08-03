---
session: 019e9994
week: 2026/W23
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [elevate-folder-spawn-buttons]
proposal_excerpt: "The `+Session` action — the primary way a user starts work in a folder — is today a cramped `text-[10px]` pill crowded among `Worktree`, `Terminals(N)`, `Editor`, and the Pi Resources icon inside `FolderActionBar`."
---

# How we did it: Elevate folder spawn buttons — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change elevate-folder-spawn-buttons`. The proposal already existed — the `+Session` action, the primary way a user starts work in a folder, was a cramped `text-[10px]` pill crowded among `Worktree`, `Terminals(N)`, `Editor`, and the Pi Resources icon inside `FolderActionBar`. The **real objective**, once the tasks made it concrete: extract the two spawn actions (`+Session`, `+Worktree`) into a new full-width, stacked, always-visible button component in the folder header, trim them (and their now-dead props/imports) out of `FolderActionBar`, wire the new component into `SessionList` so it force-expands a collapsed folder before spawning, and land the whole thing through the standard OpenSpec apply → archive → PR → merge lifecycle. This was pure execution of a pre-written change — the human only steered lifecycle transitions, not design.

## 2. TL;DR playbook

1. Kick off with the skill against the existing change: `/skill:openspec-apply-change <change-name>`.
2. Let the AI read the design doc + all context files (`design.md`, `FolderActionBar.tsx`, `SessionList.tsx`, existing tests) **before** writing anything.
3. Implement in the task order the change dictates: **new component → trim old owner → wire call site → tests**.
4. Run the scoped suite first (`npx vitest run <new test files>`), then `npm test` for the full picture, then `npm run build`.
5. When full-suite failures appear, **confirm they're pre-existing on the base branch and in an untouched package** before treating them as yours.
6. Mark all tasks complete, update the doc index rows, then `/skill:openspec-archive-change <change-name>`.
7. `commit, push, create PR and monitor CI` — one prompt drives commit (exclude machine-local `.pi/settings.json`), push, `gh pr create --base develop`, and a poll loop on `gh pr checks`.
8. On green, `merge PR and cleanup` — merge, delete remote branch, remove the worktree + local branch from the **main repo** (not from inside the worktree).

## 3. How the collaboration unfolded

**Phase 1 — Discovery (locate the skill, load the change).** The AI grepped `.pi/skills` and `~/.pi` for the openspec-apply skill, then ran `openspec status` / `openspec instructions apply --json` to pull the task list and design. It read `design.md`, both target components, and the existing test files. *Why it worked:* it built the full mental model from the design doc + real source before editing — no speculative changes.

**Phase 2 — Implementation (task-ordered).** Following the change's task numbering: created `FolderSpawnButtons.tsx` (green `+ New Session` always; orange `+ New Worktree` gated by `showWorktree`; handlers `stopPropagation`; session button disables on `spawningDisabled`), then trimmed `FolderActionBar.tsx` (removed both button blocks, five now-dead props, the `showWorktreeButton` derivation, and the unused `mdiPlus`/`mdiSourceBranchPlus` imports), then wired `<FolderSpawnButtons>` into the always-visible `SessionList` header with a force-expand-before-spawn guard. *Decision point:* the human made none here — the change spec was the authority.

**Phase 3 — Verify.** Scoped vitest (35 tests green) → `npm test` → `npm run build`. The full suite surfaced 17 failures in `@blackbelt-technology/pi-image-fit` (`Jimp is not a constructor`); the AI proved they were pre-existing and in an untouched package, not regressions.

**Phase 4 — Archive (`/skill:openspec-archive-change`).** During archive, the sync hit a structurally-invalid main spec: a prior archive had leaked a `## ADDED Requirements` delta header into `openspec/specs/folder-action-bar/spec.md`, hiding every requirement from the validator. The AI repaired the header to a proper `# … Specification` / `## Purpose` / `## Requirements` structure, then re-ran the archive successfully.

**Phase 5 — Ship (`commit, push, create PR and monitor CI` → `merge PR and cleanup`).** Staged everything except the machine-local `.pi/settings.json`, committed, pushed, opened PR #82 against `develop`, and polled `gh pr checks` / `gh run view` until CI (lint→test→build) and CodeRabbit were green. CI's clean `npm ci` ran the full suite green — confirming the `pi-image-fit` failures were a local-only Jimp install quirk. Merged (merge-commit repo), deleted the remote branch, and removed the worktree + local branch from the main repo.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change elevate-folder-spawn-buttons`.** Effective because the change already carried a proposal, design, and numbered tasks; the skill turns "build this" into a deterministic checklist the AI executes in order. The upfront investment was in the *change*, not the prompt.
- **`commit, push, create PR and monitor CI`** — a high-leverage one-liner: it chained four lifecycle steps into a single autonomous run, including a self-driven CI poll loop, without further babysitting.
- **`merge PR and cleanup`** — closed the loop in one move: merge + remote-branch delete + worktree/branch removal.

*Rewrite of a weak spot:* none needed — the prompts were terse and correct because the OpenSpec change front-loaded all the specification. The lesson is to invest in the change artifacts so the driving prompts can be this short.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Stop after implementation, awaiting the next lifecycle phase | Issuing each transition explicitly (`archive`, then `commit/push/PR`, then `merge/cleanup`) | Chaining the whole lifecycle in the goal prompt when you want it autonomous ("apply, archive, PR, and merge when CI is green") |
| Treat unrelated full-suite failures as potential regressions | (self-corrected) confirmed they were pre-existing + in an untouched package | State "only <package> tests are in scope; unrelated red suites are pre-existing" up front |
| Nearly commit machine-local config | (self-corrected) excluded `.pi/settings.json` as a machine-specific path diff | Keep a standing rule: never commit `.pi/settings.json` local-path diffs |

The human imposed **no design corrections** — the steering was purely "advance to the next phase." The AI self-corrected the two technical judgment calls (unrelated failures, local config).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session; the value was in *chaining existing skills* cleanly:

- **`openspec-apply-change` → `openspec-archive-change`** did the heavy lifting: task extraction, ordered implementation, spec sync. Invoke them whenever a change already has proposal + design + tasks and you just need disciplined execution.
- **`Explore` subagent** was spawned to update the `file-index-client` doc rows (the direct caveman-style docs subagent was unavailable, so the AI fell back to editing docs directly). Invoke a subagent for doc-index maintenance to keep it out of the main context.

*Skill that could be created:* a "leaked-delta-header repair" note for OpenSpec main specs — see Pitfalls — since that failure mode blocked the archive and is likely to recur.

## 7. Pitfalls & dead ends

- **Malformed main spec blocks archive.** If `openspec archive` fails and the main spec's requirements seem invisible to the validator, check line 1 for a leaked `## ADDED Requirements` delta header from a prior archive. Fix: replace it with a proper `# <cap> Specification` / `## Purpose` / `## Requirements` structure, then re-run the archive.
- **`Jimp is not a constructor` in `pi-image-fit`.** 17 full-suite failures that are a **local-only** install quirk — a clean CI `npm ci` runs them green. Don't chase them; confirm the package is untouched and move on.
- **`gh pr merge --delete-branch` fails to auto-clean** when the base branch (`develop`) is checked out in the main worktree — gh can't switch the local branch. The merge still succeeds; delete the remote branch and remove the worktree/branch manually afterward.
- **Cleanup must run from the main repo**, not from inside the worktree you're removing. The worktree's disposable `.pi/settings.json` change means `git worktree remove` needs `--force`.

## 8. Reproduce it faster — checklist

- [ ] Change has proposal + design + numbered tasks → `/skill:openspec-apply-change <name>`.
- [ ] AI reads `design.md` + all target sources + existing tests before editing.
- [ ] Implement in task order: new component → trim old owner → wire call site → tests.
- [ ] `npx vitest run <scoped files>` → `npm test` → `npm run build`.
- [ ] Any red full-suite → prove pre-existing + untouched package before proceeding.
- [ ] Mark tasks complete, update doc-index rows, `/skill:openspec-archive-change <name>` (repair any leaked delta header).
- [ ] `commit, push, create PR and monitor CI` (exclude `.pi/settings.json`; base `develop`).
- [ ] On green: `merge PR and cleanup` — merge, delete remote branch, remove worktree + local branch **from the main repo**.

**Inputs needed:** a repo checkout with the OpenSpec change present, `gh` authenticated, worktree already created.
**Artifacts produced:** `packages/client/src/components/FolderSpawnButtons.tsx` (+ its test), edited `FolderActionBar.tsx` / `SessionList.tsx` (+ tests), archived change under `openspec/changes/archive/2026-06-05-elevate-folder-spawn-buttons/`, synced `folder-action-bar` spec, merged PR #82.

---

_Generated from session `019e9994` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-elevate-folder-spawn-buttons` · 2026-06-05. Source extract: session facts sheet (deterministic extract)._
