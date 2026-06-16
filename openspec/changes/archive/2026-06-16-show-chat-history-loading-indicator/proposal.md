## Why

When a user opens an old / ended session, the chat area shows **"No messages yet"** for the entire window between clicking the session and its history arriving. On the host machine (localhost WebSocket) this window is a few milliseconds and imperceptible. Over a **remote client connection** the same window stretches to seconds, because the persisted history and `asset_register` blobs transfer over a real network link. During that window the placeholder is wrong: the session is not empty, it is *loading*. There is no spinner, no skeleton, no signal — the UI looks broken or looks like the session has no content.

The latency itself is inherent (disk read + network transfer of `events.jsonl`). The defect is purely cosmetic: the client cannot distinguish "history in flight" from "genuinely empty session", so it renders the empty-state copy in both cases.

Crucially, **the server already puts the needed signals on the wire** and the client throws them away:

- Cold load of an old session (`subscription-handler.ts`, `!eventStore.hasEvents` → `directoryService` branch) sends `event_replay { events: [], isLast: false }` as an explicit *loading-started* marker before reading the file.
- Every completion path sends a terminal `event_replay { ..., isLast: true }`.
- The client handler (`useMessageHandler.ts`, `case "event_replay"`) reads `msg.events` but **never reads `msg.isLast`**. Both markers are discarded.

This is a missing client-side state machine, not a protocol gap.

## What Changes

- **NEW**: A per-session `loadingHistory` flag in the client (a `Map<sessionId, boolean>`, sibling to the existing `maxSeqMapRef` tracking). `true` means "subscribe sent, first content not yet rendered".
- **NEW**: A loading indicator rendered in `ChatView` when `loadingHistory` is `true` AND `state.messages.length === 0`. Replaces the misleading "No messages yet" copy during the load window only.
- **MODIFIED**: `ChatView` empty-state becomes a 3-way branch: `loadingHistory && messages.length === 0` → spinner; `messages.length === 0` → "No messages yet"; else → bubbles.
- **MODIFIED**: The client `event_replay` handler reads `msg.isLast` to clear the loading flag.
- **NOT INTRODUCED**: Any protocol change. `isLast` is already on `event_replay`; the server already emits start (`isLast:false`, empty) and terminal (`isLast:true`) markers on the relevant paths.
- **NOT INTRODUCED**: Any server change for the core fix. (Asset-before-events reorder for faster first-paint on remote links is flagged out-of-scope below.)
- **NOT INTRODUCED**: A blocking overlay. Content streams in incrementally; the spinner clears on the first rendered content so partial history shows as soon as it arrives.

## Loading entry / exit contract

Entry (set `loadingHistory[id] = true`):
- When the client sends `subscribe` for a session (covers both the warm `hasEvents` path — which does **not** send the empty `isLast:false` start marker — and the cold `directoryService` path).

Exit (set `loadingHistory[id] = false`):
- First non-empty `event_replay` batch reduces into state (content now visible — clear immediately, do not wait for `isLast`).
- A terminal `event_replay { isLast: true }` arrives (handles the genuinely-empty session → falls through to "No messages yet").
- A `session_updated { dataUnavailable: true }` arrives (load failed → error/empty path).
- A safety-net timeout elapses with no resolution (prevents a permanently stuck spinner if a signal is dropped or an old server omits a marker).

## Capabilities

### New Capabilities

- `chat-history-loading-indicator`: the client-side loading state machine for session history replay — the `loadingHistory` flag, its entry/exit edges, and the `ChatView` 3-way empty-state rendering contract.

### Modified Capabilities

None. The `event_replay` wire format and the server replay behavior are unchanged.

## Out of scope / follow-up

- **Asset-before-events reordering**: `replaySessionAssets` runs before `sendEventBatches`, so on a slow remote link large base64 image attachments transfer ahead of the first text bubble, widening the empty window. Reordering assets after the first event batch (or lazy on-demand asset registration) would improve first-paint latency. Tracked separately; not required to fix the reported "no visual indication" defect.

## Impact

- **MODIFIED files**:
  - `packages/client/src/hooks/useMessageHandler.ts` — `event_replay` case reads `msg.isLast` and clears the flag; new flag setter wired through deps.
  - `packages/client/src/App.tsx` — subscribe site (~line 738) sets `loadingHistory[id] = true`; owns the `loadingHistoryRef`/state and the safety-net timeout.
  - `packages/client/src/components/ChatView.tsx` — empty-state (~line 636) becomes the 3-way branch; new `loadingHistory` prop.
- **NEW files**: none (or one small `<HistoryLoadingState/>` presentational component if extracted).
- **MODIFIED**: matching `docs/file-index-client.md` rows for the three files above.
