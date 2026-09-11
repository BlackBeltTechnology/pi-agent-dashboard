## Why

A session card can show `Thinking…` forever. The session never settles, no output arrives, and only a restart/reload clears it. Reported as a recurring recent regression in the Electron app.

Root cause: `status: "streaming"` is a **one-way latch**. The server derives session status from exactly two events (`packages/server/src/session/event-status-extraction.ts:85-89`):

```ts
case "agent_start": return { status: "streaming", currentTool: null };
case "agent_end":   return { status: "idle",      currentTool: null };
```

`agent_end` is the ONLY path back to `idle` in the entire server (`rg 'status: "idle"' packages/server/src` → 1 hit). Nothing else reconciles it:

- `session_register` (`packages/server/src/event-wiring.ts:1198`) never touches `status`.
- `session_heartbeat` (`packages/shared/src/protocol.ts:247`) carries only `metrics` — no liveness truth.
- `event_forward` is fire-and-forget: no ack, no per-session replay queue.

So a single dropped `agent_end` is **unrecoverable on the transport path that lost it**.

Scope of "unrecoverable", precisely: a reconnect that *re-registers* does heal today — `sessionManager.register` unconditionally applies `status: "active"` (`packages/server/src/session/memory-session-manager.ts:174`, "Apply registration params (always override)"), and `active` renders as not-thinking. The unhealable cases are the two that never re-register:

1. a transient `ConnectionManager` reconnect (`bridge.ts` `onReconnect` sends `replay_complete`, never `session_register`; the gateway re-adopts routing from any sessionId-bearing message), and
2. a drop on a socket that never closes at all (`heartbeat timeout but WS still OPEN`).

Both leave the latch set with no path back to `idle`.

The reconnect heal that already exists is **asymmetric** — `packages/extension/src/bridge.ts:1480-1483`:

```ts
// If agent is mid-turn, send synthetic agent_start so server sets status to "streaming"
if (getBridgeState().isAgentStreaming) {
  connection.send(mapEventToProtocol(sessionId, { type: "agent_start" }));
}
```

The bridge holds the truth (`isAgentStreaming`) and re-asserts only the positive case. There is no `else` branch, so a stale `streaming` is never corrected.

Why it surfaces now: bridge WebSocket churn. From `~/.pi/dashboard/server.log` (single server run):

| session | `connection closed` | `heartbeat timeout but WS still OPEN` | `same-pid reconnect replaces incumbent` |
|---|---|---|---|
| `01a07da4` | 47 | 24 | 6 |
| `01a07c13` | 22 | 10 | 0 |
| **all sessions** | **839** | 42 | — |

Every close landing between `agent_start` and `agent_end` drops the `agent_end`. 839 closes is 839 chances to latch a session into permanent `Thinking…`.

## What Changes

- **Heartbeat carries liveness truth — one carrier, no new message type.** `SessionHeartbeatMessage` gains an optional `agentRunning: boolean` read from `getBridgeState().isAgentStreaming`. The server reconciles a mismatch on each beat: `agentRunning === false` while `status === "streaming"` → `idle`, and `agentRunning === true` while `status` is `idle`/`active` → `streaming`. A terminal (`ended`) session is never reconciled in either direction. This heals a drop on a socket that never closes — the `heartbeat timeout but WS still OPEN` case the reconnect path cannot reach.
- **Bridge reconnect heal becomes symmetric**, using that same carrier: where the bridge today sends a synthetic `agent_start` only when mid-turn, the not-streaming case sends one immediate `session_heartbeat` with `agentRunning: false`. It must NOT be spelled as a synthetic `agent_end` — that event carries run-boundary side effects a correction must not fire. The heal is sent **after** the connection's reconnect buffer flush, so a real buffered `agent_end` is still processed first and still stamps unread.
- **Server status derivation gains a reconcile path** that is explicitly distinct from the run-boundary events, so unread/naming/retry semantics stay anchored to real `agent_start`/`agent_end` only. The reconcile acts on the latch only: it never touches a terminal (`ended`) session, and it respects the existing replay-window and pending-prompt conventions.
- Not in scope: eliminating the WS churn itself. That is a separate investigation (see Impact).

## Capabilities

### New Capabilities

_None._ This restores intended behaviour of existing capabilities.

### Modified Capabilities

- `event-status-extraction`: add a requirement that session status is reconciled against bridge-reported agent liveness, not derived solely from `agent_start`/`agent_end`; and that a reconcile-driven `streaming`→`idle` transition does NOT count as an unread trigger (it is a correction, not a finished turn).
- `bridge-extension`: add a requirement that the reconnect heal reports agent liveness symmetrically, and that the periodic heartbeat carries `agentRunning`.
- `bridge-heartbeat-watchdog`: the heartbeat message shape changes; state that `agentRunning` is advisory for the watchdog and MUST NOT alter its existing timeout/grace behaviour.

## Impact

- `packages/shared/src/protocol.ts` — one field: `SessionHeartbeatMessage.agentRunning?: boolean`. No new message type on the extension→server union. Additive/optional → an older bridge against a newer server degrades to today's behaviour (no reconcile), never worse.
- `packages/extension/src/bridge.ts` — reconnect heal at ~L1480; heartbeat send at ~L3439 (`HEARTBEAT_INTERVAL = 15_000`, L105).
- `packages/extension/src/connection.ts` — an explicit post-flush hook, because `onopen` fires `onReconnect()` **before** flushing the buffer; a heal sent from `onReconnect` would overtake a buffered real `agent_end`.
- `packages/server/src/session/event-status-extraction.ts` — reconcile arm + `isUnreadTrigger` exemption.
- `packages/server/src/event-wiring.ts` — route the heartbeat/reconcile into `sessionManager.update`.
- `packages/server/src/pi/pi-gateway.ts` — **no change required**: `handleOwnedMessage` already acks the heartbeat, resets the watchdog, and fans it to `onEvent`, so `event-wiring.ts` already receives it.
- Client is unchanged: `packages/client/src/components/shell/StatusBar.tsx` / `packages/client/src/lib/session/session-status-visuals.ts` already render whatever `status` says.
- **Follow-up, separate change:** root-cause the WS churn (47 closes on one session; `heartbeat timeout but WS still OPEN` ×24; `same-pid reconnect replaces incumbent` ×6). This proposal makes the symptom self-healing; it does not remove the trigger.

## Discipline Skills

- `systematic-debugging` — the reconcile must be verified against a reproduced drop (kill the WS mid-turn), not assumed.
- `observability-instrumentation` — a reconcile that fires is evidence of a lost event; it should log, so the churn follow-up has data.
- `review-code` — protocol change touching bridge + server + gateway before commit.
