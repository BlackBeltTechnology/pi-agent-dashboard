## 1. Phase derivation + clock (pure)

- [ ] 1.1 Write L1 test `packages/client/src/lib/replay/__tests__/history-load-phase.test.ts` (exemplar: `packages/client/src/lib/__tests__/refresh-chat.test.ts`) — input: all 32 combos of selected/connected/hasContent/loading/failed · trigger: `deriveHistoryLoadPhase(i)` · observable: waiting iff selected && !connected && !hasContent, else loading iff loading && connected, else failed iff failed && connected && !hasContent, else idle (test-plan #E1)
- [ ] 1.2 Add to the same test file — input: undefined state with/without steering, streamingText-only, pendingPrompt-only, empty messages+empty steering · trigger: `hasChatContent` · observable: false/true/true/true/false (test-plan #E2)
- [ ] 1.3 Implement `packages/client/src/lib/replay/history-load-phase.ts` (`HistoryLoadPhase`, `SLOW_LOAD_MS`, `hasChatContent`, `deriveHistoryLoadPhase`) per design D1; verify 1.1–1.2 pass
- [ ] 1.4 Write L1 test `packages/client/src/lib/time/__tests__/use-now.test.ts` (exemplar: `packages/client/src/lib/access-grants/__tests__/yolo-status.test.ts`) — input: `useNow` imported from old and new path · trigger: render active, advance 1000 ms; render inactive · observable: same function, value +1000 ms, no interval when inactive (test-plan #E7)
- [ ] 1.5 Move `useNow` to `packages/client/src/lib/time/use-now.ts`, re-export from `lib/access-grants/yolo-status.ts`; verify 1.4 and existing yolo-status tests pass

## 2. App bookkeeping (failed, startedAt, arming, resets)

- [ ] 2.1 Write L1 test `packages/client/src/lib/replay/__tests__/loading-history.test.ts` (exemplar: `packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx`) for the `onTimeout` hook — only timer-driven clears invoke it; `clearLoadingHistory` from content/terminal paths never does; verify it fails first
- [ ] 2.2 Add optional `onTimeout` to the timer paths in `packages/client/src/lib/replay/loading-history.ts`; verify 2.1 passes
- [ ] 2.3 Write L1 test in `packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx` (exemplar: same file) — input: beginLoadingHistory with timer/startedAt states not-armed, armed+present, armed+restart, armed+missing · trigger: call `beginLoadingHistory(id, opts)` · observable: set / unchanged / reset / set (test-plan #E5)
- [ ] 2.4 Add to the same file — input: subscribe sent, no reply, no content, fake timers · trigger: advance 15000 ms · observable: loadingHistory false, failed true, replayInFlight false, phase failed (test-plan #X1)
- [ ] 2.5 Add to the same file — input: cold start marker `event_replay{events:[],isLast:false}` then silence · trigger: advance 90000 ms · observable: failed true; the replayInFlight rearm never invoked onTimeout (test-plan #X2)
- [ ] 2.6 Add to the same file — input: first content batch reduced, terminal never arrives · trigger: advance past both windows · observable: failed false, messages kept (test-plan #X3)
- [ ] 2.7 Add to the same file — input: `session_updated{dataUnavailable:true}` for (a) session with armed timer (b) never-subscribed session · trigger: dispatch · observable: a failed true; b failed false (test-plan #X4)
- [ ] 2.8 Add to the same file — input: session failed by timeout · trigger: `event_replay{events:[],isLast:true}` · observable: failed false; connected ChatView renders "No messages yet" (test-plan #X5)
- [ ] 2.9 Write L1 test `packages/client/src/hooks/__tests__/useMessageHandler.history-load-reset.test.tsx` (exemplar: `packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx`) — input: sessions A (selected) and B loading with armed 15 s timers, B failed · trigger: status disconnected→connected, advance 20 s · observable: all maps cleared for A and B; markHistoryLoadFailed never called for B; B idle (test-plan #F1)
- [ ] 2.10 Add to the same file — input: loading session with armed timer + failed mark · trigger: `clearInMemoryState()` then advance 100 s · observable: all four maps empty; timer callback never runs (test-plan #F2)
- [ ] 2.11 Implement in `packages/client/src/App.tsx` per design D2: `historyLoadFailed`, `historyLoadStartedAt` (+ `historyLoadStartedAtRef`), `markHistoryLoadFailed` (content-gated, also clears replayInFlight), `beginLoadingHistory(id, {restart})` with pure reads-before-setters and built-in `onTimeout`, reconnect reset of flags/timers/failed/startedAt, `clearInMemoryState` cleanup; verify 2.3, 2.4, 2.9, 2.10 pass
- [ ] 2.12 Implement in `packages/client/src/hooks/useMessageHandler.ts`: `markHistoryLoadFailed` dep passed only at the single `loadingHistory` rearm site; capture `wasLoading` before the dataUnavailable clears; clear failed on non-empty and terminal batches; verify 2.5–2.8 pass
- [ ] 2.13 Implement the D3 `useLayoutEffect` arm-at-selection in `App.tsx` and the `historyPhaseMap` `useMemo` (true-valued ids only; deps incl. `status`, `sessions`); verify `npm test` for packages/client stays green
- [ ] 2.14 Update existing tests that assert "No messages yet" after a safety-net timeout to assert the failed state; verify packages/client suite green

## 3. Retry

- [ ] 3.1 Write L1 test in `packages/client/src/lib/__tests__/refresh-chat.test.ts` (exemplar: same file) — input: deps spied, loading flag set, startedAt = now−14 s · trigger: `handleRefreshChat(sid)` path · observable: dropPersisted before subscribe `{lastSeq:0}`; beginLoadingHistory called with `{restart:true}`; startedAt == now (test-plan #F3)
- [ ] 3.2 Bind `handleRefreshChat`'s `beginLoadingHistory` dep to `{restart:true}` in `App.tsx` (design D5); verify 3.1 passes

## 4. Chat view states

- [ ] 4.1 Write L1 test `packages/client/src/components/chat/__tests__/ChatView.history-load-phase.test.tsx` (exemplar: `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx`) — input: messages [], historyPhase waiting, loadingHistory true · trigger: render · observable: "Waiting for connection" in role=status, no skeleton, no "No messages yet" (test-plan #F4)
- [ ] 4.2 Add to the same file — input: messages [], historyPhase failed · trigger: render, click Retry · observable: "Couldn't load history" in role=alert, onRetryHistory called once, no "No messages yet" (test-plan #F5)
- [ ] 4.3 Add to the same file — input: historyPhase idle with loadingHistory true / false; messages present with connected false · trigger: render · observable: skeleton / "No messages yet" / bubbles with no waiting state (test-plan #F6)
- [ ] 4.4 Write L1 test `packages/client/src/components/chat/__tests__/SlowLoadNotice.test.tsx` (exemplar: `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx`) — input: startedAt t0, fake timers · trigger: advance to t0+9999 then t0+10000 · observable: nothing, then "Still loading history" + "· 10s" + Retry (test-plan #E3)
- [ ] 4.5 Add to the same file — input: notice visible at 10 s · trigger: advance 3 × 1000 ms · observable: role=status text stays "Still loading history"; aria-hidden sibling "· 10s"→"· 13s" (test-plan #F7)
- [ ] 4.6 Add to `ChatView.history-load-phase.test.tsx` — workload: ChatView under React Profiler with slow notice visible · metric: ChatView commit count +0 while notice commits +5 · window: 5 s fake time (test-plan #P1)
- [ ] 4.7 Implement ChatView `historyPhase`/`historyStartedAt`/`onRetryHistory` props, waiting + failed branches ahead of the existing empty logic, and `SlowLoadNotice` component per design D8; wire props from `App.tsx`; verify 4.1–4.6 pass
- [ ] 4.8 Add i18n keys (waiting title/body, failed title/body, slow notice, retry, card ring texts) to the client locale files; verify the i18n key-parity test passes

## 5. Session card ring

- [ ] 5.1 Write L1 test `packages/client/src/components/session/__tests__/SessionStatusChip.test.tsx` (exemplar: `packages/client/src/components/session/__tests__/SessionCard.host-pressure.test.tsx`) — input: phase loading, fake timers · trigger: advance 299 ms, +1 ms; separately phase→idle at 250 ms · observable: no ring, then arc; idle-at-250 never paints arc (test-plan #E4)
- [ ] 5.2 Add to the same file — input: desktop + mobile × loading/waiting/failed/idle × selected true/false (past delay) · trigger: render · observable: arc/dashed/error-solid/none classes as in design D7; ring precedes StatusShapeBadge; title has source—status AND ring text; role=status only when selected, sr text has no digits; mobile adds no w-/h- class (test-plan #F8)
- [ ] 5.3 Add to the same file — input: phase loading, startedAt now−10 s · trigger: advance 2 × 1000 ms · observable: title ends "· 10s", "· 11s", "· 12s" (test-plan #F9)
- [ ] 5.4 Add to `packages/client/src/components/session/__tests__/SessionCard.host-pressure.test.tsx`-style new file `SessionCard.history-ring-perf.test.tsx` (exemplar: `SessionCard.host-pressure.test.tsx`) — workload: SessionCard under Profiler, phase loading, startedAt 12 s ago · metric: SessionCard commits +0, chip title changes 5 times · window: 5 s fake time (test-plan #P2)
- [ ] 5.5 Write L1 test in `packages/client/src/components/__tests__/SessionList.test.tsx` (exemplar: same file) — input: 3 sessions, historyPhaseMap has only B loading · trigger: render · observable: only B's chip has a ring (test-plan #F10)
- [ ] 5.6 Add L1 contrast test to `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts` (exemplar: same file) — input: `--accent`, `--text-tertiary`, `--status-error` × `--bg-primary`, `--bg-tertiary` × all 18 palettes · trigger: compute WCAG ratio · observable: every pair ≥ 3.0 (test-plan #E6)
- [ ] 5.7 Extract `SessionStatusChip` (desktop + mobile variants, markup + `session-status-icon` test id preserved) with ring, show-delay, `useNow` clock and owned `title` per design D6/D7; thread `historyPhaseMap` App → SessionList → SessionCard; verify 5.1–5.6 pass

## 6. Browser E2E (docker harness)

- [ ] 6.1 Write L3 `tests/e2e/session-history-load-state.spec.ts` (exemplar: `tests/e2e/replay-in-flight-pill.spec.ts`) — input: `[[faux:long-transcript]]` session, page reloaded · trigger: install MutationObserver for "No messages yet", click the card · observable: 0 "No messages yet" nodes recorded until transcript renders; skeleton seen (test-plan #F11)
- [ ] 6.2 Add to the same spec — input: same session, `stallServerToClientWs(page, gap)` · trigger: select the card · observable: selected chip shows spinning arc while batches land; arc gone after last message + pill clear (test-plan #F12)
- [ ] 6.3 Add to the same spec — input: card at 1440 px and 375 px · trigger: record name/timestamp boxes, trigger loading via stall, record again · observable: boxes identical in both layouts (test-plan #F13)
- [ ] 6.4 Add to the same spec (exemplar for socket close: `tests/e2e/paging-exhausted-reconnect-rearm.spec.ts`) — fault: server→client WS closed for a selected empty-in-client session · trigger: close, later allow reconnect · observable: "Waiting for connection" + dashed ring + no spinner while down; skeleton → transcript and ring gone after reconnect (test-plan #X6)
- [ ] 6.5 Add to the same spec (exemplar: `stallServerToClientWs` in `tests/e2e/replay-in-flight-pill.spec.ts`) — fault: server→client frames stalled > 10 s · trigger: wait for notice, click Retry, release frames · observable: "Still loading history" + "· 1Xs"; notice gone after Retry; transcript renders (test-plan #X7)
- [ ] 6.6 Add to the same spec — fault: every server→client replay frame dropped · trigger: wait > 15 s, restore frames, click Retry · observable: "Couldn't load history" (role=alert) + Retry, solid error ring; after Retry skeleton → transcript, ring gone (test-plan #X8)
- [ ] 6.7 Run the L3 spec against the docker harness (`docker/test-up.sh`, port from `.pi-test-harness.json`) and verify 6.1–6.6 pass

## 7. Manual verification + docs

- [ ] 7.1 Manual: inspect loading / waiting / failed rings on selected + unselected cards in studio, earth, athlete, gradient × light/dark — rings read as three distinct states and never obscure the status badge (test-plan: manual-only, #F14)
- [ ] 7.2 Manual: VoiceOver on macOS Safari — slow load to 20 s, switch between two loading cards, force a failure — slow notice announced once, only the selected card announces, failed alert announced (test-plan: manual-only, #X9)
- [ ] 7.3 Update `AGENTS.md` rows for touched files (`App.tsx`, `ChatView.tsx`, `SlowLoadNotice.tsx`, `SessionCard.tsx`, `SessionStatusChip.tsx`, `SessionList.tsx`, `loading-history.ts`, `history-load-phase.ts`, `use-now.ts`, `yolo-status.ts`, `useMessageHandler.ts`, `refresh-chat.ts`) with `See change: show-session-history-load-state`; verify each row exists
- [ ] 7.4 Run `review-code` on the diff, then `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures
