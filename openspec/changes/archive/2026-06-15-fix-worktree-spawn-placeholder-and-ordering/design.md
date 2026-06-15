# Design

## Defect A — client Tier 2.5 placeholder clear

### Decision
Add a single fallback branch in `useMessageHandler.ts` `case "session_added"`,
AFTER the Tier 1 (`spawnRequestId`) lookup and the existing Tier 2
(`spawningCwds.has(session.cwd)`) check both miss:

```
// Tier 2.5: worktree-aware fallback. No spawnRequestId matched and the
// session's own cwd is not in spawningCwds (true for worktree spawns,
// whose placeholder is keyed by the PARENT cwd). Scan pending spawns for
// an entry whose tracked spawn cwd equals this session's cwd and clear
// its placeholderCwd.
for (const [requestId, entry] of pendingSpawnsRef.current) {
  if (entry.kind === "spawn" && pathKey(entry.cwd) === pathKey(session.cwd)) {
    pendingSpawnsRef.current.delete(requestId);
    clearSpawningCwd(entry.placeholderCwd ?? entry.cwd);
    navigate(`/session/${session.id}`);
    break;
  }
}
```

### Rationale
- The worktree→parent mapping already lives in the pending-spawn entry
  (`{ cwd: worktreePath, placeholderCwd: parent }`); Tier 2.5 just consults it.
- `pathKey` (already exported from `session-grouping.ts` / shared
  `session-group-path.ts`) normalizes trailing-slash + case so the compare is
  robust on win32/darwin.
- Only fires for `kind === "spawn"` (not resume/fork) and only after Tier 1/2
  miss, so it cannot double-clear or steal a fork's navigation.
- First-match-wins (`break`) mirrors the spawn_result legacy fallback already in
  the codebase (clear FIRST matching placeholder).

### Alternatives considered
- Make the server always echo `spawnRequestId` (fix Tier 1 only). Rejected:
  the user reports Tier 1 already works; the fallback is defense-in-depth for
  any future token-drop and costs ~6 lines. Belt and suspenders.

## Defect B — server deferred order-key resolution

### The timing problem
```
session_register   gitWorktree = undefined → resolveOrderKey = worktree cwd
                   insert(worktreeCwd, id)   // unshift → front of WRONG list
git_info_update    gitWorktree.mainPath = /repo  → resolved key now = /repo
                   (today: nothing re-keys the order entry)
client grouping    collapses session under /repo, reads sessionOrder["/repo"]
                   id absent → unordered bucket → bottom
```

### Decision
In `event-wiring.ts`, the arm that composes/sets `gitWorktree` (and the jj
`workspaceRoot` arm) SHALL, after the session's group identity is established,
recompute `resolveOrderKey(session)`. If the resolved key differs from the key
the id currently lives under, perform a re-key:

1. `sessionOrderManager.remove(oldKey, id)` (prune; drop the entry if the list
   becomes empty).
2. `sessionOrderManager.insert(resolvedKey, id)` — unshift to front (matches the
   "new session at the top" intent; the session is brand-new at this point).
3. `broadcastToAll({ type: "sessions_reordered", cwd: resolvedKey, sessionIds })`
   with `validIds` filtered to sessions whose resolved key === resolvedKey
   (same pattern as the existing register-time broadcast).
4. Optionally broadcast for `oldKey` too if any ids remain there.

A small helper on `SessionOrderManager` — `rekey(oldKey, newKey, id, { toFront })`
— encapsulates the remove+insert+empty-prune so the two call sites (gitWorktree
arm, jjState arm) stay DRY.

### Idempotency / edge cases
- **Legacy bridge sends gitWorktree on register:** `oldKey === resolvedKey` →
  re-key is a no-op. No broadcast churn (guard on key inequality).
- **Repeated git_info_update:** after the first re-key the id already lives under
  the resolved key → subsequent updates are no-ops.
- **User dragged/reordered before git_info_update:** unlikely within the sub-second
  window, but if it happened the re-key prepends (front). Acceptable: the session
  is still brand-new; front placement matches spawn intent. Documented, not
  guarded.
- **Resume of an existing worktree session:** `gitWorktree` is already persisted
  and present on register → resolved key correct from the start → no re-key. The
  resume placement contract (`front`/`keep`) is untouched.
- **Stale worktree-cwd keys from pre-fix sessions:** pruned when their session
  re-registers; otherwise inert (no session groups under them, so never read).

### Persistence / rollback
- `sessionOrder` JSON schema unchanged. The re-key only moves an id between
  existing keys + prunes empties. Restart-safe: the resolved key is what gets
  persisted going forward.
- Rollback = revert the arm + helper. No migration. Any worktree session spawned
  under the fix that already sits under the parent key stays valid (parent key is
  the correct key regardless of code version).

## Test strategy (TDD)
- Server unit: register a worktree session with `gitWorktree=undefined`, assert
  id under worktree-cwd key; then deliver `git_info_update` with
  `gitWorktree.mainPath=/repo`, assert id moved to front of `/repo` key, old key
  pruned, `sessions_reordered { cwd: "/repo" }` broadcast once.
- Server unit: legacy bridge with gitWorktree on register → no re-key, no extra
  broadcast.
- Client unit: `session_added` with NO matching `spawnRequestId` and
  `session.cwd` = worktree path matching a pending entry → placeholder cleared
  via `placeholderCwd`, navigation fired, entry removed.
- Client unit: plain spawn unaffected (Tier 2 still clears).
