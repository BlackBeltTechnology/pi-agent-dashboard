# Fix worktree spawn: orphaned placeholder + session lands at bottom

## Why

Spawning a worktree session shows two defects (see screenshot report): the
"Starting new session…" placeholder card stays stuck at the top of the parent
group, and the real session card appears at the BOTTOM of the group instead of
taking the placeholder's slot. Plain (non-worktree) spawns are unaffected.

Root cause is an asymmetry between worktree and plain spawns, in two layers:

**Defect A — placeholder clear has no fallback for worktrees.**
`session_added` clears the placeholder in two tiers:
- Tier 1: `msg.spawnRequestId` matches a pending-spawn entry → clear
  `entry.placeholderCwd` (the parent repo). Works when the bridge echoes the
  spawn-correlation token.
- Tier 2: `spawningCwds.has(msg.session.cwd)` → clear `msg.session.cwd`.

For a plain spawn `placeholderCwd === session.cwd`, so Tier 2 is a safety net
when Tier 1 misses. For a worktree spawn `placeholderCwd` (parent repo) ≠
`session.cwd` (worktree path), so Tier 2 can never match — the placeholder is
orphaned whenever Tier 1 misses. There is no cwd-based fallback that maps the
worktree cwd back to its `placeholderCwd`, even though the mapping already sits
in the pending-spawn entry.

**Defect B — worktree session inserted under the wrong order key.**
On `session_register` the server computes the order key via
`resolveOrderKey(session)` and prepends the id (`SessionOrderManager.insert`
unshifts → front). The intent (per `session-ordering` spec) is "new session at
the front of its resolved group path". But at register time the bridge has NOT
yet sent `gitWorktree` (it arrives later via `git_info_update`, see
`event-wiring.ts` comment). So `gitWorktree.mainPath` is undefined and
`resolveOrderKey` resolves to the worktree's OWN cwd. The id is prepended to
`sessionOrder["/repo/.worktrees/…"]`. When `gitWorktree` later arrives the
client groups the session under the PARENT repo and reads
`sessionOrder["/repo"]` — where the id is absent — so the session falls to the
unordered bucket and renders at the bottom. The existing
"Worktree session keyed under parent repo" scenario is unsatisfiable for a
fresh spawn because its precondition (mainPath known at register) does not hold.

## What Changes

- **Client (Defect A):** add a Tier 2.5 fallback in the `session_added` handler.
  When no `spawnRequestId` matches a pending-spawn entry, scan pending spawns
  for an entry whose `cwd` equals `session.cwd` (path-normalized) and clear that
  entry's placeholder via its `placeholderCwd`. This gives worktree spawns the
  same resilience plain spawns already have.

- **Server (Defect B):** when `git_info_update` first establishes a session's
  `gitWorktree.mainPath` (or `jjState.workspaceRoot`) such that its resolved
  order key changes from the raw cwd to a parent key, the server SHALL move the
  id from the stale key to the resolved key, prepending it to the front of the
  resolved key's order, and broadcast `sessions_reordered` for the resolved key
  (and prune the now-empty/stale entry from the old key). The session then
  occupies the top slot the placeholder held.

- No protocol/message-shape changes. No persistence-format change (the
  `sessionOrder` map schema is unchanged; only which key an id lives under is
  corrected, with stale-key pruning).

## Impact

- Affected specs: `placeholder-spawn-card` (ADDED fallback requirement),
  `session-ordering` (ADDED deferred-key-resolution requirement).
- Affected code: `packages/client/src/hooks/useMessageHandler.ts`
  (`session_added` arm); `packages/server/src/event-wiring.ts`
  (`git_info_update` / gitWorktree-compose arm) + `SessionOrderManager`
  re-key helper.
- Migration: none — behavior-only fix.
- Compatibility: legacy bridges that send `gitWorktree` on the initial register
  are unaffected (key already resolves to parent; the re-key is a no-op).
- Rollback: revert the two arms; no state migration to undo. Stale worktree-cwd
  keys left by the old behavior are pruned on next register or harmlessly ignored
  (no session groups under them).
