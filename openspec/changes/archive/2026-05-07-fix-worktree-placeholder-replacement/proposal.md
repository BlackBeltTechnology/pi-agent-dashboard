## Why

Worktree spawn from the dashboard UI shows a placeholder card at the top of the session list while the worktree is being created. When the session registers, the real card currently appears at the bottom instead of replacing the placeholder in-place. This breaks the user's mental model — the placeholder promised "your session will be here," but the session lands elsewhere. The bug also breaks sequential multi-spawn: each new real card drifts further from its placeholder.

Additionally, when an OpenSpec change is archived, the associated git worktree is left orphaned. Users need a way to clean up worktrees during archiving.

## What Changes

- **Placeholder in-place replacement**: When a `session_added` event arrives for a spawning group, the new session SHALL take the placeholder's position in the session order (index 0, where the placeholder was rendered), rather than landing at the bottom. This means the real session card replaces the placeholder card visually without jumping.
- **Sequential multi-spawn correctness**: Each spawn request SHALL create an independent placeholder. When the corresponding session registers, it SHALL replace its own placeholder. Sessions SHALL appear in spawn order (the order the user clicked "Spawn").
- **Worktree cleanup on archive**: The OpenSpec archive dialog SHALL offer an option to remove matching dashboard-managed git worktrees when archiving a change. Matching SHALL use exact path prefix: `<repo-root>/.pi/worktrees/<change-name>-*`.
- **Browser test**: Docker-based Playwright test that verifies placeholder → real-card replacement for worktree spawn.

## Capabilities

### New Capabilities

- `worktree-cleanup-on-archive`: When archiving an OpenSpec change, the UI SHALL offer to remove the associated git worktree if one exists.

### Modified Capabilities

- `placeholder-spawn-card`: Placeholder SHALL be replaced in-place by the real session card — the real session takes the placeholder's slot in session order rather than being prepended.
- `session-ordering`: Spawn ordering SHALL preserve the spawn sequence: sessions spawned via worktree SHALL appear in the order the user initiated spawns, not in registration order.

## Impact

- **Files**: `packages/server/src/event-wiring.ts` (groupCwd-aware ordering), `packages/server/src/worktree-manager.ts` (`findMatchingWorktrees` helper), `packages/server/src/routes/openspec-routes.ts` (archive + cleanup endpoint), `packages/client/src/components/ArchiveBrowserView.tsx` (cleanup checkbox), `packages/client/src/hooks/useMessageHandler.ts` (session_added with groupCwd check)
- **Tests**: New `qa/worktree-placeholder/` Docker + Playwright test, update `worktree-manager.test.ts` for `findMatchingWorktrees`, update `event-wiring` tests for groupCwd ordering, update `PlaceholderSessionCard.test.tsx` / `SessionList.test.tsx`
- **Dependencies**: Uses existing `worktree-manager.ts`, `placeholder-spawn-card` spec, `session-ordering` spec
