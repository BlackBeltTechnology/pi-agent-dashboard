## Context

Worktree spawn flow:
1. User clicks "Spawn in worktree" → client sends `spawn_session` with `spawnMode: "worktree"` and `cwd: <main-repo>`
2. Server creates git worktree, spawns pi inside it → bridge registers with `cwd: <worktree-path>`
3. Server sets `session.worktree` and `session.groupCwd = <main-repo>` on the session
4. Server broadcasts `sessions_reordered { cwd: <worktree-path>, ... }` 
5. Client groups sessions by `groupCwd || cwd` → worktree session lands under `<main-repo>` group
6. Client sorts by `sessionOrderMap.get(main-repo)` → worktree session ID is NOT in this array → tail of the list → bottom

**The fix**: When `groupCwd` is set on a session, the server SHALL insert the session ID into the `groupCwd` order (not `msg.cwd`) and broadcast with `cwd: groupCwd`. This makes the session appear in-place (top of group, where the placeholder was).

For sequential multi-spawn: each `handleSpawnSession` call adds a new placeholder. Since `session_added` triggers `clearSpawningCwd`, only one placeholder is removed at a time. But the placeholder's visual position is at the top of the list — the real session replaces it because it gets prepended to `groupCwd` order.

For worktree cleanup on archive: the `POST /api/openspec/archive` flow already removes the OpenSpec change directory. We add an optional `cleanupWorktree: boolean` parameter. When true, the server finds worktrees under `.pi/worktrees/` whose branch name matches the archived change name and runs `git worktree remove`.

## Goals / Non-Goals

**Goals:**
- Worktree session card replaces its placeholder in-place (top of group)
- Sequential multi-spawn: each real session replaces its own placeholder in spawn order
- Worktree cleanup option when archiving OpenSpec changes
- Browser test verifying placeholder → real-card replacement for worktree spawn

**Non-Goals:**
- Parallel concurrent spawn race conditions (deferred)
- Worktree cleanup for non-dashboard-managed worktrees
- Changes to placeholder rendering or animation
- Changes to the spawn dialog itself

## Decisions

### 1. Use groupCwd for session ordering of worktree sessions

**Decision**: In `event-wiring.ts`, when `session.groupCwd` is set after worktree detection, use `groupCwd` (not `msg.cwd`) for session order insertion and `sessions_reordered` broadcast.

**Rationale**: The client groups sessions by `groupCwd` and looks up order by group cwd. Using the worktree path as the order key creates a mismatch. Using `groupCwd` aligns server and client.

**Alternatives considered**:
- Fix the client to fall back to `session.cwd` when `groupCwd` order is empty — more complex, still wrong semantically
- Track dual order (worktree cwd + group cwd) — over-engineered

### 2. Two-step order insertion: insert into groupCwd order + broadcast with groupCwd key

**Decision**: After worktree detection populates `groupCwd`, call `sessionOrderManager.insert(groupCwd, sessionId)` and `sessionOrderManager.moveToFront(groupCwd, sessionId)`, then broadcast `sessions_reordered { cwd: groupCwd }`.

**Rationale**: `insert` adds the ID to the order array. `moveToFront` puts it at index 0 (where the placeholder was). Broadcasting with `groupCwd` ensures the client updates the correct order map entry.

### 3. Worktree cleanup: explicit opt-in via archive parameter

**Decision**: Add optional `cleanupWorktree?: boolean` to the `openspec_bulk_archive` WebSocket message. The confirm dialog gains a checkbox: "Remove associated worktrees". Server removes all dashboard-managed worktrees under `.pi/worktrees/` after archiving completes. Results are broadcast as `openspec_update` with `data.worktreeCleanup`.

**Rationale**: Opt-in avoids accidental data loss. User explicitly chooses to clean up. The worktree manager already has `removeWorktree` — just need the matching logic.

### 4. Browser test: Docker + Playwright

**Decision**: New `qa/worktree-placeholder/` directory with a Docker-based Playwright test that:
1. Creates a temp git repo with a branch
2. Starts dashboard server
3. Opens browser, clicks "Spawn in worktree"
4. Verifies placeholder appears at top
5. Waits for real session card to appear at same position
6. Verifies placeholder is gone
7. Verifies session card is at top of group (not bottom)

**Rationale**: Docker isolation ensures git worktree support. Playwright provides reliable browser automation. Existing `qa/worktree-api/` already demonstrates this pattern.

## Risks / Trade-offs

- **[Reordered broadcast frequency]** → Each worktree registration now broadcasts `sessions_reordered` for the group cwd. If many worktree sessions register simultaneously, browsers receive multiple reorder broadcasts. Mitigation: acceptable — each broadcast is small, and simultaneous spawns are uncommon.
- **[Worktree cleanup false match]** → `findMatchingWorktrees` matches by exact path prefix: `<repoRoot>/.pi/worktrees/<changeName>-*`. The `<changeName>` is the OpenSpec change slug (exact string from the archive request), not a branch name. Since dashboard-managed worktree directories are generated by the worktree manager using the branch name slug + timestamp, and the branch name is provided by the user (not the change name), false matches are possible if the user names the branch identically to a change. Mitigation: cleanup is opt-in via checkbox — user confirms before deletion. Risk is low because worktree data is by definition a disposable checkout.

## Migration Plan

**Rollback**: If the `groupCwd` ordering change causes issues, reverting `event-wiring.ts` to the previous behavior restores the old ordering. Session order data is keyed by cwd in `preferences.json` — no schema migration needed. The worktree cleanup feature is purely additive and can be rolled back by removing the checkbox + endpoint parameter.

**Data integrity**: Existing worktree sessions already have `groupCwd` set; after this change they will receive a one-time `sessions_reordered` broadcast with `cwd: groupCwd` on the next bridge re-register (e.g., after dashboard restart). This is harmless — it corrects the ordering for currently-running sessions.

## Open Questions

- **Archive checkbox visibility**: The spec requires the checkbox shown when `.pi/worktrees/` exists in the repo. The current implementation always shows the checkbox for simplicity — it's harmless when no worktrees exist (removal is a no-op). A future enhancement could gate on `GET /api/git/worktrees` response.
