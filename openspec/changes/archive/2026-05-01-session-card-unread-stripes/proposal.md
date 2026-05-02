# session-card-unread-stripes

## Why

Today the session card visualization has a gap between two existing states:

| state | card body |
|---|---|
| `streaming` / `resuming` | 🟡 yellow scrolling stripes (`card-working-pulse`) |
| `currentTool === "ask_user"` | 🟣 purple breathing pulse (`card-input-pulse`) |
| `idle` / `active` | ░ blank |
| `ended` | ░ blank |

When the user is looking at session A and session B's agent finishes its turn (transitions `streaming → idle`), session B's card flips to **blank** — visually identical to a long-dead `ended` session. The textual `<ActivityIndicator>` *does* say "Waiting for input" inside the card, but the card body itself gives no glanceable cue that something just happened. The user has to read each card's label to discover which session needs their attention.

This is the email/Slack/iMessage problem: in a list of N items, the user needs a single-axis scan-time signal for "this one has something new for you."

The clean answer is **per-session unread state**: a session becomes "unread" when its agent does something attention-worthy *while the user is not viewing it*, and clears when the user opens it. The visual is **cyan** scrolling stripes — same shape and motion as the yellow streaming stripes, but a cool, distinctive cyan (Tailwind `cyan-400`) so the unread state is immediately readable as "alive, with something fresh for you" without competing with the yellow streaming animation. Cyan was chosen because it owns its own corner of the dashboard accent palette — distant from yellow (streaming), purple (ask_user), green (alive dot), and red (errors).

Persistence: the unread bit survives server restarts via `.meta.json`, so closing your laptop and reopening it tomorrow still shows you which sessions changed while you were away.

## What Changes

### Shared types

- **ADDED**: `DashboardSession.unread?: boolean` in `packages/shared/src/types.ts`. Optional, server-managed; bridges SHALL NOT send it.
- **ADDED**: `SessionMeta.unread?: boolean` in `packages/shared/src/session-meta.ts` so the bit persists per-session in `~/.pi/agent/sessions/<id>/.meta.json`.

### Server: unread state machine

- **ADDED**: An "unread trigger" classifier `isUnreadTrigger(eventType, before, after): boolean` (pure helper, likely in `packages/server/src/event-status-extraction.ts`). Returns `true` for:
  - status transition `streaming → idle` or `streaming → active` (turn finished)
  - `currentTool` transitions to `"ask_user"` (input requested)
  - `agent_end` event whose payload indicates an error
  - `false` for everything else (per-message text streaming is intentionally NOT a trigger — too noisy)
- **ADDED**: Per-session "currently viewed by anyone" tracking. The browser-gateway (`packages/server/src/browser-gateway.ts` or a new sibling `viewed-session-tracker.ts`) maintains a `Map<sessionId, Set<wsConnectionId>>` populated by the new `session_view` / `session_unview` browser-protocol messages. A session is "viewed" iff at least one connected browser has it currently open.
- **ADDED**: In `packages/server/src/event-wiring.ts`, after the existing `extractSessionUpdates` block, evaluate `isUnreadTrigger(...)`. If it fires AND `viewedSessionTracker.isViewedByAnyone(sessionId) === false`, set `session.unread = true` and broadcast `session_updated`.
- **MODIFIED**: When a `session_view` arrives for a session whose `unread === true`, the server clears it (`session.unread = false`) and broadcasts `session_updated` to all subscribers (so other browsers see the indicator clear too — global read state, mirrors mail/Slack).

### Browser ↔ server protocol

- **ADDED** to `packages/shared/src/browser-protocol.ts`:
  - `BrowserToServer`: `{ type: "session_view", sessionId: string }`
  - `BrowserToServer`: `{ type: "session_unview", sessionId: string }`

  These MUST be added to the `BrowserToServerMessage` union or esbuild will strip the switch cases in production.
- The corresponding `session_updated` already exists; the new `unread` field rides it.

### Persistence

- **MODIFIED**: `packages/server/src/server.ts`'s meta-write payload (the `metaPersistence.save(...)` call inside the `sessionManager.onChange` handler) includes `unread: session.unread`.
- **MODIFIED**: `packages/server/src/session-scanner.ts` restores `unread` from `.meta.json` when seeding sessions on cold start.
- **MODIFIED**: The cold-start "force `status = 'ended'`" override in `server.ts:273-279` does NOT clear `unread`. An ended session with unread activity remains unread until the user opens it once — exactly what the user wants for "agent finished while I was offline."

### Client: dispatch view events

- **ADDED**: A pure helper `selectViewedSessionId(routeState): string | null` (probably in `packages/client/src/lib/`) that resolves the currently-viewed session id from the React Router state (`/session/:id` → `id`, anything else → `null`).
- **ADDED**: A `useViewDispatcher` hook in `App.tsx` (or `useMessageHandler.ts`) that watches `selectViewedSessionId` across renders and sends `session_view` / `session_unview` messages on transitions. On WebSocket reconnect, re-sends the current view (`session_view`) so server state re-syncs.

### Client: cyan stripes visualization

- **ADDED** to `packages/client/src/index.css`: a `.card-unread-pulse` class with the **same** geometry, animation timing, and CSS structure as `.card-working-pulse` — only the color values change to cool cyan. Specifically:
  - stripe color `rgba(234, 179, 8, 0.10)` → `rgba(34, 211, 238, 0.18)` (Tailwind `cyan-400`)
  - flat tint `rgba(234, 179, 8, 0.06)` → `rgba(34, 211, 238, 0.07)`
  - Same `28.2843px` tile size, same `card-working-stripes-scroll` keyframes (reused), same `card-working-opacity-pulse` reuse — just a different class name binding the same shared keyframe stack via two background layers.
  - `prefers-reduced-motion: reduce` arm matches `card-working-pulse`'s arm.
- **MODIFIED**: `getCardPulseClass(session)` in `SessionCard.tsx`:
  ```
  if (session.currentTool === "ask_user") return "card-input-pulse";
  if (session.status === "streaming" || session.resuming) return "card-working-pulse";
  if (session.unread) return "card-unread-pulse";   // NEW
  return "";
  ```

  Precedence: streaming/resuming wins (yellow wins over cyan), ask_user wins (purple wins over cyan). An unread session that becomes streaming again loses its cyan stripes for yellow stripes — correct, because the user can see work is happening.

### Existing visual unchanged

- The status dot (top-left of card, `bg-green-500` / `bg-yellow-500` / blank) is **NOT modified**. Per user direction the dot stays green for alive sessions exactly as today.

## Out of scope

- Per-browser-tab read state (each tab tracking its own unread). We use **global read state**: opening on phone clears unread for laptop too. Mirrors mail/Slack.
- An unread *count* per session (e.g. "3 events unread"). The bit is binary.
- A separate dot/badge in addition to the cyan stripes. Per user direction, cyan stripes are the only visual.
- Triggering unread on every assistant `message_end`. Too noisy on long turns.
- Triggering unread on tool execution start/end. Too noisy.
- A "mark all read" affordance. Single-session granularity is enough for v1.
- Notifications (sound, browser notification, mobile push). Out of scope; can be layered later.
- Subsuming the "idle" visual question. This proposal only fires unread on the explicit triggers; a session that's been idle for hours with no recent activity stays blank, which is correct.
