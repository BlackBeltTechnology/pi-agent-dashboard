# Tasks — fix-history-loading-false-empty-flash

## 1. Reproduce (systematic-debugging)
- [x] 1.1 Confirm the timeline on a large ended session: select card, observe
      priming `event_replay{events:[], isLast:false}`, measure ms until first
      content batch; confirm it exceeds 15000 ms on the repro machine (or
      throttle disk / add artificial parse delay to force it).
- [x] 1.2 Confirm `App.tsx:651` 15s timer is the clearer via a breakpoint /
      log on `clearLoadingHistory` (node-inspect-debugger for the timer closure).

## 2. Client timer lifecycle (C)
- [x] 2.1 Add `SUBSCRIBE_ACK_MS = 15000` and `HYDRATE_CEILING_MS = 90000`
      constants (co-locate with the existing timer-arming site in `App.tsx`).
- [x] 2.2 Add `rearmLoadingHistory(setLoadingHistory, timersRef, id, ms)` to
      `packages/client/src/lib/loading-history.ts`: clear any existing timer for
      `id`, arm a new `setTimeout(clearLoadingHistory, ms)`. Keep flag `true`.
- [x] 2.3 In `useMessageHandler.ts` `event_replay` handler, when
      `msg.events.length === 0 && msg.isLast === false` and the session's flag is
      set, call `rearmLoadingHistory(..., HYDRATE_CEILING_MS)`. This one guard
      serves both the initial priming marker AND every server heartbeat (task 3).
- [x] 2.4 Ensure the existing clear-on-first-content and clear-on-`isLast:true`
      edges (and `dataUnavailable`) still fire and tear down whichever timer is
      armed (short or long).

## 3. Server hydration heartbeat (B)
- [x] 3.1 Add `HYDRATE_HEARTBEAT_MS = 10000` constant in
      `packages/server/src/browser-handlers/subscription-handler.ts`.
- [x] 3.2 On the cold branch, immediately after the initial priming
      `event_replay { events: [], isLast: false }`, start a `setInterval` that
      re-sends the same empty non-terminal marker to each live subscriber
      (`getSubscribers`, guarded by `ws.readyState === OPEN`).
- [x] 3.3 Clear the interval in EVERY exit path of the `loadSessionEvents`
      promise: success (before/at first `sendEventBatches`), `cancelled`, error,
      and the outer `.catch`. Use a `try/finally` or a single `stopHeartbeat()`
      closure to guarantee no leak.
- [x] 3.4 Confirm no heartbeat is started on the warm/in-memory branches (they
      never emit the empty priming marker) or the no-`sessionFile` branch.

## 4. Tests
### Client (packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx)
- [x] 4.1 Cold path: priming marker keeps flag set past 15s; content batch clears.
- [x] 4.2 Dead-link path: no priming marker → cleared at 15s.
- [x] 4.3 Stuck-worker path: priming marker, no heartbeats, no content → cleared at 90s.
- [x] 4.4 Heartbeat re-arm: priming + empty `{isLast:false}` beats spaced < 90s keep
      flag set past 90s; clears only after beats stop + ceiling elapses (or content).
- [x] 4.5 Empty session: priming then `{events:[], isLast:true}` → cleared, placeholder.
- [x] 4.6 Warm regression: content-only replay clears on first content < 15s.
### Server (packages/server/src/__tests__/subscription-handler.test.ts)
- [x] 4.7 Cold subscribe emits ≥1 heartbeat marker before a delayed `loadSessionEvents` resolves.
- [x] 4.8 Heartbeat stops after the first content batch; none after `isLast`.
- [x] 4.9 Heartbeat stops on failure / `cancelled` / closed socket (no send to closed ws).

## 5. Spec + gates
- [x] 5.1 `openspec validate fix-history-loading-false-empty-flash --strict`.
- [x] 5.2 `npm run quality:changed` (biome + tsc + tests).
- [x] 5.3 code-review gate on the diff.

## 6. Docs
- [x] 6.1 Update `packages/client/src/lib/loading-history.ts` header + the
      `App.tsx` / `loading-history` rows in the nearest client `AGENTS.md` with the
      two-stage timer note, and the `subscription-handler.ts` row in the server
      `AGENTS.md` with the hydration-heartbeat note
      (See change: fix-history-loading-false-empty-flash).
