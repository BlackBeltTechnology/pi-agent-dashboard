# Tail-First Session Loading

## Why

Opening a session replays its full history oldest→newest before the user sees anything recent. `subscription-handler.ts` streams `event_replay` batches from seq 1 upward (50/batch); the chat is bottom-anchored, so the user watches old history build and waits for the tail — on real workloads (quikdive: 261 session files, top files 17–47 MB / 1600–4000 JSONL lines) this takes many seconds. Worse, the server suppresses live `event` broadcasts to a subscriber for the whole replay window (`markReplaying`/`clearReplaying`, see `incremental-event-sync`), so a prompt sent while loading shows no stream until replay completes — the user perceives "can't send messages while loading". Cold loads re-parse the entire JSONL and re-ship the entire event stream every time the in-memory buffer was evicted.

## What Changes

- **Tail-first replay window (Slack model).** On subscribe with `lastSeq: 0`, the server sends the NEWEST window first (last N events, tail-aligned batch), so the client renders the recent conversation immediately. Older history is NOT streamed eagerly.
- **Load-older on scroll (lazy pagination).** Scroll-up near the top requests the previous window via a new `load_older { sessionId, beforeSeq }` browser→server message; the server responds with a bounded older range. Repeat until seq 1.
- **Client prepend + refold.** The client keeps the raw replayed-event buffer (already exists for the IndexedDB replay cache) and, on an older-window arrival, prepends the raw events and re-reduces the full buffer through the pure reducer. The `shouldReset (firstSeq <= maxSeq)` heuristic is replaced by explicit replay-window metadata on the wire, removing the fragile inference.
- **Live events no longer blocked by history loading.** Because the initial replay is one small tail window, the suppression window shrinks to that single batch. Older-window backfill uses the distinct `load_older` response path, which by construction cannot interleave with live `event` ordering — live streaming continues during backfill. Sending a prompt during history load works and streams immediately after the tail lands.
- **Cold load serves the tail as soon as it is available.** The worker-pool disk parse still produces the full event list, but the subscriber gets the tail window as soon as conversion finishes instead of the full-stream batch cascade; the rest stays in the in-memory buffer for `load_older`. Delta re-subscribes (`lastSeq > 0`) keep existing semantics.
- **Replay-cache interplay.** The IndexedDB replay cache (Strategy A) persists the tail window + cursor as today; a cache hit pre-seeds the tail and subscribes with `lastSeq = persistedMaxSeq`. Older-window pages are not persisted (cache stays bounded).

## Capabilities

### New Capabilities
- `chat-history-pagination`: tail-first initial replay window, `load_older` request/response contract, scroll-up trigger, client prepend/refold, and end-of-history signalling.

### Modified Capabilities
- `incremental-event-sync`: live-event suppression narrows to the initial tail window send; `load_older` responses are exempt from the suppress/catch-up machinery; client reset rule driven by explicit wire metadata instead of `firstSeq <= maxSeq` inference.
- `on-demand-session-replay`: cold disk load delivers a tail window first to subscribers instead of full-stream batches; full parsed event list still populates the in-memory buffer.
- `event-reducer`: reducer contract gains explicit "rebuild from full raw buffer on prepend" path; reset decision comes from replay metadata, not seq heuristics.
- `chat-history-loading-indicator`: loading flag clears on tail-window arrival; a separate lightweight "loading older…" affordance covers pagination (top-of-list spinner, no full-screen skeleton).
- `session-replay-persistence`: cached payload is defined as the tail window; older paginated pages excluded from persistence.

## Impact

- **Server**: `packages/server/src/browser-handlers/subscription-handler.ts` (tail-window selection, `load_older` handler), `packages/server/src/memory-event-store.ts` (range query by `beforeSeq`), `packages/server/src/browser-gateway.ts` (message routing), suppression bookkeeping (`markReplaying`/`clearReplaying`) scope narrowing.
- **Protocol**: `packages/shared/src/browser-protocol.ts` — new `load_older` request; `event_replay` gains window metadata (e.g. `windowStart`, `hasOlder`, `kind: "tail" | "older" | "delta"`).
- **Client**: `packages/client/src/App.tsx` (subscribe flow, raw-buffer ownership), `packages/client/src/hooks/useSessionState.ts` + `useMessageHandler.ts` (prepend/refold, metadata-driven reset), `packages/client/src/components/ChatView.tsx` (scroll-up trigger + "loading older" row; virtualizer anchor preservation on prepend), `packages/client/src/lib/replay-cache.ts` / `replay-persist.ts` (tail-window persistence).
- **Perf interplay**: complements active changes `memoize-chatview-to-fix-input-lag` (keystroke lag) and umbrella `reduce-chat-render-cpu-umbrella`; tail-first also shrinks initial DOM size, which those changes benefit from. No conflict: this change touches transport/order, those touch render memoization.
- **Risk**: reducer ordering invariants (message pairing, tool start/end) require the refold-from-full-buffer rule — folding an older window incrementally into existing state is NOT supported and must not be attempted. Bridge→server transfer (full `replaySessionEntries` on reconnect) is explicitly out of scope.

## Discipline Skills

- `performance-optimization`: measure tail-window time-to-first-render and prompt-send latency during load on a quikdive-scale session (>15 MB JSONL) before/after.
- `doubt-driven-review`: the wire-metadata redesign of the client reset rule replaces a subtle shipped invariant (`firstSeq <= maxSeq` + suppression) — stress-test before it stands.
