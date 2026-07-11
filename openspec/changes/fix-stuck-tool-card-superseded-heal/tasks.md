# Tasks

## 1. Reproduce (systematic-debugging)
- [x] 1.1 Reducer/handler test: deliver `[message_start(asst), tool_start(t1),
  (tool_end withheld), message_end, message_start(asst #2)]` with the reconcile route
  stubbed to 404 → assert the row is finalized `complete` + `healedBy:"superseded"` only
  after the SECOND assistant `message_start` is applied (NOT after the first inference's
  own `message_end`).
- [x] 1.2 Reducer test: same start, later `tool_start` sibling in the SAME inference, NO
  later assistant `message_start` → assert the row stays `running` (parallel-tool
  false-positive guard).
- [x] 1.3 Reducer test (abort scope, F4): start withheld-end, then `agent_end` (abort)
  with NO later assistant inference → assert the row stays `running` (aborted-mid-tool
  cards are out of scope; the heal correctly does not fire).

## 2. Supersede eligibility (client) — ADD
- [x] 2.1 Add `assistantInferenceSeq` to `SessionState` (increment on each assistant
  **`message_start`** — NOT `message_end`, which trails its own inference's tool per D1);
  stamp every running tool row with the current `assistantInferenceSeq` at
  `tool_execution_start` (`emittedAtInferenceSeq` on `ToolCallState`). Expose pure
  selector `hasLaterAssistantInference(state, toolCallId)` ≡ `state.assistantInferenceSeq
  > row.emittedAtInferenceSeq`. Do NOT use `turnCount`/`turnIndex` (too coarse, per D1)
  and do NOT rely on array position (unsafe under `reorderToolCardsForAssistantMessage`).
- [x] 2.2 Track per-row reconcile 404 count (reuse the base change's `lastAttemptRef`
  bookkeeping); expose `SUPERSEDE_MIN_404` (default 2).
- [x] 2.3 Pure selector `selectSupersededHealTargets(sessionStates, min404,
  hasLaterAssistantInference)` → rows eligible for the fallback (running,
  ≥`SUPERSEDE_MIN_404` 404s, a strictly-later assistant inference exists).

## 3. Superseded terminal heal (client) — ADD
- [x] 3.1 `synthesizeSupersededEnd(toolCallId, now)` → `tool_execution_end` with
  `isError:false`, sentinel body, top-level `data.healedBy:"superseded"` (surfaced on the
  row as `toolDetails.healedBy`), through the existing
  `toolCallId`-keyed reducer path.
- [x] 3.2 Wire into the existing session-scoped reconcile tick (NOT a per-row effect) so a
  virtualized/off-screen stuck card still heals.
- [x] 3.3 Reducer D4 carve-out: allow a real `tool_execution_end` to overwrite a
  `healedBy:"superseded"` row; superseded never clobbers real or another superseded.
  Add a both-arrival-orders commutativity test (real-then-superseded and
  superseded-then-real both settle on the real result) so the base change's
  replay-idempotency contract still holds (F5).
- [x] 3.4 Render: `complete` glyph + muted "result not captured (recovered)" note;
  supersede badge (mirror `RetriedErrorBadge`).

## 4. Observability (observability-instrumentation) — ADD
- [x] 4.1 Client `supersedeHealCount` incremented on each synthesized heal.
- [x] 4.2 Surface the count where the base change's dropped-frame counters are exposed.
  (Base counter `droppedBufferedFrames` is SERVER-side on `/api/health`; the supersede
  heal is client-only, so no server surface applies. Surfaced client-side via a
  rate-free `console.warn` carrying a running heal total, plus the per-card `recovered`
  badge as the primary user-visible signal.)

## 5. Doubt-driven review (before it stands)
- [x] 5.1 Stress-test the supersede condition against: parallel tools in the active turn;
  a genuinely slow tool whose turn is still newest; a real result racing the placeholder.
  Confirm no false-positive completion in any case; record findings.
  **Finding (fixed pre-implementation):** the amended design's "increment on
  `message_end`" boundary was a FALSE-POSITIVE vector — empirical intra-inference order
  (`event-reducer-streaming-text-flush.test.ts`) is `tool_start → tool_end → message_end`,
  so a stuck tool's OWN inference `message_end` would have healed it prematurely. Boundary
  corrected to assistant `message_start` (the next inference cannot begin until all prior
  tool results return). Tests 1.1/1.2/1.3 encode the guard; all green.

## 6. Validate
- [x] 6.1 `npm test` green (new reducer/selector suites + existing base-change suites).
- [x] 6.2 `openspec validate fix-stuck-tool-card-superseded-heal --strict`.
- [x] 6.3 `npm run quality:changed` clean (tsc --noEmit; full suite green; zero new Biome
  warnings on changed lines).

## 7. E2E scenario (tests/e2e/)
- [x] 7.1 Force a store-eviction / 404 reconcile, drive a later turn, assert the stuck
  card flips to `complete` + recovered badge without a manual refresh.
  DONE: `tests/e2e/superseded-heal.spec.ts` + faux scenario `stuck-tool-superseded`
  (`SUPERSEDE_HEAL_MARKER`). `routeWebSocket` drops the tool's `tool_execution_end` frame
  (server→browser drop); `page.route` 404s the reconcile (eviction); the scenario's second
  message supplies the later-inference proof. Asserts `tool-burst-group` `data-running`
  true→false (~45s heal) then re-expands + asserts `tool-superseded-badge`.
  **VERIFIED GREEN locally** (`PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome` against the Docker
  harness on :18000): `1 passed (51.5s)`. Fix during bring-up: the live-event WS envelope
  is `{ type: "event", event }` (useMessageHandler `case "event"`), NOT `event_forward` —
  the drop filter matches `type:"event"`. The earlier "harness not landed" assumption was
  wrong: `add-playwright-e2e` is archived and live.
