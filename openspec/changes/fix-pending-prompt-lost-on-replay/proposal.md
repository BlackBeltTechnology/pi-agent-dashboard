## Why

A live `ask_user` prompt can become permanently invisible in the browser while the agent stays blocked on it. Observed on session `01a06f0f` (2101 stored events, maxSeq ~257k): the server tracked the prompt correctly and re-sent it on every subscribe, yet the browser never rendered it, and neither the Refresh-chat button nor a full page reload recovered it.

Two independent defects compound, one per hop:

- **Server hop — the frame is shed.** `replayPendingUiRequests` runs in the replay-completion callback of `sendEventBatches`, so the tiny `prompt_request` frame is pushed onto a socket the just-finished full replay has saturated, and `sendTo` silently drops any frame while `ws.bufferedAmount > MAX_WS_BUFFER` (4 MB). `/api/health` reports **44,889 dropped server→browser frames for that one session** (178,889 total). Refresh makes this *worse*: it resubscribes at `lastSeq: 0`, which guarantees the full-replay/saturation path. Reproduced live — windowed/delta replays deliver the prompt, full 10-batch replays never do.
- **Client hop — the state is wiped.** The `event_replay` arm of `useMessageHandler` rebuilds from `createInitialState()` whenever `firstSeq === 1 || firstSeq <= maxSeq`, and carries forward only the optimistic `pendingPrompt` via `carryPendingPrompt`. There is no `interactiveRequests` sibling, so any full-replay sweep erases an already-rendered dialog — and the same gap exists at four further reset sites. This is also why a delivered-then-replayed prompt disappears, and why a naive resync that races the replay would be undone.

A third, narrower hole is documented but deliberately not fixed: on a bridge replay exit, `reconcileAndRecomputeOnReplayExit` reconciles the registry against the prompt ids collected during the replay window, which drops a still-live prompt when that set came back empty.

## What Changes

- **Critical-frame delivery (A).** The pending-prompt replay frame bypasses the `MAX_WS_BUFFER` drop, bounded twice: a small hard cap per delivery, and an absolute buffer ceiling past which even a blocking frame is dropped and counted (so repeated resyncs on a stalled socket cannot pin unbounded memory). Scope is the pending *prompt* registry only — the legacy `extension_ui_request` leg of `replayPendingUiRequests` is dead (`trackUiRequest` has no production caller) and the notify-log replay is transcript history, not a blocking frame; neither is exempted.
- **Prompt resync protocol (B).** New `prompt_resync_request` browser→server→bridge message, with a `__resyncRequestId` echo borrowed from `subagent_resync_request` so the re-emitted prompt is **delivered to the requesting socket as a critical frame**. Routing happens inside the existing bridge `prompt_request` handler, which keeps tracking/`currentTool`/ordering intact and swaps only the final fan-out; the requester lookup is non-consuming so *every* re-emitted prompt routes, not just the first. Without this the reply re-enters through the guarded fan-out (`sendToSubscribers` → `sendTo`) and dies exactly the way the original frame did. The bridge answers from `promptBus.getPendingRequests()` — already implemented for reconnect replay, currently reachable only from `onReconnect`.
- **Client state preservation (C).** `carryInteractiveRequests`, a sibling of `carryPendingPrompt`, preserves unanswered interactive requests **and their paired `ui-<requestId>` chat rows** across a state reset, at all five reset sites (`useMessageHandler` ×2, `useSessionState` ×2, and the refresh reset in `App.tsx`).
- **Refresh becomes authoritative (B, client half).** `refreshChat` emits `prompt_resync_request`, sequenced so the reply cannot be erased by the reset it triggers.
- **Desync affordance (D).** When a session reports `currentTool === "ask_user"` but the client holds no matching `interactiveRequests` entry — not ended, not mid-replay, and held for a short grace period — the UI surfaces a "waiting for your answer — resync" affordance that fires the resync.
- Drop instrumentation distinguishes dropped *blocking* frames from dropped transcript frames, so a future regression is attributable.

No breaking changes. No new user-facing configuration.

## Capabilities

### New Capabilities
- `pending-prompt-recovery`: makes an unanswered prompt recoverable by the browser without a page reload — bounded critical-frame delivery that transcript back-pressure cannot shed, a requester-scoped resync against the bridge's PromptBus, client state that survives a replay reset, and a desync detector that surfaces and repairs the mismatch.

### Modified Capabilities
- `chat-refresh`: the refresh action SHALL additionally request a pending-prompt resync, sequenced so the restored dialog survives the reset refresh performs.
- `interactive-ui-dialogs`: adds the `prompt_resync_request` protocol message, requester-scoped delivery of its reply, and the back-pressure exemption for pending-prompt replay.

## Impact

- `packages/server/src/pairing/browser-gateway.ts` — critical frame class on `sendTo`, cap + ceiling + counters split by frame class, `replayPendingUiRequests` prompt leg.
- `packages/server/src/pairing/subagent-resync-routing.ts` — non-consuming `peek` beside the existing take-once `take`.
- `packages/server/src/browser-handlers/` — resync request handler that forwards to the bridge and records the requester (mirrors `session-action-handler.ts` `recordResyncRequester`).
- `packages/server/src/event-wiring.ts` — requester-scoped critical delivery of a token-carrying `prompt_request` reply; `reconcilePromptRequests` documented, not changed.
- `packages/extension/src/bridge.ts` — handle `prompt_resync_request` by re-emitting `promptBus.getPendingRequests()` with the `__resyncRequestId` echo; extract the existing `onReconnect` loop so both entry points share one emitter.
- `packages/shared/src/` — protocol type for the new message.
- `packages/client/src/lib/chat/event-reducer.ts` (+ `packages/client/src/hooks/useMessageHandler.ts`, `packages/client/src/hooks/useSessionState.ts`, `App.tsx`) — `carryInteractiveRequests` at all five reset sites.
- `packages/client/src/lib/chat/refresh-chat.ts`, `App.tsx`, session view — resync send + desync affordance.
- Observability: `/api/health#droppedFrames` gains a blocking-frame breakdown.
- Unrelated dead code noted, not removed: `trackUiRequest` / `pendingUiRequests` / the `extension_ui_request` emit at `browser-gateway.ts:342` have no production producer since the PromptBus migration.

## Discipline Skills

- `systematic-debugging` — the root cause is established from live evidence (`/api/health` drop counters, four reproduced subscribe shapes); any further symptom must be re-derived the same way, not guessed.
- `doubt-driven-review` — exempting frames from the back-pressure guard weakens a memory-safety control, and the resync reply crosses three hops; both bounds must be argued before they stand. (Already run once on these artifacts; re-run on any design change.)
- `observability-instrumentation` — a new server↔bridge round trip plus a new drop class; both need counters before they can be trusted in production.
- `review-code` — non-trivial change across four packages; review before commit.
