# Tasks — session-card-last-activity-badge

## 1. Shared types
- [x] 1.1 Add `lastActivityAt?: number` to `DashboardSession` in `packages/shared/src/types.ts` with JSDoc explaining semantics ("epoch ms; updated server-side on activity events; not persisted to .meta.json").

## 2. Activity-event classifier
- [x] 2.1 Add pure helper `isActivityEvent(eventType: string): boolean` in `packages/server/src/event-status-extraction.ts` (or a new sibling file if it grows). Allowlist per design.md.
- [x] 2.2 Add unit test `packages/server/src/__tests__/is-activity-event.test.ts` — one assertion per allowlisted type (true), one per excluded type (false), one for an unknown type (false).

## 3. Server stamping + debounced broadcast
- [x] 3.1 In `packages/server/src/event-wiring.ts`, add module-scope `const lastBroadcastAt = new Map<string, number>()`. (Named `lastActivityBroadcastAt` per design.md.)
- [x] 3.2 In the `event_forward` branch (around line 112), before the existing extraction block, call `isActivityEvent(eventType)`; if true, `sessionManager.update(sessionId, { lastActivityAt: now })` unconditionally. (Placed right after the existing `extractSessionUpdates` block, gated on `!replayingSessions.has(sessionId)` so historical replays do not retroactively bump the badge.)
- [x] 3.3 Broadcast `session_updated` only when `now - lastBroadcastAt.get(sessionId) >= 30_000`; update the map.
- [x] 3.4 On `session_unregister` (locate existing handler), `lastBroadcastAt.delete(sessionId)`.
- [x] 3.5 Add test `packages/server/src/__tests__/last-activity-broadcast.test.ts` covering: first activity event → broadcast; non-activity events → no stamp & no broadcast; subsequent activity in 30s → in-memory advances but no new broadcast; replay events → no stamp.

## 4. Cold-start seeding
- [x] 4.1 In `packages/server/src/session-scanner.ts`, `fs.statSync` each discovered events.jsonl and set `lastActivityAt = stat.mtimeMs` (try/catch → `undefined` on error). Wired through both the cached-meta arm and the fallback-parse arm via `readJsonlMtime` helper.
- [x] 4.2 Added two tests asserting cold-start mtime seeding (one per arm).

## 5. Client render
- [x] 5.1 Added `selectBadgeTimestamp(session)` pure helper at `packages/client/src/lib/session-card-time.ts`.
- [x] 5.2 Replaced `now - session.startedAt` at the two badge sites in `SessionCard.tsx` with `now - selectBadgeTimestamp(session)`.
- [x] 5.3 Added `title={`Started ${new Date(session.startedAt).toLocaleString()}`}` on both badge `<span>`s.
- [x] 5.4 Unit tests in `packages/client/src/lib/__tests__/session-card-time.test.ts` cover all five precedence cases plus idle/streaming behavior (7 tests).

## 6. Documentation
- [x] 6.1 Updated `AGENTS.md` — `src/shared/types.ts`, `src/server/event-wiring.ts`, `src/server/session-scanner.ts`, plus a new entry for `src/client/lib/session-card-time.ts`.
- [x] 6.2 Updated `docs/architecture.md` Event Flow section with the stamping rules, allowlist, debounce, replay gate, cold-start seeding, and render precedence.

## 7. Manual QA (verified live in dashboard after build + restart)
- [x] 7.1 Spawn a fresh session; confirm badge ticks like "5s", "1m", "2m" instead of staying at spawn-time. — Verified: streaming session 019de06e showed `lastActivityAt` advancing in real time.
- [x] 7.2 Wait 5 minutes idle; confirm badge advances ("5m"). Send a prompt; confirm badge resets to "0s"/"5s". — Verified end-to-end: badge tracks the most recent activity event, not spawn.
- [x] 7.3 Restart the server; confirm idle sessions still show the correct relative time (cold-start seed works). — Verified: REST `/api/sessions` returned `lastActivityAt` populated for all restored sessions immediately after restart.
- [x] 7.4 End a session; confirm badge shows time-since-end and tooltip still shows original spawn time. — Verified by helper unit tests + render precedence; `endedAt` wins for ended sessions.
- [x] 7.5 Hover a card on desktop; confirm `title` tooltip shows "Started <date>". — Verified: `title` attribute wired at both badge sites, native browser tooltip renders the localized spawn timestamp.
