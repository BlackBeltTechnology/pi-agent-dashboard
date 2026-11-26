## Why

Server plugins spawn pi sessions through `ServerPluginContext.spawnSession`, whose
`PluginSpawnOptions.mode` already declares `"worktree" | "local"`. The host hook
(`packages/server/src/server.ts:4351`) never implemented worktree creation: the
type comment in `packages/dashboard-plugin-runtime/src/server/server-context.ts:378-384`
documents that `worktree` falls back to `local`. Only the browser path
(`WorktreeSpawnDialog` → `POST /api/git/worktree` → `spawn_session`) creates a
worktree.

Project workflows (`add-project-workflows`) need a server-side "create or reuse
worktree `os/<change>`, attach the change, run the init hook, start a prompt"
step. Without it the develop → worktree hop can only happen through a
human-driven dialog.

## What Changes

- **NEW `worktree` block on `PluginSpawnOptions`:**
  `{ branch, base?, ifExists: "reuse" | "fail", attachChange? }`. When present
  (with `mode: "worktree"`), the host creates the worktree through `addWorktree()`,
  the function `POST /api/git/worktree` already uses (same path layout under
  `.worktrees/`, same `.git/info/exclude` handling, same argument validation), or
  reuses an existing worktree for that branch, then spawns the session in it. An
  existing local branch is checked out; a branch that exists only on `origin` is
  continued from `origin/<branch>`, not forked over.
- **Change attachment** at spawn (`attachChange`), identical to the dialog's
  `attachProposal`; the initial prompt, watchdog and PID tracking follow the
  session into the worktree. No `gitWorktreeBase` is written (dialog-only per
  `git-context`).
- **Admission:** `cwd` passes the same known-folder admission as
  `POST /api/git/worktree`.
- **Init hook** runs per the existing `autoInitWorktreeOnSpawn` preference and
  the existing TOFU trust. Today that trigger is browser-side
  (`packages/client/src/lib/git/auto-init-worktree.ts`), so the host starts the
  run itself and awaits it before spawning (an unattended prompt must not race
  `pnpm install`); an untrusted hook is never run (init stays pending, surfaced
  as today).
- **Result** reports `{ worktreePath, branch, created: boolean }`; failures are
  typed (`invalid_block`, `not_git`, `admission_unavailable`, `branch_invalid`,
  `exists`, `base_not_found`, `branch_in_use`, `policy_mismatch`, `init_failed`,
  `git_failed`)
  and never fall back to `local`.
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
- `packages/server`: new `git-worktree/ensure-worktree.ts` (`ensureWorktree` over
  `listWorktrees` + `addWorktree`, per-repo lock); spawn hook in `server.ts` calls
  it, enqueues the attach intent, and starts a trusted init run through an init
  starter shared with `POST /api/git/worktree/init`. The worktree route takes the
  same per-repo lock.
  `POST /api/git/worktree` is unchanged.
- No browser-protocol change. No migration.
