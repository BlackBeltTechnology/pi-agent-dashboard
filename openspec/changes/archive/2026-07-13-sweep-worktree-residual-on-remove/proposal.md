## Why

Removing a worktree leaves a resurrected husk directory behind. Evidence: **113 orphan
`.worktrees/*` dirs**, each reduced to `.pi/dashboard/kb/{index.db, index.db-wal,
index.db-shm}` and nothing else — no `.git`, no `node_modules`, no source.

The `-wal` / `-shm` sidecars are the tell: a SQLite connection in WAL mode was **still
open** when removal ran. Mechanism, confirmed:

```
git worktree remove --force  →  rm -rf the worktree dir (tracked files + .pi/)
        │  a live pi session's kb-extension still HOLDS the index.db open (WAL mode)
        ▼
  extension's next open/reindex  →  RE-CREATES .pi/dashboard/kb/{index.db,-wal,-shm}
        ▼
  dir resurrected as a husk  →  `git worktree prune` removes git's admin entry
                                but NEVER deletes the physical directory
```

Neither removal path cleans up:

- **Server** `removeWorktree()` (`packages/server/src/git-operations.ts`) runs
  `git worktree remove [--force] <cwd>` and returns — no residual-dir sweep.
- **ship-change skill** §10 runs bare `git worktree remove` + `git worktree prune` from
  the parent repo — `prune` only drops admin metadata, never the dir.

The server already stamps `cwdMissing: true` and broadcasts `session_updated` on removal,
but it does so **after** the git remove, and **nothing tells the kb-extension to release
its DB handle** — so the open WAL connection recreates the directory in the race window.
The extension already has `closeKb(state)` (`packages/kb-extension/src/reindex.ts`); it is
just never triggered by cwd removal.

## What Changes

- **Release the kb DB handle before/at removal.** On `cwdMissing` (or a pre-remove signal),
  the kb-extension SHALL close any open store for that cwd (`closeKb`), checkpointing and
  releasing the WAL so nothing recreates the directory after git deletes it.
- **Sweep the residual directory after a successful `git worktree remove`.** `removeWorktree()`
  SHALL, on git success, remove any residual physical directory at the worktree path
  (guarded: only inside the parent repo's `.worktrees/`, only after git reports removed,
  never the main checkout). This covers the dashboard/UI path and ship-change's fallback.
- **ship-change skill sweeps too.** §10 gains a post-`prune` step to delete a residual
  `.worktrees/<name>` dir (its primary CLI path bypasses `removeWorktree()`).
- **One-shot prune of the existing 113 orphans.** A small maintenance script removes
  unregistered `.worktrees/*` directories (present on disk, absent from `git worktree list`).

## Capabilities

### Modified Capabilities

- `worktree-lifecycle`: the remove endpoint SHALL leave no residual directory — after a
  successful `git worktree remove` the worktree path SHALL NOT exist on disk; and kb DB
  handles for the removed cwd SHALL be released so the directory is not recreated.

## Impact

- **Scope**: `packages/server/src/git-operations.ts` (`removeWorktree` post-success sweep,
  path-guarded) + `packages/server/src/routes/git-routes.ts` (order: signal handle-close
  before/with the remove) + `packages/kb-extension/src/{extension,reindex}.ts` (close store
  on `cwdMissing`) + `.pi/skills/ship-change/SKILL.md` §10 + a `scripts/` prune utility.
  ~80–140 LOC + tests.
- **Data safety**: the sweep is hard-guarded to the parent repo's `.worktrees/` subtree and
  only runs after git confirms removal; it never touches the main checkout. The kb index is
  derived and rebuildable.
- **User-visible**: no more husk accumulation in `.worktrees/`; disk stays clean.

## Migration / Compatibility / Rollback

- **Migration**: the one-shot prune clears the 113 existing orphans; idempotent (skips
  registered worktrees).
- **Compatibility**: additive to the remove path; the endpoint contract (codes, guards,
  `cwdMissing` stamping) is unchanged except the added "no residual dir" postcondition.
- **Rollback**: revert the sweep + handle-close; orphans would resume accumulating.

## Non-Goals

- The kb-index failure-atomicity fix (`harden-kb-index-failure-atomicity`) — that stops an
  empty husk from *mattering* to the init gate; this change stops husks from *accumulating*
  in removed worktrees. Complementary, independent.
- Changing the active-session removal guard (`code: "active_sessions"`) or `--force`
  semantics — unchanged.
- Worktree-init feedback UI (`friendlier-worktree-init`) — orthogonal.

## Discipline Skills

- `security-hardening` — a post-remove `rm -rf` is destructive; the path guard (parent-repo
  `.worktrees/` subtree only, git-confirmed removal only, never the main checkout) is the
  core safety control and must be tested against path-escape inputs.
- `doubt-driven-review` — the remove ↔ handle-close ↔ sweep ordering is a race across a
  process boundary (server + live extension); review the transitions before they stand.
- `systematic-debugging` — the WAL-sidecar evidence pinned the resurrection mechanism;
  a regression test SHALL reproduce "open handle recreates dir after git remove".
