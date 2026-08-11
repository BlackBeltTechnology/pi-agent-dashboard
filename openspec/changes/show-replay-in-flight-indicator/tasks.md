## 1. Server — terminate every subscribe

- [ ] 1.1 In `packages/server/src/browser-handlers/subscription-handler.ts` `sendEventBatches` (`:55-97`), send one `{ type: "event_replay", sessionId, events: [], isLast: true }` when `compacted.length === 0`, so a payload with nothing to batch still terminates. Do NOT append a terminal frame after a non-empty loop — the loop's final batch already carries `isLast: true`.
- [ ] 1.2 Confirm the change is confined to the empty case: a payload of exactly `REPLAY_BATCH_SIZE`, and of an exact multiple of it, must still produce no extra frame.
- [ ] 1.3 Scan `packages/server/src/__tests__/subscription-handler.test.ts` and `subscription-handler-compaction.test.ts` for assertions that count `event_replay` frames on an empty path, and update those; the existing "empty delta resolves" case asserts `clearReplaying`, not message count, so it is expected to pass unchanged.

## 2. Flag plumbing (state + helpers)

- [ ] 2.1 In `packages/client/src/lib/replay/loading-history.ts`, add the delay constant `REPLAY_PILL_DELAY_MS = 300` next to the existing `SUBSCRIBE_ACK_MS` / `HYDRATE_CEILING_MS`, with a comment stating it is a render threshold (not a safety net) and is unmeasured pending transfer-phase instrumentation.
- [ ] 2.2 Confirm `clearLoadingHistory` / `rearmLoadingHistory` are already generic over `(setter, timersRef, id)` and reusable for a second flag map without modification; if any identifier is flag-specific, rename it to a neutral name in a behaviour-preserving edit.
- [ ] 2.3 In `packages/client/src/App.tsx` (beside `loadingHistory` at `:591-592`), add `replayInFlight: Map<string, boolean>` state and a `replayInFlightTimersRef` timers ref.
- [ ] 2.4 Add a `beginReplayInFlight(id)` callback mirroring `beginLoadingHistory` (`App.tsx:728-740`): set the flag and arm the short `SUBSCRIBE_ACK_MS` window. Note `beginLoadingHistory` hard-codes its setter and timers ref, so this is a new sibling (or a parameterisation of it) — not a reuse.
- [ ] 2.5 Call `beginReplayInFlight(sid)` at every existing `beginLoadingHistory` site (`App.tsx:912`, `:1570`, `:1592`) so the two flags always arm together.
- [ ] 2.6 Thread `setReplayInFlight` + `replayInFlightTimersRef` into `useMessageHandler` deps (`App.tsx:744`) and add them to the handler's dep array (`useMessageHandler.ts:1135`).

## 3. Clear + re-arm edges in the message handler

- [ ] 3.1 In `packages/client/src/hooks/useMessageHandler.ts` `event_replay` case (`:626`), clear `replayInFlight` **only** when `msg.isLast === true`. Leave the existing `loadingHistory` condition at `:692` (`events.length > 0 || isLast`) untouched.
- [ ] 3.2 In the same case, re-arm `replayInFlight` to `HYDRATE_CEILING_MS` on **every** non-terminal batch — content batches included, not only the empty heartbeat branch at `:695`. A batch on the wire is the liveness signal; without this the ceiling expires mid-transfer and clears the flag while the tail is still missing.
- [ ] 3.3 Ensure the re-arm path touches only the timers ref and never calls `setReplayInFlight`, so a multi-batch replay does not re-render the transcript once per batch.
- [ ] 3.4 Clear `replayInFlight` on the `session_updated { dataUnavailable: true }` failure edge, alongside the existing `clearLoadingHistory` call (`:324`).
- [ ] 3.5 Verify no other site clears `loadingHistory` without a matching `replayInFlight` decision; document any deliberate asymmetry inline.

## 4. Tests — server terminal batch (write first, watch fail)

Harness exemplar for every row in this section: `packages/server/src/__tests__/subscription-handler.test.ts`.

