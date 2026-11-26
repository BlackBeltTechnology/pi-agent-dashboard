## Context

- `PluginSpawnOptions.mode?: "worktree" | "local"` exists; its comment documents the `local` fallback (`packages/dashboard-plugin-runtime/src/server/server-context.ts:378-384`). `PluginSpawnResult` is `{ success, message?, spawnToken?, warning? }` (`:758-765`).
- The host hook is in `packages/server/src/server.ts:4351`. It refuses plugins with `manifest.priority > 100` (`:4352-4355`), validates `opts`, files the plugin ref (`:4402`) and enqueues the initial prompt on `opts.cwd` (`:4418`), logs a warning for `mode=worktree` (`:4419-4430`), then spawns in `opts.cwd` and keys the watchdog and headless PID registry on it (`:4431-4446`).
- Worktree creation is already a shared function: `addWorktree({ cwd, base, newBranch?, path?, force? })` in `packages/server/src/git-worktree/git-operations.ts:768`. It validates every argument with `isValidRefArg` (`git-worktree/ref-arg.ts`) before git runs, and returns typed errors `not_a_repo | cwd_invalid | invalid_ref | branch_in_use | branch_exists | path_exists | base_not_found | git_failed | git_not_found` (`:702-713`). With no `newBranch` it checks out the existing `base` ref (checkout mode). `POST /api/git/worktree` calls it (`routes/git-routes.ts:695-745`).
- `listWorktrees(cwd)` lists registered worktrees (`git-operations.ts:650`), including the main checkout (`isMain`) and registrations whose directory is gone (`exists: false`). `parsePorcelainWorktrees` strips `refs/heads/`, so `WorktreeEntry.branch` is the bare name.
- `POST /api/git/worktree` admits `cwd` first through `validateCwd` (`routes/git-routes.ts:254-272`): `admitGitCwd` (known-folder admission via `admitRouteCwd`, `lib/route-admission.ts:57`, realpath; it ties the admission release to the Fastify reply, `:241-244`) plus a directory check. An undecidable admission is a 503 `cwd-admission-unavailable`. `addWorktree` itself does no admission and is synchronous (`execFileSync`).
- `spawnPiSession` resolves the host cwd-policy floor from the spawn cwd (`spawn-process/process-manager.ts:904`, `cwdPolicyRegistry?.resolve(cwd)`).
- `worktreeInitRegistry.startRun` overwrites any run for the cwd (`worktree-init-registry.ts:169-171`).
- `resolveDefaultBase(cwd)` returns `string | null` (`git-operations.ts:1289`).
- `pendingAttachRegistry` has `enqueue`/`consume`/`withdraw` (`pending/pending-attach-registry.ts:31-35`); `pendingWorktreeBaseRegistry` has no `withdraw`. Spec `git-context` "Worktree base ref persisted in session meta" says only dialog-spawned sessions carry `gitWorktreeBase`.
- Browser spawn intents (`browser-handlers/session-action-handler.ts:821-856`): `pendingAttachRegistry.enqueue(cwd, attachProposal)`, `pendingWorktreeBaseRegistry.enqueue(cwd, gitWorktreeBase)` (after `isValidRefArg`). On spawn failure `withdrawSpawnIntents` withdraws attach and initial prompt only (`:850-857`). `event-wiring`'s `session_register` hook consumes them.
- Auto-init on spawn is browser-side: `packages/client/src/lib/git/auto-init-worktree.ts` runs the hook after a spawn when the `autoInitWorktreeOnSpawn` preference is on (`persistence/preferences-store.ts:114`), the hook is TOFU-trusted and the gate reports `needsInit`. The server gate is `POST /api/git/worktree/init` (`routes/git-routes.ts:581`, body `:596-688`): it reads the hook from `resolveConfigRoot(cwd)`, checks trust against that config root, refuses an untrusted hook (`init_untrusted`) unless `confirmHash` matches, uses `evaluateGateCached`/`invalidateGateCache`, drives `worktreeInitRegistry.startRun`/`progressRun`/`finishRun`, broadcasts progress by cwd (`sendCwd`) and redacts stderr. Server pieces: `readInitHook` (`worktree-init.ts:57`), `evaluateGate` (`:97`), `runInitHook` (`:180`), `isTrusted` (`worktree-init-trust.ts:147`), run state in `worktree-init-registry.ts`.
- Consumer: `add-project-workflows` (active) needs "create or reuse `os/<change>`, attach, init, prompt" without a human dialog.

## Goals / Non-Goals

**Goals:** create-or-reuse a worktree for a plugin spawn through `addWorktree`; typed failures that never fall back to `cwd`; per-repo serialization; attach and init with the dashboard's existing rules.

