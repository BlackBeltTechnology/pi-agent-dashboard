## Context

The dashboard already supports a near-isomorphic concept: jj `.shadow/<name>/` workspaces. They were addressed by `add-jj-workspace-plugin` Decision 15, which extended `resolveSessionGroupPath` so that workspace sessions collapse under their parent repo via `jjState.workspaceRoot`. Git worktrees are structurally identical (peer working tree of a parent repo) but receive zero dashboard support today.

Two prior proposals (`worktree-awareness`, `workspace-actions`) covered fragments of this feature but were never implemented. They chose a sibling-directory layout (`<repo>-<branch>`), replaced the branch label entirely with a worktree-folder label, and did not address the session-grouping problem. This change supersedes both with a single coherent design.

Existing pieces this builds on (every dialog control, picker, and grouping primitive already exists):
- `BranchPicker.tsx` — typeahead branch picker with keyboard nav (reused for base selection)
- `PathPicker.tsx` — full-screen path picker (precedent for the dialog's visual style)
- `git-operations.ts` + `git-routes.ts` — branch listing + checkout endpoints (extend pattern)
- `FolderActionBar.tsx` — existing `+Session` button (worktree button sits beside)
- `WorkspaceSubcard.tsx` — already renders branch / PR info (pill slots in)
- `session-grouping.ts` — `resolveSessionGroupPath` + `clusterByWorkspaceName` (extend precedence)
- `.meta.json` writer — already exists for per-session UI metadata (carries `base` ref)

Constraint: do not introduce new visual hierarchy. jj workspaces today silently cluster within a folder with no visible divider. Worktree sessions match this behavior; sub-header rendering for clusters (worktree or jj) is a separate cross-cutting proposal.

## Goals / Non-Goals

**Goals:**
- Detect git worktrees in the bridge and propagate identity to the client.
- Group worktree sessions under their parent repo (mirror jj precedent).
- Give users a one-click button that lists existing worktrees and creates new ones, then spawns a session in the chosen one.
- Use `.worktrees/<slug>/` layout, idempotently ignore it via `.git/info/exclude`.
- Honest WORKSPACE-subcard surfacing: keep branch as primary identity, add `worktree` pill.
- Preserve backward compatibility with older bridges (worktree fields optional).

**Non-Goals:**
- Worktree removal / cleanup UI.
- Submodule init / LFS handling.
- Bare-repo + worktree layout (deferred to a later config option).
- Visible cluster sub-headers within a folder group (cross-cutting; covers jj too).
- Editing existing worktree's branch.

## Decisions

### 1. Worktree detection method

**Decision**: Run `git rev-parse --git-common-dir` and `git rev-parse --show-toplevel` in the session's cwd. If `git-common-dir` resolves outside `show-toplevel`, it's a worktree; otherwise it's the main checkout.

**Rationale**: This is the canonical way git distinguishes worktrees. A `.git`-as-file stat check (used by the superseded `worktree-awareness` proposal) detects 95% of cases but fails for the main repo when the user runs from a nested working directory (where `.git` isn't an immediate child). Two `rev-parse` calls cost ~1 ms each and we already shell out for branch/remote in the same pass.

**Alternatives considered**:
- `.git` file vs directory stat — simpler but less robust (see above).
- `git worktree list --porcelain` per session — overkill; the list endpoint reuses this when actually needed.

### 2. Data flow

**Decision**: Add `gitWorktree?: { mainPath: string; name: string; base?: string }` to `DashboardSession` and to `GitInfo`. The bridge populates the first two from rev-parse; `base` is populated only at spawn time when our dialog calls `POST /api/git/worktree` (we already know the base then) and is persisted to `.meta.json` so it survives reload.

**Rationale**: Single optional struct keeps the protocol additive and lets the client treat `gitWorktree == null` as "plain checkout". Separating `base` (post-create metadata) from `{mainPath, name}` (live git fact) avoids polluting the bridge with state it can't reconstruct (`git` doesn't record what ref a worktree was forked from).

**Alternatives considered**:
- Flat `isWorktree` boolean (the `worktree-awareness` approach) — loses the parent-path data needed for grouping.
- Three top-level fields — clutters `Session` for a feature most sessions don't care about.

### 3. Grouping precedence

**Decision**: Extend `resolveSessionGroupPath` precedence to:
```
1. pin matches cwd           → group under cwd
2. jjState.workspaceRoot     → group under parent repo (existing jj behavior)
3. gitWorktree.mainPath      → group under main worktree     ← NEW
4. else                      → group under cwd
```
And extend `clusterByWorkspaceName` to also key on `(jjState?.workspaceName ?? gitWorktree?.name ?? "")` so worktree sessions cluster adjacent within their parent group, the same way jj workspace sessions already do.

**Rationale**: Direct precedent in Decision 15 of `add-jj-workspace-plugin`. Pin-wins is preserved (a user who explicitly pins a worktree path gets its own group). When both jj and worktree apply (unlikely but possible — a jj workspace inside a git worktree), jj wins because it's evaluated first; documented but not enforced.

**Alternatives considered**:
- Re-order so worktree wins over jj — no clear reason, and reversing established precedence is intrusive.
- Visible sub-header per cluster — out of scope per non-goals; would also need to retro-fit jj for consistency.

### 4. Layout: `.worktrees/<slug>/`

**Decision**: New worktrees go to `<repo>/.worktrees/<slug(branchName)>/`. Slug rule:
```
slug(branchName) =
  branchName
    .toLowerCase()
    .replace(/[\/\\:\s]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
```
Path is rendered into the dialog as a preview and is editable so users can break out of the convention.

On first creation in a repo, the server SHALL append `.worktrees/` to `<repo>/.git/info/exclude` if absent. Idempotent. Never touches `.gitignore`.

**Rationale**: `.worktrees/` nested inside the repo (a) keeps the user's `~/Project/` parent dir uncluttered, (b) groups all worktrees in one place per repo. `.git/info/exclude` is local-only (per-clone), invisible to other contributors, and the right place for opinionated tooling additions.

**Alternatives considered**:
- Sibling layout `<parent>/<repo>-<branch>` (man-page example, used by `workspace-actions`) — pollutes parent directory; deferred as a config option in a later change.
- Bare repo + worktree siblings — requires repo conversion; out of scope.
- Append to `.gitignore` instead of `.git/info/exclude` — surprises other contributors; we don't own their repo.

### 5. Base-branch fallback

**Decision**: When the user opens the dialog, default base is computed:
```
current branch (if not detached)
  → develop  (if exists locally OR as origin/develop)
  → main
  → master
  → fail with "no usable default base — pick one"
```
Remote branches (`origin/<name>`) appear in the picker; selecting one creates the worktree with `git worktree add -b <newBranch> <path> origin/<name>`.

**Rationale**: Matches user's stated rule with safety fallbacks. The chain handles repos that use any of the three conventional default-branch names. Detached state can never be the base because `git worktree add ... <SHA>` would silently create a detached worktree — confusing default.

**Alternatives considered**:
- Single-step `develop` fallback (user's original spec) — fails on repos without `develop`; we already need fallbacks for those.
- Use HEAD SHA on detached fallback — creates detached worktrees, almost never what users want.

### 6. Unified dialog (existing + new)

**Decision**: Clicking `+Worktree Session` opens a single fullscreen dialog with two stacked sections:
1. **Existing worktrees of the repo** (top): each row is `⎇ <branch>   <relative-path>   [Spawn →]`. Main checkout is listed. Selecting a row immediately calls `spawn` with that cwd, dialog closes.
2. **Create a new one** (below, separator): base picker (defaults per Decision 5), new-branch input (required), path preview (derived per Decision 4, editable). Submit calls `POST /api/git/worktree`, then `spawn` on the returned path.

The "existing" list is sourced from a single new endpoint `GET /api/git/worktrees` (parses `git worktree list --porcelain`). It returns the same data regardless of which worktree the user opened the dialog from — `git worktree list` is repo-wide.

**Rationale**: One button, one mental model. Discovering existing worktrees discourages duplicate-creation. The list endpoint is needed for the WORKSPACE-subcard pill's tooltip anyway, so we reuse it.

**Alternatives considered**:
- Separate "list" and "create" dialogs — two entry points to remember, more code, no UX win.
- List + create on hover-revealed expand — discoverability problem.

### 7. WORKSPACE-subcard worktree pill

**Decision**: When `session.gitWorktree` is set, the WORKSPACE subcard renders an inline pill `worktree` immediately after the `⎇ <branch>` line. Hover/long-press shows `worktree of <base>` if `base` is known (and just `worktree` otherwise). The branch line itself is unchanged — branches remain the primary identity of a session.

**Rationale**: Branches are the user's primary mental key; replacing them with a folder name (as the superseded `worktree-awareness` proposal did) hides important information. A pill is non-disruptive, fits the existing badge slots in the subcard, and the tooltip carries the auxiliary `base` context cheaply.

**Alternatives considered**:
- Replace `⎇ branch` with `🌲 folder-name` (`worktree-awareness` plan) — hides branch identity.
- Inline `(worktree of develop)` text — clutters the line on small viewports.
- Pill in card header instead of WORKSPACE subcard — pulls the worktree fact away from other git context.

### 8. Endpoint shape

**Decision**: Three new localhost-only routes in `git-routes.ts`:
- `GET /api/git/head?cwd=<path>` → `{ branch: string | null, detached: boolean, sha: string | null }`. Cheap; reads `git symbolic-ref --quiet HEAD` and `git rev-parse --short HEAD`.
- `GET /api/git/worktrees?cwd=<path>` → `{ worktrees: Array<{ path, branch, bare, detached, isMain }> }`. Parses `git worktree list --porcelain`.
- `POST /api/git/worktree` → body `{ cwd, base, newBranch, path?, force? }`. Runs `git worktree add -b <newBranch> <path> <base>`. If `path` omitted, server derives `<repo>/.worktrees/<slug(newBranch)>`. Returns `{ path, branch }` or structured error. On success, appends `.worktrees/` to `.git/info/exclude` if absent.

All three follow the existing `git-routes.ts` patterns: localhost-gated, `safeRealpathSync` on cwd, structured errors with stable codes (`not_a_repo`, `branch_in_use`, `path_exists`, `no_usable_base`).

**Rationale**: Three orthogonal verbs. The `head` endpoint is reused by the dialog to pre-fill the base default; the `worktrees` endpoint feeds both the list section of the dialog and (eventually) the pill tooltip; the `worktree` endpoint does the create.

**Alternatives considered**:
- One mega endpoint — bad for caching and testing.
- WebSocket actions — overkill for one-off REST calls.

## Risks / Trade-offs

- **Submodules**: `git worktree add` does not init submodules. → Dialog shows a footnote when the repo has submodules: "submodules will not be initialized in the new worktree." No automation in v1.
- **LFS**: Worktrees share `.git/hooks`; LFS smudge may be slow on first checkout. → Out of scope; documented in change notes.
- **Untracked `.env` / `node_modules`**: Don't come with a worktree. → Footnote in dialog: "worktree starts clean."
- **`.git/info/exclude` write**: Permission failure (read-only `.git/`) would silently fail today. → Endpoint logs warning but returns success — the worktree itself is created; the ignore-write is non-critical.
- **`safe.directory`**: If dashboard runs as a different user than repo owner, all git invocations may trip `safe.directory`. → Inherits existing `git-routes.ts` handling; no new exposure.
- **Branch name collisions**: `feat/foo` and `feat-foo` slug to the same path. → Path preview is editable; user resolves manually if collision detected (file exists pre-check).
- **Two worktrees with same branch name** can't coexist; we surface the structured `branch_in_use` error inline in the dialog.
- **Stale `.meta.json` `base`**: If the user later runs `git branch --set-upstream` or rebases the worktree, the recorded `base` becomes inaccurate. → Tooltip text says "created from <base>" (past tense) to make this honest.
- **Cross-platform path separators**: Windows. → Reuse `normalizePath` from `platform/paths.ts`; tests cover both.

## Migration Plan

No data migration. The `gitWorktree` field is additive and optional — older bridges and clients tolerate its absence. New `.meta.json` field (`gitWorktreeBase`) is read-only-when-present.

Deployment order (server before client matters because the client polls these endpoints on dialog open):
1. Ship bridge detection + new endpoints + grouping logic.
2. Ship dialog + button + pill.
3. Archive `worktree-awareness` and `workspace-actions` as superseded (no specs to merge; their tasks were unimplemented).

Rollback: revert the client; backend changes are inert without the dialog (endpoints serve correctly but no one calls them). The bridge fields are optional and ignored by older clients.

## Open Questions

None remaining from the design discussion. The following were considered and explicitly deferred:

- Cluster sub-headers (visible "feat-x" divider inside a folder group) — separate proposal; would retro-fit jj for consistency.
- Bare-repo + worktree layout — separate proposal once `.worktrees/` is in use and we've learned what users actually want.
- Worktree removal UI — separate proposal; CLI works today.
- Sub-modules / LFS automation — separate proposals if user demand emerges.
