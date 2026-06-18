## Why

When a running session's agent invokes a headless worker — a subagent, the `memory` tool, or any nested `pi -p` — the bridge registers that worker with `hasUI: false`. The server's auto-hide heuristic (`hasUI === false && source !== "dashboard"`) flags it `hidden: true`, and it correctly renders as a dimmed card in the "Hidden" tier.

But the client's `session_added` handler in `packages/client/src/hooks/useMessageHandler.ts` auto-navigates the ChatWindow **without ever checking `msg.session.hidden`**. A hidden worker shares its parent session's `cwd`, so the cwd-based correlation fallbacks match the wrong session:

- **Tier 1** (`spawnRequestId` exact match) — `useMessageHandler.ts:151` → `navigate(/session/...)`.
- **Tier 2** (cwd in `spawningCwds`) — `useMessageHandler.ts:157` → `navigate(...)`.
- **Tier 2.5** (worktree cwd fallback scans `pendingSpawns`) — `useMessageHandler.ts:172` → `navigate(...)`.

Two failures result from the one missing guard:

1. **Focus theft** — the chat window jumps to a hidden worker the user cannot see in the normal list. The user is yanked out of the session they were reading.
2. **Correlation theft** — because the headless worker shares the parent's `cwd`, Tier 2 / Tier 2.5 can consume the `pendingSpawns` entry (and clear the placeholder) that belonged to the *real* visible session the user spawned, so the real session never gets its auto-select or placeholder clear.

A `hidden` session is never the thing a dashboard user spawned and wants to view (dashboard spawns carry `source === "dashboard"` and are never auto-hidden). It must never steal navigation **or** correlation state.

## What Changes

- Guard all three auto-navigation branches in `useMessageHandler.ts`'s `session_added` handler so that a session with `msg.session.hidden === true` is **never** an auto-navigation target.
- Make a `hidden` session **ineligible for correlation consumption**: it SHALL NOT delete a `pendingSpawns` entry, clear a placeholder, or cancel a spawn-timeout timer. This stops a headless worker that shares the parent `cwd` from swallowing the real session's correlation token via the Tier 2 / Tier 2.5 cwd heuristics.
- Add client regression tests that fire `session_added { hidden: true }` against each tier and assert `navigate` is NOT called and `pendingSpawns` is untouched, plus a positive test that `hidden: false` still navigates.
- No protocol, server, or persistence changes. The `hidden` flag already arrives on `session_added` (server auto-hide is unchanged). Pure client-side guard.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `spawn-correlation`: Strengthen **Client auto-selects newly registered session by requestId match** so a `hidden` session is never auto-navigated and never consumes correlation state.
- `placeholder-spawn-card`: Strengthen **Placeholder replaced on session added matching requestId** and **Fallback placeholder clear when spawnRequestId is absent** so a `hidden` session never clears a placeholder, cancels a timer, or navigates.

## Impact

- **Affected code**:
  - `packages/client/src/hooks/useMessageHandler.ts` — wrap the Tier 1 / Tier 2 / Tier 2.5 correlation+navigate block in the `session_added` case with a `!msg.session.hidden` guard. ~5–10 lines.
  - `packages/client/src/hooks/__tests__/useMessageHandler.hidden-nav.test.ts` (new) — regression coverage per tier.
- **No server / API / protocol changes** — the `hidden` flag is already populated by the server auto-hide heuristic and already present on the `session_added` payload.
- **No persistence migration** — no stored state touched.
- **Compatibility / rollback**: pure additive client guard. A legacy server that never sets `hidden` (flag absent ⇒ falsy) behaves exactly as today. Rollback is reverting the single hook change.
- **Docs**:
  - `docs/file-index-client.md`: update the `useMessageHandler.ts` row with `See change: suppress-hidden-session-auto-navigation`.