**Non-Goals:** worktree removal or merge after a run (ship-change / worktree lifecycle); making a bare `mode: "worktree"` create worktrees; new trust grants; changing `POST /api/git/worktree`.

## Decisions

### D1. `ensureWorktree` wraps `addWorktree`; the REST route is unchanged

New `ensureWorktree({ cwd, branch, base?, ifExists, checkTarget })` in `packages/server/src/git-worktree/ensure-worktree.ts`, returning `{ ok: true, path, branch, created } | { ok: false, code, message }`. It never throws: every git error or exception maps to a D5 code. Order: D3 shape (in the hook) → D3 admission → repository resolution (`not_git`) → D3 branch validation → lock (D4) → the steps below. `checkTarget(path)` is the hook's cwd-policy check (D6); it runs on the reused or derived target path (`<main>/.worktrees/<slugifyBranch(branch)>`) before any mutating git call, including `git worktree prune`. Inside the per-repo lock (D4):

1. `listWorktrees(cwd)` and match `entry.branch === branch` (bare name). If the match is a registration with `exists: false`, run `git worktree prune` once and re-list. If the match is the main checkout (`isMain`) or a path outside `<main checkout>/.worktrees/`, fail with `branch_in_use`: a plugin only ever runs in a contained worktree. Otherwise `reuse` returns it (`created: false`) and `fail` returns `exists`. A repository with no resolvable main checkout (bare hub) fails `not_git`, as `addWorktree` does.
2. Local branch `<branch>` exists with no worktree → `addWorktree({ cwd, base: branch })` (checkout mode).
3. Only `refs/remotes/origin/<branch>` exists → `addWorktree({ cwd, base: "origin/<branch>", newBranch: branch })`, so earlier pushed work is continued, not forked over.
4. Otherwise → `addWorktree({ cwd, base: base ?? resolveDefaultBase(cwd), newBranch: branch })`. Only here is `base` verified (`git rev-parse --verify --end-of-options <base>^{commit}`); a failed check or a `null` default base fails `base_not_found`.

`ifExists` applies only to step 1. Steps 2–3 count as `created: true`. In steps 1–3 the caller's `base` is not used; the result reports `created` so the caller can tell. Step 3 reads local `refs/remotes/origin/*` without fetching; a caller that needs the latest remote state fetches first.

### D2. Opt-in by block, not by mode

Only a `worktree: {…}` block with `mode: "worktree"` triggers creation. A bare `mode: "worktree"` keeps the documented fallback, so existing `automation.yaml` files keep running in `cwd`. Rejected: honour bare mode with an auto branch name; it silently changes every existing automation.

### D3. Admission and validation before git

`cwd` passes the same admission as the route: `ensureWorktree` calls `admitRouteCwd` with the route's known-folder set plus the same directory check, and releases the admission in a `finally` (the route keeps its reply-bound `admitGitCwd`, unchanged), so a plugin cannot create worktrees in a folder the route would refuse. Shape first: with `mode: "worktree"`, a present `worktree` value that is not an object, a missing `branch`, an `ifExists` other than `reuse`/`fail`, or an `attachChange` that is not a kebab-case change name (`^[a-z0-9][a-z0-9-]{0,99}$`) fails `invalid_block` before any git call; it never falls back to local. Then `branch` and `base` pass `isValidRefArg` first, then `git check-ref-format --branch <branch>` (a name containing `@{` is rejected); `base` gets `isValidRefArg` here and its existence check only in D1 step 4. the derived path (`slugifyBranch`) must resolve under `<repo>/.worktrees/`. A branch or containment failure returns `branch_invalid`; all of these run before any mutating git call. The `attachChange` pattern is deliberately stricter than the dialog's `attachProposal` (any non-empty string): it is plugin input. Arguments go as argv, never through a shell (as `addWorktree` already does).

### D4. Per-repo async mutex

Keyed by the repository's common git dir (`git rev-parse --git-common-dir`, resolved), so two worktrees of one repo share a key. Held from step 1 to the end of `addWorktree`. Re-listing inside the lock is what makes concurrent `reuse` calls create one worktree. `POST /api/git/worktree` takes the same lock around its `addWorktree` call, so a dialog create and a plugin create for one repo are serialized too; the route's responses are unchanged.

### D5. Public failure codes

`PluginSpawnResult` gains `code?` and worktree fields. Mapping from `addWorktree`:

