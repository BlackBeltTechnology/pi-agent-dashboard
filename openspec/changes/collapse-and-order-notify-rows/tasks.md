## 1. Shared protocol

- [ ] 1.1 Add optional `ts?: number` to `NotifyLogEntry` (`packages/shared/src/types.ts`), `NotifyMessage` (`packages/shared/src/protocol.ts`) and `BrowserNotifyMessage` (`packages/shared/src/browser-protocol.ts`), with a doc comment (epoch ms, emit time); verify `npx tsc --noEmit -p packages/shared` passes

## 2. Bridge

- [ ] 2.1 Stamp `ts: Date.now()` in `createNotifyProxy` (`packages/extension/src/notify-proxy.ts`); verify with the E1 test (task 7.1)

## 3. Server

- [ ] 3.1 In `handleNotify` (`packages/server/src/event-wiring.ts`), keep a bridge `ts` only when `typeof ts === "number" && Number.isFinite(ts) && ts > 0`, else stamp `Date.now()`. Apply this to live, legacy (`fromLegacyPromptRequest`) and server-created entries, and forward `ts` in the browser `notify`. Verify with the E2/E3/X3 tests (tasks 7.2, 7.3, 7.20)
- [ ] 3.2 Forward `entry.ts` (when present) in `replayNotifyLog` (`packages/server/src/pairing/browser-gateway.ts`); verify with the E4 test (task 7.4)
- [ ] 3.3 Update existing server notify fixtures that assert exact entry shape (e.g. `notify-log-persistence.test.ts` `toEqual(LOG)`) so they tolerate or assert the new `ts`; verify the server notify tests pass

## 4. Client reducer + placement

- [ ] 4.1 Add pure `insertByTs(messages, row, ts)` to `packages/client/src/lib/chat/event-reducer.ts` (array-order scan from the end, skip `historyGap`, insert after the first row with `timestamp <= ts`, else before the first non-gap row, else append). Extend `addNotify(state, notifyId, message, level?, ts?)` to set `timestamp: ts`, store `ts` in `params`, and place via `insertByTs`; without `ts` it keeps today's append. Verify with the E5–E8 and X1/X2 tests
- [ ] 4.2 Pass `msg.ts` through both call sites: `packages/client/src/hooks/useMessageHandler.ts` and `packages/client/src/hooks/useSessionState.ts`; verify with the E9 test
- [ ] 4.3 After each history-backfill splice in `useMessageHandler.ts`, re-seat every notify row whose `params.ts` is a number, via `insertByTs` in ascending `ts`; verify with the E10 test

## 5. Client collapse + render

- [ ] 5.1 Extract the rendered-text helper (`params.message` → `params.title` → `""`) from `NotifyRenderer.tsx` into a shared export used by the renderer and the collapse; verify `NotifyRenderer.test.tsx` still passes unchanged
- [ ] 5.2 Create pure `collapseRepeatedNotifies(rows)` in `packages/client/src/lib/chat/collapse-repeated-notifies.ts`: key = normalized level + non-empty rendered text; for runs of 2 or more, output a shallow clone of the first member with `args.params.repeat = {count, firstTs, lastTs}`; never mutate the input. Verify with the E11/E12 tests
- [ ] 5.3 Call `collapseRepeatedNotifies` as the final step inside the `displayRows` memo in `packages/client/src/components/chat/ChatView.tsx`, on both return paths (normal and frozen-tail); verify with the E13/E14 tests
- [ ] 5.4 Render `params.repeat` in `NotifyRenderer.tsx`: a `×N` text badge plus a first–last range formatted with `Intl.DateTimeFormat(<UI language>, {hour:"2-digit", minute:"2-digit"})` (short date added when first and last fall on different days), and an accessible label; with no annotation or `count === 1` the output is unchanged. Verify with the E15/E16 tests
- [ ] 5.5 Add the new i18n keys to the `zhCN` literal in `packages/client/src/lib/i18n/i18n.tsx` and to `huCatalog` in `packages/client/src/lib/i18n/i18n-hu.ts`, with the English call-site fallback; verify with the E17 test and `npm run i18n:parity`

## 6. E2E fixture

