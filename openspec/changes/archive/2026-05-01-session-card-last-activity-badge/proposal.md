# session-card-last-activity-badge

## Why

The small time badge in the session card header (e.g. "23h" in the screenshot) currently renders `now - session.startedAt` — i.e. **how long ago the session was spawned**, not how long since the last activity. For a session that was opened yesterday at 12:13 and last interacted with two minutes ago, the badge still reads "23h", which makes the card feel stale and gives no signal about idleness.

Users expect the badge to answer the question "how long since something happened here?" — the same way IDE tabs, chat clients, and email lists use a relative-time label.

`DashboardSession` (in `packages/shared/src/types.ts`) has `startedAt` and `endedAt` but **no `lastActivityAt` field**, so the data needed to drive this label does not yet exist on the wire.

## What Changes

- **ADDED**: `DashboardSession.lastActivityAt?: number` (epoch ms) in `packages/shared/src/types.ts`.
- **ADDED**: Server-side stamping in `packages/server/src/event-wiring.ts` — every forwarded `event_forward` whose `eventType` is on the curated **activity-event allowlist** updates `session.lastActivityAt = Date.now()`. The allowlist captures user-or-agent action and deliberately excludes pure-noise events (heartbeat, metrics, registration, model-select, git-info).
- **ADDED**: A pure helper `isActivityEvent(eventType): boolean` (likely in `packages/server/src/event-status-extraction.ts` next to its sibling event classifier) so the allowlist is unit-testable.
- **ADDED**: 30-second per-session debounce on `session_updated` broadcasts that carry only a `lastActivityAt` change. The in-memory value updates on every event; the WebSocket broadcast is throttled. The client's local `now` ticker handles label refreshes between broadcasts.
- **ADDED**: Cold-start seeding in `packages/server/src/session-scanner.ts` — when the scanner restores a known session at boot, it seeds `lastActivityAt` from the events.jsonl mtime (one `fs.stat` per session). On error, falls back to `startedAt`.
- **MODIFIED**: `packages/client/src/components/SessionCard.tsx` lines 358 and 485 swap from `now - session.startedAt` to `now - selectBadgeTimestamp(session)`, where `selectBadgeTimestamp` is a small pure helper applying the precedence:
  - `status === "ended"` → `endedAt`
  - else → `lastActivityAt ?? startedAt`
- **ADDED**: Hover tooltip (`title=` attribute) on the badge showing the original spawn time as a human-readable absolute timestamp (e.g. `"Started 2026-04-30 12:13:42"`). Preserves the "how old is this session" affordance the current label provides.

Out of scope:

- No bridge changes. Stamping is server-side only; rides on existing `session_updated` broadcast.
- No new protocol message.
- No `lastActivityAt` persistence to `.meta.json` (cold-start mtime seeding is sufficient).