| `addWorktree` / ensure | public `code` |
|---|---|
| shape failure (D3) | `invalid_block` |
| `not_a_repo`, `cwd_invalid`, admission refusal, bare hub | `not_git` |
| admission undecidable (503 on the route) | `admission_unavailable` (retryable) |
| `invalid_ref`, D3 failures | `branch_invalid` |
| D1 step 1 with `ifExists: "fail"` | `exists` |
| `base_not_found`, null default base | `base_not_found` |
| `branch_in_use`, D1 step 1 main-checkout match | `branch_in_use` |
| D6 policy check | `policy_mismatch` |
| awaited init fails (D6) | `init_failed` |
| `branch_exists`, `path_exists`, `git_failed`, `git_not_found`, any caught exception | `git_failed` |

Every failure returns `success: false` and spawns nothing.

### D6. Spawn cwd and post-create wiring on the server

`ensureWorktree` runs right after option validation, BEFORE the plugin ref is filed or any intent is enqueued. On failure the hook returns and nothing is filed. On success every later step uses `spawnCwd = worktreePath` instead of `opts.cwd`. The hook's `checkTarget` compares `cwdPolicyRegistry.resolve(target)` with `resolve(opts.cwd)` inside `ensureWorktree`, before any git write; a missing or different floor fails `policy_mismatch`. Then the initial-prompt enqueue and its withdraw, `spawnPiSession`/`spawnAcpSession`, `armSpawnWatchdog` and the headless PID registry. `attachChange` is enqueued on `pendingAttachRegistry` keyed by `spawnCwd` and withdrawn if the spawn fails; when `enqueue` returns `false` (queue full) the spawn proceeds and the result carries `warning: "attach queue full; session not attached"`.

No `gitWorktreeBase` is written: spec `git-context` reserves it for dialog spawns, and workflows land through ship-change, not the merge endpoint.

Init: extract the run body of `POST /api/git/worktree/init` (`routes/git-routes.ts:596-688`) into a shared `startWorktreeInit(cwd, { confirmHash? })` that both the route and the hook call, so config-root resolution, trust, gate cache, registry run state, `sendCwd` broadcast and stderr redaction stay identical. With `{ skipIfRunning: true }` it returns `already_running` when the registry holds a running run for the cwd; the route does not pass it and keeps today's behaviour. The hook calls it for a created or reused worktree, when `autoInitWorktreeOnSpawn` is on, without `confirmHash`, with `skipIfRunning: true`, BEFORE filing intents and spawning, and awaits it: an unattended workflow prompt (for example `/skill:ship-it`) must not run before `pnpm install` finishes. Init failure returns `init_failed` and spawns nothing; the worktree is kept. An untrusted hook returns `init_untrusted`, is never run, and the spawn proceeds (init pending, shown by the init-status probe), as today. `spawnCwd` needs no separate admission: it is contained under the admitted repository's `.worktrees/`, and `resolveConfigRoot(spawnCwd)` resolves the same config root as the route does for that path. This adds a server-side trigger for plugin spawns next to the browser one in `worktree-auto-init`; the browser rule is unchanged.

### D7. Logging

One line per worktree spawn: `[plugin-spawn] worktree <created|reused|failed> plugin=<id> branch=<branch> code=<code>` (no paths beyond the repo-relative worktree dir).

## Risks / Trade-offs

- **SDK surface growth**: additive optional fields on `PluginSpawnOptions` and `PluginSpawnResult`.
- **Disk growth** from workflow-created worktrees: callers choose `reuse`; cleanup stays with ship-change.
- **Awaited init**: `spawnSession` can take minutes when an init runs; plugin callers already await it.
- **Created but not spawned**: when the spawn fails after `addWorktree` created the worktree (or init fails), the worktree and branch stay. A retry with `ifExists: "reuse"` continues in it; `fail` would return `exists`, so workflows use `reuse`.
- **Shared cwd FIFOs**: two concurrent `reuse` spawns into one worktree enqueue attach and prompt intents on the same cwd-keyed FIFO; registration order decides which session gets which. Same limitation as two dialog spawns into one folder. The spec guarantees pairing for a single spawn only; callers that need strict pairing spawn one session per worktree.
- **Blocking git**: `addWorktree` runs `git worktree add` synchronously, blocking the event loop for its duration, as the route already does.
- **Older hosts**: a host without this change ignores the block and runs in `cwd`. The SDK comment tells callers to treat a success without `worktreePath` as "not in a worktree" and stop.
- **Remote-only branch** (D1 step 3) assumes the remote is `origin`, as ship-change and ship-batch do.

## Migration / Rollback

No data migration. Rollback: revert the block handling; callers get the legacy local fallback and must treat a missing `worktreePath` in the result as "not in a worktree".

## Open Questions

None.
