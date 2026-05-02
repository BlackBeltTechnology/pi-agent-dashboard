# Design — session-card-unread-stripes

## Why a design doc

The visual layer (one CSS class, one component-helper branch) is trivial. The interesting decisions are in the **state machine**: who decides "unread", on what events, with what concept of "currently viewed", and how it survives reload. This document fixes those decisions.

## State machine

```
                       UNREAD STATE PER SESSION
                       ════════════════════════════════════════════

                            ┌────────────┐
                ┌──────────▶│   read     │◀─────────┐
                │           │ unread:    │          │
                │           │  false     │          │
                │           └────────────┘          │
                │                  ▲                │
                │                  │                │
                │ trigger AND      │ session_view   │ session_view
                │ NOT viewed by    │ from any       │ from any
                │ anyone           │ browser        │ browser
                │                  │                │
                │                  │                │
                ▼                  │                │
        ┌────────────┐             │                │
        │  unread    │─────────────┘                │
        │ unread:    │                              │
        │  true      │──────────────────────────────┘
        └────────────┘

  TRIGGERS (server-evaluated, all gated on "not currently viewed"):
    1. status transition: streaming → idle | active   (turn finished)
    2. currentTool becomes "ask_user"                 (input requested)
    3. agent_end with error payload                   (something broke)

  NON-TRIGGERS (deliberate):
    • assistant message_end                           (noisy, fires
                                                       repeatedly per turn)
    • tool_execution_start / _end                     (very noisy)
    • model_select, git_info_update, process_metrics  (already
                                                       excluded from
                                                       activity badge)
    • status changes other than streaming → quiescent
```

## "Currently viewed" semantics

**Decision: global read state, sourced from browser URL routes.**

- A session is "viewed" iff **at least one** connected browser is currently rendering its chat panel.
- The signal is the URL route `/session/:id`. Mobile and desktop both navigate there when opening a session.
- Sidebar visibility (a session card being on screen but not opened) does NOT count as viewed. This matches user intent: scanning the sidebar is exactly when unread should be useful, so cards on the sidebar must be eligible to *show* unread, which means sidebar visibility cannot clear it.

```
            ┌─────────────────┐
            │   Browser A     │ → POST session_view  { sid: "abc" }
            │   /session/abc  │
            └─────────────────┘            ┌─────────────────────┐
                                           │  viewedSessions     │
            ┌─────────────────┐            │  Map<sid, Set<ws>>  │
            │   Browser B     │            │                     │
            │   /             │            │  "abc" → {wsA, wsC} │
            │   (sidebar)     │            │  "xyz" → {}         │ ← not viewed
            └─────────────────┘            └─────────────────────┘
                                                     ▲
            ┌─────────────────┐                      │
            │   Browser C     │ → POST session_view  { sid: "abc" }
            │   /session/abc  │
            └─────────────────┘
            
            "abc" is viewed (Set non-empty).
            "xyz" is not viewed → next trigger event for xyz → unread=true.
```

## Why server-side and not client-side

**Considered**: client-side, where each browser tracks its own unread bit in localStorage based on what events it has seen vs what's currently on screen.

**Rejected** because:
1. User explicitly asked for "persist on reload server" — survives across browsers/devices.
2. Multi-device coherence (open a session on phone, laptop sees indicator clear).
3. Easier reasoning: one state machine, one place to test, no cross-tab coordination.

The cost (one boolean of state, three new lines in `.meta.json`, one WS message round-trip on session open) is trivial.

## Persistence model

```
                .meta.json BEFORE                   .meta.json AFTER
                ─────────────────                   ─────────────────
                {                                   {
                  "status": "idle",                   "status": "idle",
                  "startedAt": ...,                   "startedAt": ...,
                  "lastActivityAt": ...,              "lastActivityAt": ...,
                  ...                                 ...,
                }                                     "unread": true     ← NEW
                                                    }
```

Single optional boolean. Backwards compatible — old `.meta.json` without the field reads as `unread: undefined → false` semantically.

## Cold start interaction

The server's `session-scanner.ts` reads `.meta.json` on boot. The existing `server.ts:273-279` block forces `status = "ended"` for every restored session because the bridges haven't reattached yet. We **deliberately do not touch `unread`** in this block.

Consequence: a session that was unread when the server stopped stays unread when the server starts back up, even before its bridge reattaches. If the bridge then reattaches and updates `status` from "ended" back to "idle", the unread bit is still set. Exactly the desired behavior — "I closed my laptop yesterday, this session had finished its turn, today it's still flagged for me."

## Open browser at cold start

```
SCENARIO: server restarts while browser is open at /session/abc
═══════════════════════════════════════════════════════════════

  t=0    server stops
  t=0+ε  browser detects WS disconnect
  t=1s   server starts, scans .meta.json, "abc" loads with
         persisted unread=true (because some trigger fired
         before the server stopped)
  t=2s   browser reconnects
  t=2s+  client's `useViewDispatcher` re-sends session_view
         on reconnect (because the URL is still /session/abc)
  t=2s+  server clears "abc"'s unread → broadcast session_updated
  t=2s+  card on screen drops cyan stripes
  
  NET: brief flash of cyan stripes during reconnect window.
       Acceptable. Alternative (debounce clearing) adds complexity
       for marginal UX benefit.
```

The **client must re-send `session_view` on every WS reconnect** for the currently-viewed session. This is the only subtle bit of the client logic.

## Edge cases

| case | behavior |
|---|---|
| Browser navigates from /session/abc to /session/xyz | Send `session_unview { abc }` followed by `session_view { xyz }`. Server updates the Set for both. |
| Browser closes / WS disconnects | Server's WS-close handler iterates `viewedSessions` and removes that ws from every Set. Equivalent to implicit unview for all sessions that ws had viewed. |
| Two browsers viewing same session, one closes | Set still non-empty (other browser still has it). No state change. |
| Trigger fires while session IS viewed | `unread` stays false. The user is looking at the chat in real time — no attention debt. |
| User has the URL `/session/abc` open but the tab is backgrounded | Still counts as "viewed". We do NOT use the Page Visibility API; URL is the only signal. (Adding visibility tracking is out of scope — it's a delicate UX call that mail clients themselves handle inconsistently.) |
| Session ends (`status: "ended"`) while unread is true | `unread` stays true. The user still hasn't seen the final turn. Opens it → cleared. (Showing cyan stripes on an ended session is fine; the visual reads as "alive enough to have something for you.") |
| Replay events on cold start | Replay events MUST NOT trigger unread. The replay path is gated by the existing `replayingSessions` Set in `event-wiring.ts`; reuse the same gate. |

## What we're NOT building

- **Notification surfaces.** No sound, no browser notification API, no mobile push. The visual is the only feedback channel for now.
- **Counts.** Unread is binary, not "5 unread events." If a session triggers unread, then triggers it again, nothing changes.
- **Per-trigger granularity.** We don't expose *why* a session is unread (turn finished vs ask_user vs error). The card already shows that via existing pulses (purple pulse + unread = ask_user) (yellow stripes always wins so streaming never coexists with unread visually).
- **A "mark all read" button.** Open each session you care about. v1.
- **Auto-expiring unread.** No "if unread for >24h, auto-clear." Stays unread until viewed.

## Implementation order (rationale for task batching)

The change splits cleanly into two batches that can land in either order:

1. **Backend** (server-side state machine + persistence + protocol) — testable in isolation with a fixture client; no UI work.
2. **Frontend** (CSS class + dispatch hook + card rendering) — requires the backend protocol.

We'll implement backend first because the frontend has nothing to bind to without it. Both batches together is one PR; splitting them is fine if review wants smaller chunks.
