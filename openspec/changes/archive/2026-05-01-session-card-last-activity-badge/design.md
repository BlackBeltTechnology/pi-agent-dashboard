# Design — session-card-last-activity-badge

## Context

The session-card "23h" badge today is `formatRelativeTime(now - session.startedAt)` (`packages/client/src/components/SessionCard.tsx:358` and again at line 485 for the alternate layout branch). `startedAt` is the spawn timestamp; it never updates. There is no field on `DashboardSession` that tracks "last interaction".

All session events from the bridge funnel through one chokepoint at `packages/server/src/event-wiring.ts:112` (`if (msg.type === "event_forward")`). This is the natural place to stamp activity.

## Activity-event allowlist

`isActivityEvent(eventType)` returns `true` for events that represent user-or-agent action and `false` for plumbing/noise.

```
INCLUDE (counts as activity)        EXCLUDE
─────────────────────────────       ───────────────────
prompt_send                         session_register
message_start                       heartbeat
message_end                         process_metrics
turn_end                            model_select
tool_execution_start                git_info_update
tool_execution_end                  stats_update     (covered by turn_end)
agent_start                         openspec_update
agent_end                           ui_data_list
flow_started                        ui_modules_list
flow_complete                       ext_ui_decorator
flow_agent_complete                 (any other ext_ui_*)
architect_started
architect_complete
architect_cancelled
bash_output
```

Rule of thumb: if seeing it makes a human say "the session did something just now," it's an activity event.

## Where the stamp lives

`event-wiring.ts` already has the central `event_forward` handler. The new logic is:

```ts
if (msg.type === "event_forward") {
  const sessionId = msg.event.sessionId;
  const eventType = msg.event.eventType;

  if (isActivityEvent(eventType)) {
    const now = Date.now();
    sessionManager.update(sessionId, { lastActivityAt: now });

    // 30s debounced broadcast (per session)
    if (now - (lastBroadcastAt.get(sessionId) ?? 0) >= 30_000) {
      lastBroadcastAt.set(sessionId, now);
      browserGateway.broadcastSessionUpdated(sessionId, { lastActivityAt: now });
    }
  }

  // …existing event-status-extraction, openspec detection, turn_end stats, etc…
}
```

`lastBroadcastAt: Map<string, number>` lives at module scope in `event-wiring.ts` (matches the style of `replayingSessions` already there). On `session_unregister`, the entry is deleted to prevent leaks.

Important: this stamp runs **before** the existing `extractSessionUpdates` block. If `extractSessionUpdates` also produces updates (e.g. status flip, model change), those broadcasts already exist and remain unchanged — they will piggy-back the latest `lastActivityAt` because both reads come from `sessionManager` state.

## Why 30s debounce, not "broadcast on label change"

A streaming session can emit 50+ events/sec. Three options were considered:

| Option | Server cost | Wire cost | UX |
|---|---|---|---|
| Broadcast every event | O(events) | O(events) — chatty | tight, identical to in-memory |
| Broadcast on label-change | requires server-side label calc | minimal | tight |
| **30s debounce (chosen)** | O(events) but bounded broadcasts | 1 msg / 30s / session max | label is at most 30s stale |

The chosen option is the simplest. Because `formatRelativeTime` returns coarse buckets ("23h", "5m", "1d"), the human-perceived staleness is far less than 30s for any session older than a minute.

Trade-off accepted: a session with `lastActivityAt = T - 28s` whose `now` ticker shows "28s ago" can momentarily display "58s ago" before the next broadcast lands. Acceptable.

## Cold-start seeding

`session-scanner.ts` discovers sessions on disk at boot. For each, it seeds:

```ts
try {
  const stat = fs.statSync(eventsJsonlPath);
  session.lastActivityAt = stat.mtimeMs;
} catch {
  // missing/unreadable jsonl — fall back to startedAt at render time
}
```

One syscall per session at boot. No background watchers. The render-side helper falls back to `startedAt` when `lastActivityAt` is undefined, so a missing seed is not a bug.

## Render precedence

```ts
function selectBadgeTimestamp(s: DashboardSession): number {
  if (s.status === "ended") return s.endedAt ?? s.lastActivityAt ?? s.startedAt;
  return s.lastActivityAt ?? s.startedAt;
}
```

Rationale:

- **Ended** sessions: `endedAt` is the authoritative "when did this die" — typically equal to or later than `lastActivityAt`. Showing "ended 23h ago" reads better than "active 23h ago" for an ended row.
- **Active** sessions: `lastActivityAt` is the answer. `startedAt` only used as a never-had-activity fallback (very fresh session, mid-spawn, or pre-upgrade existing session whose seed failed).

The helper is exported from `packages/client/src/components/SessionCard.tsx` (or a sibling helpers file) and unit-tested.

## Tooltip

The badge gets a `title=` attribute:

```
title={`Started ${new Date(session.startedAt).toLocaleString()}`}
```

This preserves the "how old is the session" affordance the current label provides. No popover, no JS — native browser tooltip.

## What does NOT change

- Bridge: untouched. No new events, no new protocol fields from bridge → server.
- Persistence: no `.meta.json` write. `lastActivityAt` is in-memory + jsonl-mtime-seeded.
- `DashboardEvent` schema: untouched.
- The `now` ticker driving live re-renders in `App.tsx`/`SessionCard.tsx`: untouched.

## Risks

- **Missed events**: if a new event type ships and is not added to the allowlist, the badge will appear stale for sessions whose only activity is that event. Mitigation: the allowlist is in one file, with one unit test per included event type.
- **Server restart drift**: a session active up until restart will, post-restart, show `lastActivityAt = events.jsonl mtime` ≈ last-event-time. This is correct.
- **Long-running flow looks "active just now" while user is asleep**: by design — option C from discovery. If the user later asks for "last user prompt" semantics, that is a follow-up change adding a separate `lastUserPromptAt` field.
