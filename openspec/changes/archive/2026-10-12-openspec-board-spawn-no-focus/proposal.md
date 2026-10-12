## Why

Starting a session or worktree from the OpenSpec board pulls the user off the board onto the new session's chat view. The board is a triage/dispatch surface — the user typically fans out several changes in a row and wants to stay on the board, watching the new sessions appear on their cards, rather than being bounced away and having to navigate back after every spawn.

## What Changes

- Spawns initiated from the OpenSpec board (`/folder/<cwd>/openspec`) no longer auto-navigate to the new session. The user stays on the board. (Sole exception: on the legacy no-`spawnRequestId` fallback path, when a default spawn is concurrently pending for the same cwd, the client errs toward focusing.)
- Covers every board spawn entry point: card `+ Session`, card `New worktree` (via the worktree spawn dialog), and the New-proposal dialog's create-and-spawn (plain and worktree).
- The spawn placeholder and pending-spawn correlation are still cleared exactly as today; only the navigation step is skipped. The new session appears on its proposal card's session list as it already does.
- Opt-out is carried with the spawn itself (per-spawn "no focus" intent), not inferred from the current route — so a sidebar/folder spawn made while the board is open still focuses, and a board spawn whose session registers after the user left the board still does not steal focus.
- All other spawn sources (folder view, sidebar `+`, fork, resume, keyboard shortcut) keep auto-focusing — unchanged.
- Client-only. No protocol, server, or persistence change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `spawn-correlation`: the client auto-select-on-`session_added` requirement gains an exception — a pending spawn that opted out of focus clears its correlation state and placeholder but SHALL NOT navigate. Applies to the requestId tier and the cwd-based fallback tiers.
- `placeholder-spawn-card`: "Placeholder replaced on session added matching requestId" — navigation step (c) is skipped for a no-focus entry; placeholder removal and timer cancel unchanged.
- `openspec-board`: new requirement — sessions spawned from the board SHALL NOT take focus; the user stays on the board.

## Impact

- `packages/client/src/hooks/useSessionActions.ts` — `handleSpawnSession` accepts a focus opt-out and stores it on the pending-spawn entry.
- `packages/client/src/hooks/useMessageHandler.ts` — `session_added` correlation tiers skip `navigate()` for opted-out entries (Tier 1 requestId, Tier 2 legacy cwd, Tier 2.5 worktree cwd).
- `packages/client/src/components/openspec/OpenSpecBoardView.tsx` — direct board spawns pass the opt-out.
- `packages/client/src/App.tsx` — the board `WorktreeSpawnDialog.onSpawn` passes the opt-out.
- Pending-spawn entry type — currently duplicated inline in `App.tsx`, `useSessionActions.ts`, `useMessageHandler.ts` — is extracted once and gains an optional `focus` field.
- Tests: `useMessageHandler` correlation tests, `useSessionActions` spawn test, `OpenSpecBoardView` component test.
- Out of scope (pre-existing, unchanged): same-cwd concurrent spawns sharing one placeholder/timer; pending entries not garbage-collected on timeout.
- Compatibility: additive optional field; default behavior unchanged. Rollback = revert the client change.

## Discipline Skills

None apply — client-only UX change with no auth/untrusted input, no latency budget, no new endpoint/job, and no irreversible step. `review-code` runs as the standard pre-commit pass.
