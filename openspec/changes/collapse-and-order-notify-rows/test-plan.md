# Test Plan — collapse-and-order-notify-rows

Stage: design   Generated: 2026-09-23

No clarifications outstanding. Every Triple below fills from proposal/design/spec deltas (hard gate passed).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | notify-message-channel · protocol (bridge stamps ts) | EP | L1 | automated | `createNotifyProxy` with stubbed `Date.now()` = 1758650000000 | `notify("m")` | sent message has `ts: 1758650000000` and `type/sessionId/notifyId/message`; no `promptId`/`placement` |
| E2 | protocol (server validates ts) | EP + BVA | L1 | automated | incoming notify `ts` ∈ {1758650000000, 1, 0, -5, NaN, Infinity, "x", absent}; server clock stubbed 2000 | `handleNotify` | logged entry + forwarded browser `notify` carry `ts` = 1758650000000 / 1 for the valid values, and 2000 for each of 0, -5, NaN, Infinity, "x", absent |
| E3 | protocol (legacy + server-created notifies carry ts) | EP | L1 | automated | (a) legacy `prompt_request{prompt.type:"notify"}`, (b) server-internal out-of-folder OpenSpec notice; server clock 3000 | event-wiring dispatch | both log entries and forwarded messages carry `ts: 3000` |
| E4 | durability (ts persisted + replayed) | state-transition | L1 | automated | notify log with entries `{ts:111}` and one pre-change entry without `ts` | persist to `.meta.json`, cold-hydrate, `replayNotifyLog` | replayed frames carry `ts:111` and no `ts` respectively, in log order; cap-50 eviction unchanged at 50/51 entries |
| E5 | client row placement (sorted) | BVA | L1 | automated | `messages` stamped [100,200,300] | `addNotify(…, ts)` for ts ∈ {50, 100, 250, 300, 400} | index 0 / after 100 / between 200 and 300 / after 300 / tail; row `timestamp === ts` |
| E6 | client row placement (divider rules) | decision-table | L1 | automated | (a) `[gap,500,600]` + ts 100; (b) `[100,200,gap(9999),800,900]` + ts 300; (c) `[gap]` + ts 5; (d) `[]` + ts 5 | `addNotify` | (a) directly after gap; (b) after 200, before gap; (c) appended after gap; (d) single row |
| E7 | client row placement (no ts) | EP | L1 | automated | `messages` [100,200], client clock 9000 | `addNotify` without `ts` | appended at tail with `timestamp 9000` (today's behaviour) |
| E8 | dedup by notifyId unchanged | state-transition | L1 | automated | row `ui-n1` already present at index 1 | `addNotify(n1, ts)` again (warm-reconnect replay) | `state` returned unchanged by reference; one `ui-n1` row |
| E9 | both reducers | EP | L1 | automated | same `notify{ts:250}` frame | fed to `useMessageHandler` path and `SessionStateAccumulator` | both produce identical `messages` order, and `interactiveRequests` stays empty in both |
| E10 | backfill re-seat | state-transition | L1 | automated | `[gap, notify(ts150), 500, 600]` | history-backfill splice of segment [100,200] | order becomes `[gap,100,notify,200,500,600]`; two ts-placed notifies re-seat in ascending ts |
| E11 | collapse run detection | decision-table | L1 | automated | display rows: A×3 (warning), msg, A, A(error), B, B, B(info-title-only "T1"), (info-title-only "T2"), ""×2 | `collapseRepeatedNotifies` | output: A(×3), msg, A, A(error), B(×2), T1, T2, "", "" — counts only where key+adjacency match; empty text never collapses; different titles never collapse |
| E12 | collapse is non-mutating + key stable | state-transition | L1 | automated | run of 3 identical notifies (ids a,b,c; ts 10,20,30) | collapse; then append 4th (id d, ts 40) and collapse again | output row `id === "a"` both times; `params.repeat` = {3,10,30} then {4,10,40}; input objects deep-equal their pre-call snapshot (no `repeat` on stored rows) |
| E13 | collapse after level gate | decision-table | L1 | automated | rows warning X, info Y, warning X at `notifyMinLevel = "warnings"` | ChatView `displayRows` derivation | one row X with `repeat.count 2`; at `"all"` three rows, no repeat |
| E14 | one index space (chat-view delta) | invariant | L1 | automated | transcript: assistant, 10× identical warning, assistant | ChatView render (virtualized) | virtualizer `count === 3` for that span; `rowTextChars.length === displayRows.length`; the turn map indexes into the same array; exactly one rendered notify element |
| E15 | NotifyRenderer badge | EP | L1 | automated | params `{message:"m", level:"warning", repeat:{count:10, firstTs, lastTs}}` vs `{…, repeat:{count:1}}` vs none | render | count 10 → text `×10` + time range + accessible label naming the count and range, level icon + word still present; count 1 / none → DOM identical to baseline snapshot |
| E16 | NotifyRenderer time range across days | BVA | L1 | automated | `firstTs` and `lastTs` on the same local day vs. on consecutive days | render | same day → `HH:MM–HH:MM`; different days → both ends include a short date |
| E17 | i18n parity for new keys | EP | L1 | automated | UI language `hu`, then `zh-CN` | render collapsed row | badge + aria label come from `huCatalog` / `zhCN` (≠ English fallback string); `npm run i18n:parity` passes |

### Performance

No performance requirement or threshold is stated in the spec. The design keeps the new passes linear inside existing memos, so no perf scenario is catalogued (per guardrail: no threshold → no invented number).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | adjacent identical notifies collapse (rendered) | async convergence | L3 | automated | session driven by new faux scenario `[[faux:notify-repeat]]` emitting 5 identical `warning` notifies in one tool call | open session in browser | exactly one rendered row contains the probe text, and it shows `×5`; after page reload, still one row with `×5` |
| F2 | replay keeps chronological position (the incident) | state-transition | L3 | automated | turn 1 emits a notify (probe text), then turn 2 sends plain text marker | reload the page (full replay) | the notify row's DOM position is above turn 2's marker text, not below it; after `POST /api/restart` + reload, same order |
| F3 | live growth keeps row stable | async convergence | L3 | automated | `[[faux:notify-repeat]]` run already rendered as `×5` | a second `[[faux:notify-repeat]]` in the next tool call without an intervening visible row | same DOM row element (stable `data-index` key) now reads `×10`, no second notify row appears |
| F4 | badge presentation | visual/subjective | — | manual-only | collapsed warning row in all 4 themes, light/dark | human inspects | [judgment: badge is legible, aligned with the level word, doesn't crowd long messages — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | compatibility (new client / old server) | fault-injection (field absent) | L1 | automated | browser `notify` frames without `ts` (old server) | client reducer | rows appended at the tail in arrival order, timestamps from the client clock, no throw |
| X2 | compatibility (mixed-provenance log) | fault-injection (partial data) | L1 | automated | replay order: pre-change entry (no ts), then entry `ts:250`, over `messages` [100,200,300] | `addNotify` ×2 | ts-less row at the tail; ts row between 200 and 300 (documented one-time inversion, asserted so it is deliberate) |
| X3 | server rejects hostile ts | fault-injection (garbage) | L1 | automated | bridge sends `ts: 1e308*10` (Infinity), `ts: "1758650000000"` (string), `ts: {}` | `handleNotify` | receipt time stamped; no throw; log entry `ts` is a finite number |

---

## Coverage summary

- Requirements covered: 5/5 (notify-message-channel: protocol, durability, client row, ADDED collapse; chat-view: gate/derivation)
- Scenarios by class: edge 17 · perf 0 · frontend 4 · error 3
- Scenarios by level: L1 20 · L2 0 · L3 3 · — 1
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

- A new faux scenario `notify-repeat` in `qa/fixtures/faux-scenarios.ts`, following the existing `notify-levels` scenario. This extends existing infra; no new harness.
