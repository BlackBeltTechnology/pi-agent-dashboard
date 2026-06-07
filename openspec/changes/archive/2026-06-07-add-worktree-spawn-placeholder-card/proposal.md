## Why

Spawning a normal session shows an immediate placeholder skeleton card in the target folder group, giving instant feedback during the spawn→register window. Spawning a **worktree** session shows nothing — the user clicks "Spawn →" in `WorktreeSpawnDialog` and stares at an unchanged list until the session registers (often several seconds: `git worktree add` + bootstrap + spawn + register).

Root cause: the placeholder is keyed by **raw spawn cwd**. `WorktreeSpawnDialog` calls `onSpawnSession(worktreePath, …)`, so `worktreePath` (e.g. `<repo>/.worktrees/feat-x`) enters `spawningCwds`. But:

1. No folder group exists with `group.cwd === worktreePath` — no session lives there yet, so the placeholder (`SessionList.tsx` ~712: `{spawningCwds.has(group.cwd) && <PlaceholderSessionCard/>}`) has no group to render in.
2. Even after register, worktree sessions group under the **parent repo** (`session-grouping.ts` precedence `pin > jjState.workspaceRoot > gitWorktree.mainPath > cwd`), never under their own path.

So the placeholder is keyed to a cwd no group will ever match — it is "homeless."

## What Changes

- The placeholder for a worktree spawn SHALL render in the **parent repo's** folder group (where the worktree session will land per the grouping precedence), keyed by the parent repo cwd — not the worktree path.
- The placeholder SHALL appear from **dialog submit** (the moment the user clicks "Spawn →"), covering BOTH latency windows: the server-side `createWorktree` call AND the subsequent spawn→register window.
- The parent folder's `+ New Session` button SHALL be **disabled** for the whole in-flight window (free consequence of keying on the parent cwd via the existing `spawningCwds.has(group.cwd)` disabled-button check).
- If `createWorktree` fails (`branch_in_use`, `path_exists`, `base_not_found`), the placeholder SHALL be removed immediately (dialog stays open showing the error), not left until the 30 s safety timeout.

Mechanism (refined Option A from explore):

- `WorktreeSpawnDialog` gains `onSpawnStart?(parentCwd)` (fired at top of submit, before `createWorktree`) and `onSpawnAbort?(parentCwd)` (fired when `createWorktree` rejects). The dialog already holds the parent `cwd` prop.
- The pending-spawn entry carries a `placeholderCwd` (the parent group cwd) distinct from the spawn `cwd` (the worktree path), so `clearSpawningCwd` keys on the group cwd at register / failure.
- All worktree dialog entry points funnel through the same `onSpawn` wiring, so this is wired once for both the plain (`worktreeDialogCwd`) and proposal-aware (`worktreeForChange`) mounts.

No server, protocol, or persistence changes. Normal (non-worktree) spawn behavior is unchanged.

## Capabilities

### Modified Capabilities
- `placeholder-spawn-card`: placeholder renders in the group that will host the spawned session (resolved via the session-grouping precedence), not the raw spawn cwd; gains a `placeholderCwd` distinct from the spawn `cwd` so worktree placeholders render under the parent repo group and clear correctly on register/failure.
- `worktree-spawn-dialog`: gains `onSpawnStart` / `onSpawnAbort` callbacks so a placeholder can appear from dialog submit (covering the `createWorktree` window) and be removed on `createWorktree` failure.

## Impact

- `packages/client/src/components/WorktreeSpawnDialog.tsx` — add `onSpawnStart?(parentCwd)` / `onSpawnAbort?(parentCwd)` props; fire `onSpawnStart(cwd)` at the top of the submit handler (existing + new worktree paths) before `createWorktree`; fire `onSpawnAbort(cwd)` in the `createWorktree` reject path.
- `packages/client/src/components/SessionList.tsx` — both `WorktreeSpawnDialog` mounts (`worktreeDialogCwd`, `worktreeForChange`) wire `onSpawnStart`/`onSpawnAbort` to add/remove the parent `cwd` from the spawning set; `onSpawn` passes `placeholderCwd: parentCwd` through to `onSpawnSession`.
- `packages/client/src/hooks/useSessionActions.ts` — `handleSpawnSession` accepts optional `placeholderCwd`; pending-spawn entry stores it; the placeholder is added/keyed under `placeholderCwd ?? cwd`. (For worktree spawns the set entry was already added by `onSpawnStart`, so `handleSpawnSession` must not double-add.)
- `packages/client/src/hooks/useMessageHandler.ts` — `session_added` requestId-tier clear and the cwd fallback use `entry.placeholderCwd ?? entry.cwd`; `spawn_result` failure clear likewise.
- Tests: `SessionList.test.tsx` (placeholder under parent group for worktree spawn; parent `+Session` disabled during worktree spawn), `useSessionActions` / `useMessageHandler` (clear keyed on `placeholderCwd`), `WorktreeSpawnDialog` (fires `onSpawnStart` at submit, `onSpawnAbort` on `createWorktree` reject).
- No changes to `src/server/`, `src/shared/`, or any WebSocket message.
