## Context

Opening an old/ended session triggers a lazy `subscribe` (`App.tsx:737`). The server replays persisted history; the client reduces incoming `event_replay` batches into `state.messages`. Until the first batch arrives, `state.messages.length === 0`, and `ChatView.tsx:636` renders "No messages yet". On localhost this gap is sub-perceptible; over a remote WebSocket it is multi-second and the placeholder reads as a bug.

### What the wire already carries

`event_replay` payload (already in `browser-protocol.ts`): `{ type, sessionId, events, isLast }`.

Server emission (`subscription-handler.ts::handleSubscribe`):

```
warm  (eventStore.hasEvents === true):
    [no empty start marker]
    event_replay{ events:[...], isLast:false } × n-1
    event_replay{ events:[...], isLast:true  }          // via sendEventBatches

cold  (!hasEvents, directoryService present):
    event_replay{ events:[], isLast:false }             // EXPLICIT loading-start marker
    …loadSessionEvents() reads events.jsonl from disk…
    replaySessionAssets(...)                            // asset blobs FIRST
    event_replay{ events:[...], isLast:true }           // via sendEventBatches

empty / error:
    event_replay{ events:[], isLast:true }              // immediate terminal
```

Client (`useMessageHandler.ts::case "event_replay"`): reduces `msg.events`, tracks `maxSeq`, handles the reset rule — **never reads `msg.isLast`**.

## Goals / Non-Goals

Goals:
- Distinguish "history loading" from "genuinely empty session" in `ChatView`.
- Show a loading indicator during the load window; clear it the instant content is renderable.
- No protocol change, no server change, client-only.
- Robust against a stuck spinner (dropped signal, old server, error path).

Non-Goals:
- Reducing the actual replay/transfer latency (asset reorder is a separate follow-up).
- A blocking modal or full-screen skeleton.
- Showing progress percentage / byte counts.

## Decisions

### Decision 1 — Flag entry on `subscribe`, not on the `isLast:false` marker

The cold path sends an explicit `event_replay{ events:[], isLast:false }` start marker, but the **warm path does not**. Keying loading-entry off that marker would leave warm re-subscribes (reconnect, status-change re-subscribe) without a spinner. Entry is therefore set at the single `subscribe` send site in `App.tsx`, which covers every path. The `isLast:false` marker remains a harmless no-op in the reducer.

### Decision 2 — Clear on first content OR terminal, whichever is first

```
        subscribe sent
              │
              ▼
        ┌───────────┐
        │  LOADING  │ loadingHistory[id]=true ; ChatView shows spinner
        └─────┬─────┘
              │
   ┌──────────┼───────────────┬───────────────────┐
   ▼          ▼               ▼                   ▼
first       isLast:true   dataUnavailable     timeout(Ns)
non-empty   (genuinely     (load failed)      (safety net)
batch       empty)              │                   │
   │            │               │                   │
   ▼            ▼               ▼                   ▼
        ─────────── loadingHistory[id]=false ──────────
   │            │
   ▼            ▼
 bubbles   "No messages yet"
```

Clearing on the **first non-empty batch** (not waiting for `isLast`) means partial history paints as soon as it arrives — the spinner only ever covers the truly-blank window. Remaining batches keep streaming behind the rendered content via the existing reducer path.

### Decision 3 — Per-session `Map`, mirror `maxSeqMapRef`

Multiple sessions can be subscribed simultaneously (background + selected). The flag is per-session, stored the same way `maxSeqMapRef` is. `ChatView` receives the selected session's value as a prop (the component already receives per-session `state`).

State vs ref: the flag must be **reactive** (drives render), so it is React state (`Map<string, boolean>` via `setLoadingHistory`), not a bare ref. The setter is threaded through `useMessageHandler` deps the same way `setSessionStates` already is.

### Decision 4 — Safety-net timeout

A dropped terminal marker, an old server that never sends `isLast`, or an unexpected branch could strand the spinner. A per-session timeout (proposed 15s; long enough not to fire on legitimately large remote transfers, short enough to recover) clears the flag defensively. The timeout is cleared on any legitimate exit. Rationale: a stuck "No messages yet" is the current bug; a stuck spinner would be a regression, so the net must exist.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Add `messageCount` to `DashboardSession`, infer empty-vs-loading from sidebar metadata | `DashboardSession` has no count today; would need a server + protocol change. The wire already carries `isLast` — cheaper and more accurate. |
| Server sends a new dedicated `history_loading` / `history_complete` message | Redundant: `event_replay.isLast` already encodes start/terminal. New message types = protocol churn + bridge/version compat surface. |
| Spinner gated on the `isLast:false` start marker only | Warm re-subscribe path never sends it → no spinner on reconnect. Decision 1 supersedes. |
| Keep spinner until `isLast:true` always | Would re-hide already-arrived content on large remote sessions; worse UX than Decision 2. |

## Risks / Migration

- **Compatibility**: Client-only, additive read of an existing optional field. An old server still works — the timeout (Decision 4) covers any path that omits a clean terminal. No bridge change, no migration, no persisted-state change.
- **Rollback**: Revert the three client files; behavior returns to today's "No messages yet" placeholder. No data or protocol implications.
- **Test surface**: existing `ChatView.test.tsx` asserts the placeholder is absent in non-empty cases — extend with a loading-true/messages-empty case and an empty-session (loading-false) case.
