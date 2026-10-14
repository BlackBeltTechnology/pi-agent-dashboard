## Why

Server plugins spawn pi sessions through `ServerPluginContext.spawnSession`, whose
`PluginSpawnOptions.mode` already declares `"worktree" | "local"`. The host hook
never implemented worktree creation: the type comment in
`packages/dashboard-plugin-runtime/src/server/server-context.ts` documents that
`worktree` falls back to `local`. Only the browser path
(`WorktreeSpawnDialog` → `POST /api/git/worktree` → `spawn_session`) creates a
worktree.

Project workflows (`add-project-workflows`) need a server-side "create or reuse
worktree `os/<change>`, attach the change, run the init hook, start a prompt"
step. Without it the develop → worktree hop can only happen through a
human-driven dialog.

## What Changes

- **NEW `worktree` block on `PluginSpawnOptions`:**
  `{ branch, base?, ifExists: "reuse" | "fail", attachChange? }`. When present
  (with `mode: "worktree"`), the host creates the worktree through the same core
  path as `POST /api/git/worktree` (same path layout under `.worktrees/`, same
  `.git/info/exclude` handling, same branch validation), or reuses an existing
  worktree for that branch, then spawns the session in it.
- **Change attachment** at spawn (`attachChange`), identical to the dialog's
  `attachProposal`.
- **Init hook** runs per the existing `autoInitWorktreeOnSpawn` preference and
  the existing TOFU trust; an untrusted hook is never run by this path (the spawn
  proceeds and init stays pending, surfaced as today).
- **Result** reports `{ worktreePath, branch, created: boolean }`; failures are
  typed (`not_git`, `branch_invalid`, `exists`, `git_failed`) and never fall back
  to `local`.
- **Compatibility:** `mode: "worktree"` *without* a `worktree` block keeps today's
  documented local fallback, so existing `automation.yaml` files with
  `mode: worktree` do not suddenly create worktrees per run.
- Trusted (first-party) plugins only, as `spawnSession` already is.

## Capabilities

### New Capabilities

- `plugin-spawn-worktree`: server-side worktree create-or-reuse for plugin spawns,
  with change attachment, init-hook handling, typed failures and a per-repo lock.

### Modified Capabilities

<!-- none: `plugin-spawn-scope` requirements are unchanged; the fallback for a bare `mode: "worktree"` is preserved -->

## Discipline Skills

- `security-hardening`: branch names and bases are plugin-supplied input reaching
  `git`; path containment under `.worktrees/`.
- `doubt-driven-review`: extends the public plugin SDK type `PluginSpawnOptions`.
- `observability-instrumentation`: log create/reuse/failure per spawn.
- `review-code`: before commit.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts`:
  `PluginSpawnOptions.worktree`, `PluginSpawnResult` worktree fields, mapper.
- `packages/server`: spawn hook in `server.ts` calls a function extracted from the
  `POST /api/git/worktree` handler (`git-routes.ts` / `git-worktree/`); per-repo
  creation lock; attach + auto-init wiring reused from the browser spawn path.
- No browser-protocol change. No migration.