- [ ] 4.1 Test (test-plan #E5): warm subscribe whose `lastSeq` equals the session high-water mark so the delta is `[]` (input) · server sends the replay for that subscribe (trigger) · exactly ONE `event_replay` frame equal to `{ events: [], isLast: true }` (observable). See `packages/server/src/__tests__/subscription-handler.test.ts`.
- [ ] 4.2 Test (test-plan #E6): cold subscribe for a session parsing to zero events, load succeeds (input) · server sends the replay (trigger) · exactly ONE `isLast: true` frame on the success path, in addition to the pre-parse `isLast: false` start marker (observable). See `packages/server/src/__tests__/subscription-handler.test.ts`.
- [ ] 4.3 Test (test-plan #E7): replay payload of exactly `REPLAY_BATCH_SIZE` (200) events (input) · `sendEventBatches` runs (trigger) · exactly 1 frame, `isLast: true`, 200 events, no trailing empty terminal frame (observable). See `packages/server/src/__tests__/subscription-handler.test.ts`.
- [ ] 4.4 Test (test-plan #E8): replay payload of 201 events (input) · `sendEventBatches` runs (trigger) · exactly 2 frames — 200 events `isLast:false`, then 1 event `isLast:true`, no third frame (observable). See `packages/server/src/__tests__/subscription-handler.test.ts`.
- [ ] 4.5 Test (test-plan #E9): replay payload of exactly 400 events (input) · `sendEventBatches` runs (trigger) · exactly 2 frames, second `isLast: true`, no trailing empty terminal frame (observable). See `packages/server/src/__tests__/subscription-handler.test.ts`.

## 5. Tests — flag transitions (write first, watch fail)

Harness exemplar for every row in this section: `packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx`. Author into a new sibling `useMessageHandler.replay-in-flight.test.tsx`.

- [ ] 5.1 Create `packages/client/src/hooks/__tests__/useMessageHandler.replay-in-flight.test.tsx` alongside the existing `useMessageHandler.loading-history.test.tsx`, copying its harness glue.
- [ ] 5.2 Test (test-plan #E1): `replayInFlight` and `loadingHistory` both set for `s1` (input) · `event_replay { events: [200 events], isLast: false }` (trigger) · `replayInFlight` still true, `loadingHistory` false, 200 messages reduced into state (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.3 Test (test-plan #E2): `replayInFlight` set for `s1` (input) · `event_replay { events: [1 event], isLast: true }` (trigger) · `replayInFlight.get("s1") === false` (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.4 Test (test-plan #E3): `replayInFlight` set, no messages (input) · `event_replay { events: [], isLast: true }` (trigger) · both `replayInFlight` and `loadingHistory` false (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.5 Test (test-plan #E4, divergence guard): both flags set for `s1` (input) · batch A `{events:[e1..e200], isLast:false}` then batch B `{events:[e201], isLast:true}` (trigger) · after A the pair is `(loadingHistory=false, replayInFlight=true)`, after B it is `(false, false)`, asserted as a pair at each step so collapsing the two flags fails loudly (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.6 Test (test-plan #X1): `replayInFlight` set for a session (input) · `session_updated { dataUnavailable: true }` (trigger) · flag false and pill absent (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.7 Test (test-plan #X2): terminal `isLast:true` never sent (input) · armed safety-net window elapses with no further message, fake timers (trigger) · flag false, pill absent (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.8 Test (test-plan #X3): flag already cleared by an elapsed ceiling (input) · a further non-terminal batch arrives (trigger) · flag stays false, pill stays absent — clearing is one-way (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.9 Test (test-plan #X4, Decision 7 regression guard): non-terminal content batches spaced longer than `SUBSCRIBE_ACK_MS` but shorter than `HYDRATE_CEILING_MS`, total span exceeding `HYDRATE_CEILING_MS` (input) · each batch arrives under fake timers (trigger) · flag still set when the final batch arrives, pill rendered continuously throughout (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.10 Test (test-plan #X5): a non-terminal batch has just re-armed the ceiling (input) · no message of any kind before the ceiling window elapses (trigger) · flag false (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.11 Test (test-plan #X7): a server that does not terminate empty replays (input) · subscribe to a session whose replay payload is empty (trigger) · flag cleared by the safety-net window, no permanent in-flight state (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.12 Test (test-plan #X8): a client with no `replayInFlight` implementation (input) · receives `event_replay { events: [], isLast: true }` on the empty path (trigger) · existing `isLast` handling clears `loadingHistory` and renders "No messages yet", no unknown-message-type path taken (observable). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.13 Test (test-plan #P1): 10 consecutive non-terminal `event_replay` batches for one session (workload) · committed renders attributable to `replayInFlight` is 0 for batches 2..10, proving re-arm touches the timers ref only (metric) · single replay sequence (window). See `useMessageHandler.loading-history.test.tsx`.
- [ ] 5.14 Run the new file and confirm every test fails for the right reason before implementing.

## 6. Indicator rendering

- [ ] 6.1 Add a `replayInFlight?: boolean` prop to `ChatView` (`packages/client/src/components/chat/ChatView.tsx`, props block at `:78-82`), documented like the existing `loadingHistory` prop.
- [ ] 6.2 Implement the show-delay inside `ChatView`: local state plus a timer that flips a `showPill` boolean only after `REPLAY_PILL_DELAY_MS` elapses with `replayInFlight` still true. Cancel the pending timer AND reset the visible bit when the flag clears — a replay resolving at 250ms must not leave a timer that paints the pill afterwards. Do not condition on replay-cache state.
- [ ] 6.3 Add a `useEffect` reset keyed on `sessionId` that cancels any pending delay timer and clears the visible bit. `<ChatView>` is rendered without a `key` (`App.tsx:1720`) and is `React.memo`'d, so the instance is reused across session switches and this state would otherwise leak from one session to the next.
- [ ] 6.4 Render an indeterminate pill anchored to the bottom of the message list (overlaying, above the composer) when `showPill` is true — no count, no total, no percentage. Give it `data-testid="replay-in-flight-pill"`, `role="status"`, `aria-busy="true"`, and an i18n accessible label via `i18nT`, mirroring the skeleton's contract at `:1352-1358`. Use theme tokens per the `theme-system` skill.
- [ ] 6.5 Gate the pill so it cannot render while the loading skeleton is up (the skeleton branch is gated on `state.messages.length === 0`); the two indicators are mutually exclusive.
- [ ] 6.6 Verify the pill overlays the list rather than inserting into it, so it cannot perturb scroll anchoring (keeps the deferred auto-scroll change independent).
- [ ] 6.7 Leave the existing `loadingHistory` skeleton / "No messages yet" branch (`:1352-1374`) unchanged.
- [ ] 6.8 In `App.tsx:1720`, pass `replayInFlight={selectedId ? replayInFlight.get(selectedId) ?? false : false}` to `<ChatView>`, mirroring the existing `loadingHistory` prop.

## 7. Tests — rendering

Harness exemplar for every row in this section: `packages/client/src/components/editor-pane/__tests__/MarkdownViewer.test.tsx` (component render + RTL setup). Author into a new `packages/client/src/components/chat/__tests__/` directory. Drive the delay with fake timers referencing `REPLAY_PILL_DELAY_MS`, never the literal `300`.

- [ ] 7.1 Test (test-plan #F1): `replayInFlight` true for the selected session with messages present (input) · `REPLAY_PILL_DELAY_MS` elapses under fake timers (trigger) · `[data-testid="replay-in-flight-pill"]` present with `role="status"`, `aria-busy="true"` and a non-empty accessible name (observable). See `packages/client/src/components/editor-pane/__tests__/MarkdownViewer.test.tsx`.
- [ ] 7.2 Test (test-plan #F2): pill rendered per #F1 (input) · terminal `event_replay { isLast: true }` received (trigger) · pill absent from the tree (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.3 Test (test-plan #F3): messages empty, `loadingHistory` true, `replayInFlight` true (input) · delay elapses before first content, then the first content batch arrives (trigger) · before content the skeleton is present and the pill absent; after content the skeleton is absent and the pill present; never both at once (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.4 Test (test-plan #F4): a session with no persisted history (input) · only `event_replay { events: [], isLast: true }` received (trigger) · "No messages yet" rendered and the pill never rendered (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.5 Test (test-plan #F5): `replayInFlight` set, fake timers (input) · terminal `isLast:true` at `REPLAY_PILL_DELAY_MS - 1`, then timers advanced well past the threshold (trigger) · pill absent at every sampled point of the timeline, asserted across the run rather than only at the end (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.6 Test (test-plan #F6): `replayInFlight` set, fake timers (input) · timers advanced to exactly `REPLAY_PILL_DELAY_MS` with the flag still set (trigger) · pill present and still present until the flag clears (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.7 Test (test-plan #F7): `replayInFlight` set with the delay timer pending (input) · flag cleared at ~250ms, then timers advanced past 300ms (trigger) · pill absent at and after the threshold instant, and no delay timer remains armed for that session (observable). See `MarkdownViewer.test.tsx`.
- [ ] 7.8 Test (test-plan #F8): pill showing or delay pending for session A, with `<ChatView>` reused rather than remounted (input) · chat view switched to session B whose replay is not in flight, timers advanced (trigger) · pill absent for session B and no A-armed timer causes it to appear (observable). See `MarkdownViewer.test.tsx`.

## 8. Tests — end-to-end (Playwright vs docker harness)

Harness exemplars: `tests/e2e/large-session-replay.spec.ts` (multi-batch cold replay) and `tests/e2e/replay-delta-on-reload.spec.ts` (warm delta path). Read the dashboard port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 8.1 Test (test-plan #F9): a harness session large enough to span multiple `event_replay` batches (input) · fresh cold subscribe via the dashboard UI (trigger) · pill visible while batches stream, absent after the transcript settles, final transcript matching the full event count (observable). See `tests/e2e/large-session-replay.spec.ts`.
- [ ] 8.2 Test (test-plan #F10): a previously-visited, unchanged session taking the warm rehydrate → `subscribe { lastSeq }` → empty-delta path (input) · page reload against the harness (trigger) · pill never observed and the transcript renders complete (observable). See `tests/e2e/replay-delta-on-reload.spec.ts`.
- [ ] 8.3 Test (test-plan #F11): a multi-batch replay with the pill visible (input) · pill appears, then disappears (trigger) · bounding box of the last rendered message row unchanged across both transitions, proving overlay rather than in-flow insertion (observable). See `tests/e2e/large-session-replay.spec.ts`.
- [ ] 8.4 Test (test-plan #X6): network throttled so a multi-batch replay stalls mid-transfer for >2s (input) · cold subscribe over the throttled link (trigger) · pill remains visible for the whole stall and clears only once the transcript completes (observable). See `tests/e2e/large-session-replay.spec.ts`.

## 9. Verification

- [ ] 9.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; all suites green, including the pre-existing `useMessageHandler.loading-history.test.tsx` (proves no regression to the empty-vs-loading behaviour).
- [ ] 9.2 `npm run quality:changed` clean (`code-quality` skill).
- [ ] 9.3 Confirm the only `packages/server/` diff is the `sendEventBatches` empty-terminal branch and its tests, and that `packages/shared/` is untouched (spec: no wire-schema change).
- [ ] 9.4 `npm run build && curl -X POST http://localhost:8000/api/restart` (client + server change → build + restart, per the `implement` skill).
- [ ] 9.5 Run the E2E layer per the `run-dashboard-e2e-local-changes` skill so the harness reflects local changes rather than a cached image.

## 10. Manual verification (deferred post-merge)

- [ ] 10.1 (test-plan: manual-only) Inspect the pill mid-replay on each of the studio / earth / athlete / gradient themes and confirm its contrast, placement and motion read correctly and match theme tokens (test-plan #F12).

## 11. Documentation

- [ ] 11.1 Update the `loading-history.ts` row in `packages/client/src/lib/replay/AGENTS.md` (and its `loading-history.ts.AGENTS.md` sidecar) with the new constant and the second-flag role, plus `See change: show-replay-in-flight-indicator`.
- [ ] 11.2 Update the `App.tsx` row in `packages/client/src/AGENTS.md` and the `useMessageHandler.ts` row in `packages/client/src/hooks/AGENTS.md` with the `replayInFlight` state, its clear edge, and the per-batch re-arm.
- [ ] 11.3 Update `packages/client/src/components/chat/ChatView.tsx.AGENTS.md` with the new prop, the show-delay behaviour, and the session-switch reset.
- [ ] 11.4 Update the `subscription-handler.ts` row in `packages/server/src/browser-handlers/AGENTS.md` with the empty-payload terminal-batch guarantee.
- [ ] 11.5 Run `kb dox lint` and clear any `stale` / `missing` rows this change introduced.

## 12. Review

- [ ] 12.1 Run the `review-code` discipline skill over the full diff before commit.
- [ ] 12.2 Re-read the proposal's "Explicitly deferred" list against the diff and confirm nothing deferred (determinate progress fields, tail auto-scroll suppression, transfer-phase metrics, `markReplaying` signalling, arming on a server-initiated re-replay) leaked into scope.
