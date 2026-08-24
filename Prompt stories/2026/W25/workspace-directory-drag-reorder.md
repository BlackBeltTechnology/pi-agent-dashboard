---
session: 019ee680
week: 2026/W25
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [workspace-directory-drag-reorder]
proposal_excerpt: "The sidebar lets users drag-reorder sessions (within a folder) and pinned directory groups, but workspaces cannot be reordered and folders inside a workspace cannot be reordered — even though the serve…"
---

# How we did it: workspace + intra-workspace folder drag-reorder — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change workspace-directory-drag-reorder`.
The real objective, drawn from the attached proposal, was to close a sidebar gap: users
could already drag-reorder **sessions** (within a folder) and **pinned directory groups**,
but **workspaces themselves could not be reordered**, and **folders nested inside a workspace
could not be reordered**. This session took that fully-specified OpenSpec change from
`proposal + tasks` all the way to a merged, client-only implementation on `develop` — then
(via a second prompt) archived, PR'd, CI-monitored, and cleaned up the branch/worktree.

## 2. TL;DR playbook

1. Start with a ready OpenSpec change and run `/skill:openspec-apply-change <name>` inside its worktree.
2. If skills don't resolve inside the worktree, tell the AI: **"use ospx skills from worktree's parent directory."**
3. Let the AI read `proposal.md`, `design.md`, `tasks.md`, then explore the existing DnD code (`SessionList.tsx`, the `Sortable*` components, `App.tsx` wiring, the shared protocol types).
4. Build the **pure logic first** in an isolated lib (`sidebar-dnd.ts`: type-aware collision detection + pure reorder resolvers), then the thin `Sortable*` wrapper components, then wire `SessionList.tsx` + `App.tsx`.
5. Write **pure-logic unit tests before component tests**; keep component tests to robust negative checks (avoid brittle `isOver`-positive mocks).
6. Typecheck (`npx tsc --noEmit`), then run the **web project only** first (`vitest run --project @blackbelt-technology/pi-dashboard-web`), then the full suite to prove failures are pre-existing/non-client.
7. Mark tasks done, run `openspec validate --strict`, delegate the docs-index row to a subagent.
8. Second prompt to land it: **"archive, synch, create PR, monitor CI, fix coderabbit, when OK, merge branch, delete branch, delete worktree"** — the AI runs `openspec archive` (auto-syncs specs), commits, pushes, `gh pr create --base develop`, polls CI, checks CodeRabbit threads, merges, deletes branch, removes worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & skill resolution.** The AI opened the skill, read the change's
`proposal/tasks`, then hit the worktree skill-path quirk. The human corrected once ("use
ospx skills from worktree's parent directory") and it recovered. *Why it worked:* one
sentence unblocked the whole apply loop instead of a debugging detour.

**Phase 2 — Code exploration.** Before writing a line, the AI grepped the existing sidebar
DnD surface: `SessionList.tsx` (the `DndContext`/`handleDragEnd` host), the existing
`SortablePinnedGroup` + its `FolderDragHandleCtx`, `App.tsx` reorder wiring, and the shared
`Workspace` protocol type. *Why it worked:* it mirrored existing conventions (reused the
folder-drag-handle context instead of inventing a new one).

**Phase 3 — Layered implementation.** Pure logic first (`sidebar-dnd.ts` —
`sameTypeClosestCenter`, `dropIndicatorProps`, `resolveWorkspaceReorder`,
`resolveWorkspaceFolderReorder` returning `null` on cross-workspace drops), then two thin
`useSortable` wrappers (`SortableWorkspace.tsx`, `SortableWorkspaceFolder.tsx`), then the
`SessionList.tsx` integration (swap `closestCenter` → `sameTypeClosestCenter`, wrap tiers in
`SortableContext`, add `workspace`/`workspace-folder` drag cases + a `forceCollapsed`
drag-collapse state) and the `App.tsx` handlers. *Why it worked:* pure functions are trivially
testable and keep the DnD wiring dumb.

**Phase 4 — Verify.** Typecheck → web-project-only vitest (253 files / 2534 tests green) →
full suite to isolate the 25 pre-existing failures (`pi-dashboard-server` timeouts +
`pi-image-fit` Jimp default-import) as **not** client-related. Decision point: the AI proved
the diff was client-only rather than chasing unrelated red.

**Phase 5 — Land it.** On the second prompt the AI ran the full ship sequence:
`openspec archive` (auto-created the `sidebar-drag-reorder` capability spec), commit, push,
`gh pr create --base develop` (#141), CI poll to green (8m11s), CodeRabbit thread check (zero
actionable), merge, branch + worktree teardown.

## 4. Prompts that worked

- **Goal prompt:** `/skill:openspec-apply-change workspace-directory-drag-reorder` — effective
  because the change was already fully specced (proposal + tasks + design), so a bare skill
  call carried all the intent. *Reproduce:* only fire this once `openspec/changes/<name>/` is complete.
- **High-leverage follow-up #1:** *"use ospx skills from worktree's parent directory"* — one
  line resolved the worktree skill-path ambiguity. Bake in: state skill-root location up front when working in a worktree.
- **High-leverage follow-up #2 (the ship command):** *"archive, synch, create PR, monitor CI,
  fix coderabbit, when OK, merge branch, delete branch, delete worktree"* — a compact,
  ordered checklist that let the AI run the entire land-it sequence autonomously. This is the
  reusable phrasing: list the steps in order and the AI executes them without further nudging.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| resolve OpenSpec skills from inside the worktree (where they may not live) | "use ospx skills from worktree's parent directory" | stating the skill-root path up front when the session runs in `.worktrees/*` |
| stop after implementation | issuing the explicit ship checklist as a second prompt | folding archive→PR→CI→merge→cleanup into the initial ask, or a `ship-change` skill |
| (self-corrected) trust a subagent's alphabetical-placement claim for a docs row | verified placement itself, found the sub-table is topic-ordered not alpha | double-check subagent claims about file ordering before acting |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a straight apply-and-ship of an
existing OpenSpec change. The reusable asset produced is the **code pattern** itself:

- **`sidebar-dnd.ts` (pure DnD resolvers + type-aware collision).** Captures the
  reorder-within-a-type rule (`sameTypeClosestCenter` blocks cross-type drops;
  `resolve*Reorder` returns `null` on invalid cross-workspace moves). *Why effective:* the
  DnD wiring stays declarative and the tricky rules are unit-tested in isolation. *Invoke
  the pattern* whenever adding a new drag-reorderable tier to the sidebar.
- **Subagent (`general-purpose`) for the docs-index row.** Delegated the `file-index-client`
  update so the caveman-style doc rule stayed out of the main context. *Invoke* for any
  `docs/` prose/row write during an apply loop.

If this ship sequence recurs, the clear candidate is the existing **`ship-change` skill** —
this session essentially hand-ran it via the second prompt.

## 7. Pitfalls & dead ends

- **Worktree cwd deleted out from under Bash.** After `git worktree remove`, the Bash tool's
  persistent cwd pointed at a now-deleted directory and every subsequent command failed.
  *If you hit X:* run the teardown from the **main repo root** (`cd pi-agent-dashboard`)
  or the sandbox shell, and do worktree removal **last**. The Bash tool can't re-anchor a deleted cwd.
- **First `gh pr create` failed** (base/head resolution) before succeeding — determine the
  default branch (`gh repo view --json defaultBranchRef`) and pass `--base develop` explicitly.
- **PR body quoting** — write the body to a file (`/tmp/pr-body.md`) and use `--body-file` to
  dodge shell-quoting breakage.
- **Full-suite red is not your red.** 25 failures were pre-existing (`pi-dashboard-server`
  timeouts, `pi-image-fit` Jimp import). *Do Y:* run `--project @blackbelt-technology/pi-dashboard-web`
  in isolation and confirm your diff is client-only before trusting/blaming the full run.
- **Brittle component DnD tests.** A positive-`isOver` mock was flaky; the indicator logic was
  already covered by `dropIndicatorProps` unit tests. *Do Y:* keep component tests to robust
  negative assertions and push the positive logic into pure-function tests.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a complete `openspec/changes/<name>/` (proposal + design + tasks),
the worktree checked out, `gh` auth, CodeRabbit configured on the repo.

**Do:**
1. `cd .worktrees/<name>` and `/skill:openspec-apply-change <name>`; if skills don't resolve, say "use ospx skills from the worktree's parent directory."
2. Read proposal/design/tasks, then grep the existing DnD surface (`SessionList.tsx`, `Sortable*`, `App.tsx`, shared protocol types).
3. Write pure logic + unit tests first (`sidebar-dnd.ts`), then thin `Sortable*` wrappers, then integrate.
4. `npx tsc --noEmit` → `vitest run --project @blackbelt-technology/pi-dashboard-web` → full suite (isolate pre-existing failures).
5. Mark tasks done, `openspec validate --strict`, delegate docs-index rows to a subagent.
6. Ship in one command: *"archive, synch, create PR, monitor CI, fix coderabbit, when OK, merge branch, delete branch, delete worktree."*
7. Run all teardown from the **main repo root**; remove the worktree **last**.

**Artifacts produced:**
- `packages/client/src/lib/sidebar-dnd.ts`
- `packages/client/src/components/SortableWorkspace.tsx`
- `packages/client/src/components/SortableWorkspaceFolder.tsx`
- `packages/client/src/lib/__tests__/sidebar-dnd.test.ts`
- `packages/client/src/components/__tests__/workspace-drag-reorder.test.tsx`
- Edited: `SortablePinnedGroup.tsx`, `WorkspaceHeader.tsx`, `SessionList.tsx`, `App.tsx`
- New spec: `openspec/specs/sidebar-drag-reorder/spec.md`
- Merged PR [#141](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/141) → `develop` (`ded31d0d`)

---

_Generated from session `019ee680-e1b6-7b3f-8c35-f4205e6daa96` · `pi-agent-dashboard/.worktrees/os-workspace-directory-drag-reorder` · 2026-06-20. Source extract: deterministic facts sheet._