- [ ] 6.1 Add faux scenario `notify-repeat` to `qa/fixtures/faux-scenarios.ts`, emitting 5 identical `warning` notifies in one tool call (following the existing `notify-levels` scenario); verify the F1 spec drives it (task 7.21)

## 7. Tests (folded from test-plan.md)

- [ ] 7.1 L1 extension test — bridge stamps ts. Exemplar: `packages/extension/src/__tests__/prompt-bus-wiring.test.ts` (existing `createNotifyProxy` coverage). Triple: `createNotifyProxy` with `Date.now()` stubbed to 1758650000000 · `notify("m")` · sent message has `ts: 1758650000000`, required fields present, no `promptId`/`placement` (test-plan #E1)
- [ ] 7.2 L1 server test — ts validation. Exemplar: `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts` (notify dispatch harness). Triple: incoming `ts` ∈ {1758650000000, 1, 0, -5, NaN, Infinity, "x", absent}, server clock 2000 · `handleNotify` · logged entry and forwarded frame carry the valid value, or 2000 for each invalid one (test-plan #E2)
- [ ] 7.3 L1 server test — legacy and server-created notifies carry ts. Exemplar: `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`. Triple: legacy `prompt_request{prompt.type:"notify"}` and the server-internal OpenSpec notice, clock 3000 · event-wiring dispatch · both entries and frames carry `ts: 3000` (test-plan #E3)
- [ ] 7.4 L1 server test — ts persisted and replayed. Exemplar: `packages/server/src/__tests__/notify-log-persistence.test.ts`. Triple: log with `{ts:111}` plus one pre-change entry without `ts` · persist, cold-hydrate, `replayNotifyLog` · frames carry `ts:111` / no `ts` in log order; cap eviction unchanged at 50/51 (test-plan #E4)
- [ ] 7.5 L1 client test — sorted placement BVA. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: `messages` [100,200,300] · `addNotify` with ts ∈ {50,100,250,300,400} · index 0 / after 100 / between 200 and 300 / after 300 / tail, row `timestamp === ts` (test-plan #E5)
- [ ] 7.6 L1 client test — divider rules. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: `[gap,500,600]`+100, `[100,200,gap,800,900]`+300, `[gap]`+5, `[]`+5 · `addNotify` · after gap / after 200 before gap / appended after gap / single row (test-plan #E6)
- [ ] 7.7 L1 client test — no ts appends. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: `messages` [100,200], client clock 9000 · `addNotify` without ts · appended at the tail with `timestamp 9000` (test-plan #E7)
- [ ] 7.8 L1 client test — dedup unchanged. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: `ui-n1` already at index 1 · `addNotify(n1, ts)` replayed · same state reference, one `ui-n1` row (test-plan #E8)
- [ ] 7.9 L1 client test — both reducers agree. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts` (both-reducer case). Triple: the same `notify{ts:250}` frame · fed to the main handler and to `SessionStateAccumulator` · identical `messages` order, `interactiveRequests` empty in both (test-plan #E9)
- [ ] 7.10 L1 client test — backfill re-seat. Exemplar: `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`. Triple: `[gap, notify(ts150), 500, 600]` · backfill splice of [100,200] · order `[gap,100,notify,200,500,600]`; two ts-placed notifies re-seat in ascending ts (test-plan #E10)
- [ ] 7.11 L1 client test — collapse run detection. Exemplar: `packages/client/src/lib/__tests__/chat-virtual-rows.test.ts` (pure display-row helper tests). Triple: rows A×3 (warning), msg, A, A(error), B×2, title-only T1, T2, ""×2 · `collapseRepeatedNotifies` · A(×3), msg, A, A(error), B(×2), T1, T2, "", "" (test-plan #E11)
- [ ] 7.12 L1 client test — non-mutating, stable key. Exemplar: `packages/client/src/lib/__tests__/chat-virtual-rows.test.ts`. Triple: run a,b,c (ts 10,20,30), then add d (ts 40) · collapse twice · output id `a` both times, `repeat` {3,10,30} then {4,10,40}, inputs equal their pre-call snapshots (test-plan #E12)
- [ ] 7.13 L1 client test — collapse after the level gate. Exemplar: `packages/client/src/components/__tests__/ChatView.notify-gate.test.tsx`. Triple: warning X, info Y, warning X at `notifyMinLevel "warnings"` · ChatView `displayRows` · one X row with `repeat.count 2`; at `"all"` three rows, no repeat (test-plan #E13)
- [ ] 7.14 L1 client test — one index space. Exemplar: `packages/client/src/components/__tests__/ChatView.notify-gate.test.tsx` (row-count invariant). Triple: assistant, 10× identical warning, assistant · virtualized ChatView render · count 3 for the span, `rowTextChars.length === displayRows.length`, turn map on the same array, one rendered notify element (test-plan #E14)
- [ ] 7.15 L1 client test — badge render. Exemplar: `packages/client/src/components/__tests__/NotifyRenderer.test.tsx`. Triple: `repeat` {count 10} vs {count 1} vs none · render · `×10` + range + accessible label, icon + level word kept; count 1 / none identical to baseline (test-plan #E15)
- [ ] 7.16 L1 client test — time range across days. Exemplar: `packages/client/src/components/__tests__/NotifyRenderer.test.tsx`. Triple: first/last on the same day vs. consecutive days · render · `HH:MM–HH:MM` vs. both ends with a short date (test-plan #E16)
- [ ] 7.17 L1 client test — i18n keys resolve. Exemplar: `packages/client/src/__tests__/i18n.test.ts`. Triple: UI language `hu`, then `zh-CN` · render a collapsed row · badge + aria label differ from the English fallback; `npm run i18n:parity` passes (test-plan #E17)
- [ ] 7.18 L1 client test — old server frames. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: `notify` frames without `ts` · client reducer · appended at the tail in arrival order, client-clock timestamps, no throw (test-plan #X1)
- [ ] 7.19 L1 client test — mixed-provenance log. Exemplar: `packages/client/src/__tests__/notify-reducer.test.ts`. Triple: replay a ts-less entry then `ts:250` over [100,200,300] · `addNotify` ×2 · ts-less row at the tail, ts row between 200 and 300 (test-plan #X2)
- [ ] 7.20 L1 server test — hostile ts. Exemplar: `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`. Triple: bridge `ts` = Infinity, `"1758650000000"`, `{}` · `handleNotify` · receipt time stamped, no throw, entry `ts` finite (test-plan #X3)
- [ ] 7.21 L3 e2e — collapsed run renders once. Exemplar: `tests/e2e/notify-min-level.spec.ts` (faux-driven notify spec). Triple: `[[faux:notify-repeat]]` (5 identical warnings) · open the session · one row with the probe text showing `×5`, still one row `×5` after page reload (test-plan #F1)
- [ ] 7.22 L3 e2e — replay keeps chronological position. Exemplar: `tests/e2e/notify-channel.spec.ts`. Triple: turn 1 notify probe, then turn 2 plain-text marker · reload; then `POST /api/restart` + reload · the notify row sits above turn 2's marker both times (test-plan #F2)
- [ ] 7.23 L3 e2e — live growth keeps the row stable. Exemplar: `tests/e2e/notify-min-level.spec.ts`. Triple: `×5` run rendered · a second `[[faux:notify-repeat]]` with no intervening visible row · the same row (stable `data-index` key) reads `×10`, no second notify row (test-plan #F3)
- [ ] 7.24 Manual check — badge legibility in all 4 themes, light/dark, with long messages (test-plan: manual-only, #F4)

## 8. Docs + closeout

- [ ] 8.1 Update the per-file `AGENTS.md` rows (and sidecars) for every touched source file, plus the new `collapse-repeated-notifies.ts` row, with `See change: collapse-and-order-notify-rows`; verify with `kb_search --doc-type agents collapseRepeatedNotifies`
- [ ] 8.2 Delegate the notify-flow note in `docs/architecture.md` (Notify Flow section: `ts` stamping, chronological placement, render collapse) to DocScribe; verify the section mentions `ts` and the collapse
- [ ] 8.3 Full verification: `npm test` green, `npm run i18n:parity` green, `npm run quality:changed` clean; then `npm run reload`, `/api/restart`, `npm run build` + restart per the rebuild matrix
