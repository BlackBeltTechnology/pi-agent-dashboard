# Design — Two-stage history-loading safety net

## Problem recap

The single hardcoded 15s safety-net timer cannot distinguish:

1. **Dead link / no ack** — server never responded to `subscribe`. 15s is a
   reasonable ceiling; clearing the flag → "No messages yet" is acceptable
   (nothing is coming).
2. **Server is parsing a big session** — server acknowledged with the priming
   `event_replay { events: [], isLast: false }` and is actively hydrating from
   disk; content is coming, it just takes longer than 15s.

Today both collapse to the same 15s clear, producing the false-empty flash for
case 2.

## Chosen approach: Option C (client re-arm) + Option B (server heartbeat)

The cold path already sends a unique, zero-cost signal that case 2 is in
progress. C uses it to re-arm; B re-sends it periodically so the window never
lapses during a legitimate long parse.

```
 subscribe sent ─► loadingHistory=true, arm SUBSCRIBE_ACK_MS (15s) ⏱short
        │
        ├─ event_replay{events:[], isLast:false}   (cold-hydration start)
        │        └─► cancel ⏱short, arm HYDRATE_CEILING_MS (90s) ⏱long
        │
        ├─ event_replay{events:[], isLast:false}   (heartbeat, every ~10s)  ◄─ B
        │        └─► re-arm ⏱long (reset 90s window)
        │              … repeats until first content / fail / leave …
        │
        ├─ event_replay{events:[...]}  (first content) ─► clear (paint); server stops heartbeat
        ├─ event_replay{events:[], isLast:true}         ─► clear ("No messages yet")
        ├─ session_updated{dataUnavailable:true}        ─► clear; server stops heartbeat
        │
        ├─ ⏱short elapses (no marker, no content)   ─► clear   (dead link)
        └─ ⏱long  elapses (heartbeats stopped early) ─► clear   (stuck/dead worker)
```

C and B share one code path on the client: the heartbeat is the same empty
non-terminal `event_replay`, so it flows through the identical re-arm guard. No
client branch is heartbeat-specific.

### Why re-arm rather than just bump the constant to 90s

Bumping the single constant to 90s (Option A) would make a genuinely dead link
hang the indicator for 90s. The two-stage design keeps the fast 15s failure
detection for the no-ack case and only extends the window once the server has
proven it is working.

### Why add B on top of C

C alone still has a residual race: a session whose disk-parse exceeds
`HYDRATE_CEILING_MS` (90s) trips the ceiling and flashes empty. B's heartbeat
re-arms the ceiling on a cadence far shorter than 90s, so parse duration becomes
irrelevant to correctness — the flag is held for as long as the server keeps
beating, and released within one window after the beats stop (real stall / dead
worker). The ceiling changes role from "max total parse time" (C-only) to
"max gap between heartbeats" (C+B).

### Server heartbeat mechanics (B)

- On the cold branch in `subscription-handler.ts`, immediately after sending the
  initial priming `event_replay { events: [], isLast: false }`, start a
  `setInterval` (`HYDRATE_HEARTBEAT_MS`, proposed 10000) that re-sends the same
  empty non-terminal marker to each live subscriber of the session.
- Clear the interval in every exit path of the `loadSessionEvents(...)` promise:
  success (before/at first `sendEventBatches`), `cancelled`, error, and the
  outer `.catch`. Guard against sending to a closed socket (`ws.readyState`).
- The heartbeat targets the same subscriber set the batches target, so a session
  with multiple viewers keeps all their indicators alive.
- Idempotent and cheap: an empty `event_replay` is a few bytes; old clients drop
  it (they only act on content or `isLast:true`).

### Guard conditions for the re-arm

The re-arm fires only when ALL hold, to avoid extending on unrelated replays:

- `event_replay.events.length === 0`
- `event_replay.isLast === false`
- the session's `loadingHistory` flag is currently `true`

A warm/in-memory subscribe does not send this empty non-terminal priming batch
(it sends content batches directly), so the warm path keeps the plain 15s timer
and is unaffected.

### Constants

| Name | Value | Side | Meaning |
|---|---|---|---|
| `SUBSCRIBE_ACK_MS` | 15000 | client | no ack / dead link ceiling |
| `HYDRATE_CEILING_MS` | 90000 | client | max gap tolerated after last hydration marker |
| `HYDRATE_HEARTBEAT_MS` | 10000 | server | interval between hydration keepalives |

`HYDRATE_HEARTBEAT_MS` ≪ `HYDRATE_CEILING_MS` so several missed beats are needed
before the ceiling trips (tolerates jitter / brief event-loop stalls). With
heartbeats present the ceiling detects a genuinely dead worker; with an old
server (no heartbeats) it falls back to a single 90s cap. Tune both if telemetry
(`instrument-session-hydration-timing`) shows a higher p99 parse time.

### Where the timer lives

`loadingHistoryTimersRef: Map<sid, Timeout>` already holds one timer per session
and `clearLoadingHistory` already tears it down on every clear edge. The re-arm
reuses this map: cancel the existing entry, set a new one with the long delay.
A small helper (e.g. `rearmLoadingHistory(setLoadingHistory, timersRef, id, ms)`)
keeps `App.tsx` and the `event_replay` handler DRY.

## Alternatives considered

- **A — bump 15s → 60/90s**: band-aid; still races on very large sessions and
  penalizes the dead-link case. Rejected as the core fix.
- **B alone** (heartbeat without C's re-arm): would require the client to treat
  the heartbeat specially anyway; folding it into C's existing re-arm guard is
  strictly simpler. Not chosen as a standalone.

(Both B and C are now included; only A remains rejected as the core fix.)

## Testing

### Server (subscription-handler.test.ts)

1. Cold subscribe → heartbeat interval fires ≥1 empty `{isLast:false}` marker to
   the subscriber before `loadSessionEvents` resolves (fake timers + delayed
   load stub).
2. Heartbeat stops after the first content batch is sent (no further empty
   markers once batches flow).
3. Heartbeat stops on load failure / `cancelled` / socket close (no send to a
   closed ws).

### Client (useMessageHandler.loading-history.test.tsx)

1. Cold path: `subscribe` → priming `{events:[], isLast:false}` → advance fake
   timers past 15s → flag STILL set (indicator persists). Then a content batch →
   flag cleared.
2. Dead-link path: `subscribe`, no priming marker → advance past 15s → flag
   cleared.
3. Stuck-worker path: priming marker, no content → advance past 90s → flag
   cleared.
4. Empty session: priming `{isLast:false}` then `{events:[], isLast:true}` →
   flag cleared, placeholder shows.
5. Warm path regression: content batches without a priming empty marker still
   clear on first content within 15s.
6. Heartbeat re-arm: priming marker + repeated empty `{isLast:false}` heartbeats
   spaced under 90s keep the flag set well past 90s; flag clears only after
   heartbeats stop and the ceiling elapses, or on first content.
