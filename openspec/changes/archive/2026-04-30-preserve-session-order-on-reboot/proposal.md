# preserve-session-order-on-reboot

## Why

`pin-and-search-sessions` (archived 2026-04-28) added an `onChange` hook in `server.ts` that mutates `sessionOrder` on every status transition: alive→ended prunes the id; ended→alive prepends the id to the alive tier (so plain `Resume` clicks land at the top, while drag-to-resume's pre-inserted slot survives).

The transition listener can't tell user-initiated transitions apart from bridge-initiated ones. After a dashboard reboot, every still-alive pi process whose session was scanned-as-ended on startup re-attaches via `session_register`, flips ended→alive, and the same code path that handles "user clicked Resume" prepends the session to the top of its folder. Result: **a user's drag-reorder for active sessions is silently destroyed every time the dashboard restarts**.

## What Changes

- **NEW: `pendingResumeIntents` registry** — a tiny `Set<sessionId>` held in the server's `BrowserHandlerContext` that records sessions for which the user explicitly invoked `Resume` (via WebSocket `resume_session` or REST `/api/session/:id/resume`) AND for which drag-to-resume was triggered (via the same `resume_session` path that follows a `reorder_sessions` drop). The id is consumed by the `onChange` ended→alive branch and removed when it fires.
- **MODIFIED:** `sessionManager.onChange` ended→alive branch in `server.ts`:
  - **If** the id is in `pendingResumeIntents` (user-initiated): consume it and apply the existing prepend-or-keep-dropped-slot behaviour.
  - **Else** (bridge auto-reattach on reboot): do **not** mutate `sessionOrder`, do **not** broadcast `sessions_reordered`. The user's existing order is left intact.
- **MODIFIED:** Both call sites that initiate user-driven resume (`handleResumeSession` in `session-action-handler.ts`, the REST resume endpoint in `session-api.ts`) record the session id in `pendingResumeIntents` *before* invoking `spawnPiSession`. The drag-to-resume flow already emits `resume_session` from the client after `reorder_sessions`; that call hits the same `handleResumeSession` and gets the same tagging — no separate path needed.
- **MODIFIED:** Stale-intent cleanup. If a recorded intent is not consumed within 60 s (e.g., spawn failed, bridge never attached), it expires silently. Prevents long-lived ghost entries pinning state.
- **NEW: regression tests** covering all four ended→alive paths: user-Resume click, drag-to-resume, bridge reboot reattach, and stale-intent expiry.

## Capabilities

### Modified Capabilities
- `session-filtering`: the alive→ended prune behaviour is unchanged. The ended→alive prepend now requires an explicit user-resume intent. Bridge auto-reattach on reboot SHALL NOT mutate `sessionOrder`.

### New Capabilities
- *(none — this is purely a fix to the prior change)*

## Impact

- **Server**: new `pending-resume-intent-registry.ts` (~30 lines, mirrors `pending-fork-registry.ts` but with TTL); two call sites tag intents (`handleResumeSession`, `registerSessionApi` resume endpoint); `server.ts` `onChange` consults the registry in its ended→alive branch.
- **No protocol changes**: no new WebSocket message types, no REST changes.
- **No client changes**: the client behaviour is identical (`reorder_sessions` → `resume_session` flow already exists; the server now distinguishes intent vs reconnect).
- **No data migration**: registry is in-memory only.
- **No breaking changes**: every existing user flow continues to work as documented in the archived `pin-and-search-sessions` design.
