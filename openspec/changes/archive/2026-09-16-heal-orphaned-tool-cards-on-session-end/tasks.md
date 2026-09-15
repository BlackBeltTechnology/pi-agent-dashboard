## 0. Reproduce (systematic-debugging)

- [x] 0.1 From a dashboard-attached session, invoke `Agent` and `kill -9` the pi process mid-run. After grace expiry confirm: session `ended`, `Agent` tool card + subagent card still `running`; reload the page — still `running`. Note the session id in this file. REPRODUCED: session `01a0a23d-48a2-7734-8658-b5f498287e4e` (14 `Agent` toolCalls, 0 toolResults; `watchdog_force_close` + grace expiry; 14 subagent + 14 tool cards stuck `running`, also after reload).

## 1. Pure helpers `findOpenToolCalls` / `findOpenSubagents`

Test home: `packages/server/src/session/__tests__/open-tool-calls.test.ts` (new). Harness exemplar: `packages/shared/src/__tests__/state-replay.test.ts` — same shape of pure-function-over-event-array assertions.

- [x] 1.1 Test (red): stored `agent_start`, `start{A,"Agent"}`, `update{A}` with `data.partialResult.details.agentId="ag-1"`, `start{B,"bash"}`, no ends · call `findOpenToolCalls(events)` · returns exactly `[{A,"Agent","ag-1"},{B,"bash"}]` (test-plan #E1).
- [x] 1.2 Test (red): an `update` fixture copied verbatim from a recorded transcript (nested `data.partialResult.details.agentId`) vs a flat `data.details.agentId` one · `findOpenToolCalls` · nested yields `agentId:"ag-1"`, flat yields `undefined` (test-plan #E2). Guards the exact path bug the design calls out — do NOT hand-shape this fixture.
- [x] 1.3 Test (red): `start{C}` with no end BEFORE the last `agent_start`, `start{D}` with no end after it · `findOpenToolCalls` · returns `[D]` only (test-plan #E3).
- [x] 1.4 Test (red): every `start` has a matching `end` · `findOpenToolCalls` · returns `[]` (test-plan #E4).
- [x] 1.5 Test (red): `[]`, and a stream with starts but no `agent_start` · `findOpenToolCalls` · `[]`; second case treats the whole stream as one turn (test-plan #E5).
- [x] 1.6 Test (red): `created{ag-9}`+`started{ag-9}` no terminal, `started{ag-1}`+`completed{ag-1}`, `created{ag-7}` only · `findOpenSubagents(events)` · returns `["ag-9","ag-7"]` (test-plan #E6).
- [x] 1.7 Test (red): a stream already containing `end{A,healedBy:"session_ended"}` · a second `findOpenToolCalls` pass · returns `[]` (test-plan #E7).
- [x] 1.8 Test (red, perf): a synthetic stream at the store cap (20 000 events, no `agent_start`) · one `findOpenToolCalls` call · wall time < 10 ms, median of 5 (test-plan #P1). If it fails, design D2 says derive a scan limit from the measured number — do not invent one.
- [x] 1.9 Implement `packages/server/src/session/open-tool-calls.ts`: `findOpenToolCalls(events)`, `findOpenSubagents(events)`, `synthesizeSessionEndedEnd(call, now)`, `synthesizeSessionEndedSubagentFail(id, now)` (design D2, D3, D3b).
- [x] 1.10 Verify: 1.1–1.8 green; add the row to `packages/server/src/session/AGENTS.md`.

## 2. End hook (`onEnded`, both seams)

Test home: `packages/server/src/__tests__/session-end-orphan-heal.test.ts` (new). Harness exemplar: `packages/server/src/__tests__/ended-session-endedat.test.ts` — same `sessionManager` + `browserGateway` wiring fixture.

- [x] 2.1 Test (red): session with 2 open calls (one `Agent`) + 1 non-terminal subagent · (a) `unregister(id)` and (b) `update(id,{status:"ended"})` without unregister · both insert + broadcast the same 3 synthesized events, ordered BEFORE `session_updated{status:"ended"}` (test-plan #X1).
- [x] 2.2 Test (red): session with nothing open · it ends · zero `insertEvent`, zero `broadcastEvent` beyond the existing `session_updated` (test-plan #X2).
- [x] 2.3 Test (red): an already-healed session · `onEnded` fires again · no further insert; exactly 3 synthesized events total (test-plan #X3).
- [x] 2.4 Test (red): session with 1 open call · `session_moved` → `update({movedTo, status:"ended"})` · zero synthesized events (test-plan #X4). Gate reads `session.movedTo`; `ClosedReason` has no move member.
- [x] 2.5 Test (red): `replayingSessions` holds the id · session ends with 1 open call · event inserted but NOT broadcast (test-plan #X5).
- [x] 2.6 Implement in `sessionManager.onEnded` (`event-wiring.ts` ~L485 — NOT `onUnregister`, which misses the `update()` seam; design D1): derive with the section-1 helpers over `eventStore.getEvents(sessionId, 1)`, insert + broadcast each with the `insertEvent` seq, skip when `session.movedTo` is set.
- [x] 2.7 Verify: 2.1–2.5 green; verified end-to-end in the docker harness instead of the live dashboard (`tests/e2e/session-ended-orphan-heal.spec.ts` #F6: killed session → synthesized `tool_execution_end{healedBy:"session_ended"}` on the wire, burst card leaves `running`, session `ended`).

## 2b. Transcript orphan-close shape (design D7)

Test home: `packages/shared/src/__tests__/state-replay.test.ts` (extend). Harness exemplar: that same file — it already builds transcript entry lists and asserts emitted events.

- [x] 2b.1 Test (red): transcript entries whose last turn has a `toolCall` with no `toolResult` · `replayEntriesAsEvents(entries)` · emits `tool_execution_end{isError:true, result:"parent session ended", healedBy:"session_ended"}` and does not mutate the input (test-plan #X6).
- [x] 2b.2 Test (red): a transcript where every `toolCall` has its `toolResult` · `replayEntriesAsEvents` · no orphan-close event emitted (test-plan #X7).
- [x] 2b.3 Implement the orphan-close shape change (`state-replay.ts` ~L234–243). One edit — do NOT add a heal pass in `subscription-handler.ts`: the parser already closes these calls, so a second derivation would return `[]`.
- [x] 2b.4 Verify: 2b.1–2b.2 green; existing `state-replay*` suites still green (blast radius: disk hydration, archive, remote retained, bridge register-replay).

## 3. Reducer guards

Test home: `packages/client/src/lib/__tests__/event-reducer.session-ended-heal.test.ts` (new). Harness exemplar: `packages/client/src/lib/__tests__/event-reducer.superseded-heal.test.ts` — the existing heal this change generalizes.

- [x] 3.1 Test (red): tool call `A` `running`, subagent `ag-1` `running` · reduce `end{A,"Agent",isError:true,result:"parent session ended",healedBy:"session_ended",details:{agentId:"ag-1"}}` · `A` → `error`, `ag-1` → `failed` with `error:"parent session ended"` (test-plan #F1).
- [x] 3.2 Test (red): tool call `A` already `complete` · same synthesized end reduces · state deep-equals the pre-state (test-plan #F2).
- [x] 3.3 Test (red): subagent `ag-1` already `completed`, `A` `running` · synthesized end carrying `agentId:"ag-1"`, then a synthesized `subagent_failed{ag-1}` · `ag-1` stays `completed` in both cases, `A` → `error` (test-plan #F3). This is the contract-3 violation cycle-3 review found: the backfill's `patch` sets `status` unconditionally and spreads after `existingSub`.
- [x] 3.4 Test (red): a `superseded` placeholder row · a real `tool_execution_end` (no `healedBy`) reduces · row takes the real result and the marker clears (test-plan #F4, regression guard).
- [x] 3.5 Test (red): no `toolCalls` entry for `Z` · synthesized end for `Z` reduces · state unchanged, no phantom card (test-plan #F5).
- [x] 3.6 Implement (design D4): generalize the `running`-only guard in the `tool_execution_end` arm (~L2232) to any `healedBy`, AND add the terminal guard to the subagent backfill (~L2340) and to the `subagent_failed` arm for `healedBy` events.
- [x] 3.7 Verify: 3.1–3.5 green; client rebuilt into the harness image (`docker compose -f docker/compose.yml build`) and the healed card renders terminal in the browser (#F6/#F7).

## 4. Throttle default + migration

Test home: `packages/shared/src/__tests__/config.test.ts` (extend) + `packages/server/src/__tests__/throttle-default-migration.test.ts` (new, boot path). Harness exemplar: `packages/shared/src/__tests__/tunnel-config-migration.test.ts` — the repo's existing config-migration test.

- [x] 4.1 Test (red): config `{0, no marker}` / `{0, marker}` / `{250, no marker}` / `{absent}` · boot migration runs · `500`+marker written · `0` kept and file untouched · `250` kept · `500` resolved from default (test-plan #E8).
- [x] 4.2 Test (red): config carrying keys outside the `ensureConfig()` 11-key seed set · boot migration rewrites the throttle · every unrelated key still present (test-plan #E9).
- [x] 4.3 Test (red): no `config.json` · `ensureConfig()` creates it, user writes `0`, server boots again · marker present at creation and the user's `0` survives (test-plan #E10).
- [x] 4.4 Test (red): writable `config.json` `{0, no marker}` · `loadConfig()` called without a boot · file bytes + mtime unchanged (test-plan #X8).
- [x] 4.5 Implement: flip `DEFAULT_CONFIG.subagentTickThrottleMs` to `500`; declare the marker on `DashboardConfig`; write it unconditionally in `ensureConfig()`; add the one-shot migration at server boot beside `ensureConfig()` (`cli.ts` ~L673) via `writeConfigPartial` — never in `loadConfig` (design D5); update the L925 comment (`See change: heal-orphaned-tool-cards-on-session-end`).
- [x] 4.6 Verify: 4.1–4.4 green; harness container config carries no throttle key → `loadConfig` resolves the new `500` default and the bridge coalesces (`default-throttle P3` ≤ 4 ticks/s); `npm run reload`; `~/.pi/dashboard/config.json` shows `500` + marker (bridge reads `windowMs` once at init, so only sessions started after the reload pick it up).

## 4b. Memoize `npm root -g` in the resolver (performance-optimization)

Test home: `packages/shared/src/__tests__/pi-package-resolver.test.ts` (extend) — its own harness exemplar (already stubs `npmRoot` for hermetic resolution).

- [x] 4b.1 Baseline: `cd ~/Project/judo-ng && node spike/perchild-cost-spike.mjs "$PWD" wrapper 7` → record `maxLoopLagMs` here. MEASURED (pre-memo, bridge-plugin-only agentDir): `maxLoopLagMs` **5046 ms**, 24 `npm root -g` spawns / 5782 ms. Post-memo (same harness, worktree `shared` linked in): **54 ms**, 1 spawn / 246 ms.
- [x] 4b.2 Test (red): `vi.spyOn(npm,"rootGlobalOr")`; 3× `resolvePiPackageEntry` + 1× `listPiPackages` without `npmRoot` · the four calls run · spy called exactly once (test-plan #E11).
- [x] 4b.3 Test (red): `{npmRoot:"/tmp/x"}`, then `resetNpmRootCacheForTests()` + a default call · override → spy never called and `/tmp/x` used; after reset → spy called again (test-plan #E12).
- [x] 4b.4 Test (red): `rootGlobalOr` stubbed to `""` · two default resolves · spy called once, both resolves identical (test-plan #E13).
- [x] 4b.5 Test (red): resolve spec `X` (miss), add `X` to a tmp `agentDir` settings `packages[]`, resolve again · second call resolves `X` — settings reads are not cached (test-plan #E14).
- [x] 4b.6 Implement (design D6): module-level cache + `defaultNpmRoot()` + `resetNpmRootCacheForTests()`; replace both `opts.npmRoot ?? rootGlobalOr("")` sites. `resolver-parity-with-scanner.test.ts` greps the literal token `rootGlobalOr` — the wrapper keeps it; `no-server-imports-in-resolver` must stay green.
- [x] 4b.7 Correct the now-false contract statements: module header (`pi-package-resolver.ts` L23–25, "holds no module-level cache") and, at spec-sync time, the capability Purpose ("never caches") plus the requirement sentence "never writes, network calls, or process spawning".
- [x] 4b.8 Test (red, L2 perf): `node spike/perchild-cost-spike.mjs <cwd> wrapper 7` · 7 concurrent child loaders, warm parent · `maxLoopLagMs` < 300 ms (test-plan #P2). Harness exemplar: `qa/tests/02-server-start.sh` for the shell-runner shape.

## 5. Live + E2E scenarios

Harness exemplars: `tests/e2e/ended-session-endedat.spec.ts` (session-end lifecycle against the docker harness) and `tests/e2e/subagent-inspector.spec.ts` (subagent card state). Read `dashboardPort` from `.pi-test-harness.json` — never hardcode `:18000`.

- [x] 5.1 Test (red, L3): a dashboard-attached session running `Agent` · the pi process is killed out of band, grace expires · the `Agent` tool card converges to error showing `parent session ended`, the subagent card to failed, the session to `ended` (test-plan #F6).
- [x] 5.2 Test (red, L3): the session from 5.1 with the server restarted so the store lost it · reopen it in the browser (cold hydration) · the tool card is STILL an error card with `parent session ended` (test-plan #F7).
- [x] 5.3 Test (red, L2): a live `Agent` run under the flipped default · 30 s subagent run · bridge metrics `tickCoalesced > 0`, forwarded ticks ≤ 4/s per child (test-plan #P3). Harness exemplar: `qa/tests/03-websocket.sh`.

## 6. Docs + closeout

- [x] 6.1 DocScribe: `docs/faq.md` entry "subagent / tool card stuck `running` after the session ended" (cause, heal, `healedBy:"session_ended"`, and that `/api/session/:id/tool-result/:toolCallId` can now return a synthesized end — the marker is what distinguishes it); `docs/architecture.md` one line under session lifecycle if a heal list exists there.
- [x] 6.2 AGENTS.md rows: `packages/server/src/event-wiring.ts.AGENTS.md`, `packages/client/src/lib/chat/event-reducer.ts.AGENTS.md`, `packages/shared/src/config.ts.AGENTS.md`, `packages/shared/src/state-replay.ts.AGENTS.md`, `packages/shared/src/AGENTS.md` row for `pi-package-resolver.ts` (`See change: heal-orphaned-tool-cards-on-session-end`).
- [x] 6.3 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; …` — 19987 passed / 7 failed; every failure is the UNINSTALLED-WORKTREE environment (no per-worktree `node_modules`: `tsc` ENOENT, `@earendil-works/pi-coding-agent` package.json ENOENT, `browse-endpoint` expecting a `node_modules` entry) and reproduces on a pristine HEAD checkout. L3 `session-ended-orphan-heal` #F6/#F7 green twice against the docker harness; `default-throttle P3` green on the `PI_SYNTH_AGENT_TICKS=1` arm.
- [x] 6.4 review-code pass over the diff — isolated `@review` subagent, 2 rounds. Round 1: 1 blocking (stray `.pi/settings.json` absolute-path churn, reverted) + 3 non-blocking (markerless-config migration hole, healed-end `toolDetails` wholesale replace, synthetic `agent_start` turn-scope gap) + nits; all fixed or documented (the turn-scope gap is an accepted trade-off, recorded in design D2 + the module header, with the D7 transcript heal as the backstop). Round 2: all fixes verified, ZERO blocking findings.
