## Context

The dashboard spawns pi sessions in the repository's main working tree via `process-manager.ts` (tmux, Windows Terminal, WSL-tmux, or headless). When multiple sessions edit files in the same checkout concurrently, they risk merge conflicts and clobbered changes. Git worktree isolation solves this at the git level — each worktree is an independent checkout.

Pi sessions already work correctly inside git worktrees (the footer shows the correct branch, browse detects `.git` files). What's missing is the dashboard's ability to CREATE a worktree as part of the spawn flow and expose it through the UI.

The existing `BranchPicker` component already provides branch typeahead. The existing spawn flow (`/api/sessions/spawn`) accepts `cwd`, `strategy`, `mode`, and `sessionFile`. This design adds a `worktree` option to that flow.

## Goals / Non-Goals

**Goals:**
- Spawn a pi session inside a git worktree from the dashboard (web + mobile)
- Automatically create the worktree via `git worktree add` before pi launch
- Show worktree sessions distinctly in the session list (branch name, worktree icon)
- Mobile-friendly spawn dialog: full-screen sheet, large touch targets, branch typeahead
- Provide a worktree listing API so the UI can show existing worktrees
- Clean up stale worktrees (optional, user-initiated)

**Non-Goals:**
- Managing worktrees created outside the dashboard (list only, no mutation)
- Worktree support for non-git directories
- Pruning worktrees on session end (future: `worktree-session-cleanup`)
- Jujutsu (jj) workspace support
- Electron-specific worktree UI

## Decisions

### 1. Pre-spawn hook in process-manager

Add a `preSpawnHook` callback option to `spawnPiSession`. When `spawnMode: "worktree"` is passed, the hook runs `git worktree add <path> <branch>` before pi launch. If the hook fails, spawn fails with a descriptive error.

**Rationale**: Minimal change to existing spawn code. The hook runs synchronously before any process creation, so failures surface early. Alternative considered: separate spawn function — rejected because it duplicates the per-mechanism spawn logic (tmux/wt/wsl-tmux/headless) for no benefit.

### 2. Worktree path convention

Worktrees created by the dashboard live at `<repo-root>/../.pi-worktrees/<branch-slug>-<timestamp>/`. The parent directory `.pi-worktrees/` is gitignored by the dashboard (added on first worktree creation). The repo root is resolved from the spawn `cwd`.

**Rationale**: Keeps worktrees out of the main working tree, prevents accidental commit, and groups them in a predictable location. The timestamp avoids collisions when re-spawning on the same branch. Alternative considered: `git worktree` default location (sibling dirs like `../feature-x`) — rejected because it pollutes the parent directory.

### 3. Reuse BranchPicker for branch selection

The existing `BranchPicker` component provides typeahead branch selection with keyboard navigation. The worktree spawn dialog wraps it in a mobile-friendly full-screen sheet.

**Rationale**: No new branch-listing API. The `BranchPicker` already fetches branches via `/api/git/branches`. Same component, same data, mobile-optimized container.

### 4. WorktreeManager module

New `packages/server/src/worktree-manager.ts` encapsulating:
- `addWorktree(repoRoot, branch, label?)` → `{ path, branch }`
- `listWorktrees(repoRoot)` → `WorktreeInfo[]` (path, branch, head, bare, locked) — matches `git worktree list --porcelain` output
- `removeWorktree(repoRoot, path)` → void

Uses `git worktree` CLI directly via `execSync`. No new dependencies.

**Rationale**: Separate module keeps git worktree logic testable in isolation from spawn orchestration.

### 5. API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST /api/sessions/spawn` | Added `spawnMode: "worktree"` and `branch: string` fields |
| `GET /api/git/worktrees?cwd=<path>` | List existing worktrees for a repo |
| `DELETE /api/git/worktrees` | Remove a worktree (body: `{ cwd, path }`) |

**Rationale**: Spawn endpoint extended rather than new endpoint — the "spawn in worktree" action is still a spawn, just with a pre-step. Worktree CRUD lives under `/api/git/` alongside existing git endpoints.

### 6. Mobile-friendly dialog pattern

The worktree spawn dialog uses a full-screen sheet (slides up from bottom on mobile, centered modal on desktop) with:
- Branch typeahead (reused `BranchPicker`)
- Optional worktree label input
- "Spawn in worktree" primary action button
- Large touch targets (min 44px, per WCAG)

**Rationale**: Full-screen sheet is the standard mobile pattern for focused actions (iOS sheets, Android bottom sheets). The existing `DialogPortal` component can render this with a `fullScreen` prop.

## Risks / Trade-offs

- **git worktree not installed**: Rare but possible on minimal containers. Mitigation: probe `git` availability on PATH at spawn time; probe `git worktree --help` to confirm subcommand exists. Return clear error `git_unavailable` if missing.
- **Disk space**: Each worktree is a full checkout (with hardlinks for objects). Mitigation: show worktree count in listing; provide manual cleanup.
- **Stale worktrees**: Sessions end but worktrees linger. Mitigation: list endpoint shows all worktrees; user can delete dashboard-managed worktrees only. External worktrees are read-only. Auto-cleanup is deferred to a future change.
- **Concurrent spawns on same branch**: Timestamp in path avoids collisions, but two sessions editing the same branch can still diverge. Mitigation: this is user-intended behavior; the worktree isolates the checkout, not the branch.
- **Input validation**: Branch names and paths passed to `git worktree` are shell-escaped to prevent injection. Branch name is validated against `[a-zA-Z0-9._/-]+` before use.
