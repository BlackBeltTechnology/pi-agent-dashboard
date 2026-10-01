## 1. Spike (premise check before code)

- [x] 1.1 On pi ≥ 0.84.2, run a terminal (tmux) pi session with the **real dashboard bridge** plus a throwaway extension registering `__probe`, whose handler runs `await ctx.reload()`, dispatched via `pi.sendUserMessage("/__probe x", {expandPromptTemplates:true})`. Confirm: (a) no user message or `agent_start` appears; (b) `session_start{reason:"reload"}` fires in the reloaded instance; (c) a second dispatch reloads again; (d) a value set on `process` before the reload is readable in the new instance; (e) whether the reloaded bridge passes the `initBridge` re-entry guard today (`prev.pi !== pi`, `bridge.ts` ~L222) — log generation before/after. Record the results in design.md Context. If (a)–(d) fail, stop and revise the design.

## 2. Version gate and outcome types

- [x] 2.1 Test first: extend `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` (harness exemplar: its existing `0.84.2` version-gate cases) with the predicate BVA. Triple: running pi version ∈ {`0.84.1`, `0.84.2-beta.1`, `0.84.2`, `0.87.1`, `"garbage"` ×2, `undefined`} · call `supportsInProcessCommandDispatch(readVersion)` · returns false, false, true, true, true+true, true with exactly one warn for `"garbage"`. (test-plan #E1)
- [x] 2.2 Export `supportsInProcessCommandDispatch(readVersion?)` from `packages/extension/src/slash-dispatch.ts`, reusing `compareTriplet` + `MIN_DISPATCH_PI_VERSION` without changing `tryDispatchExtensionCommand` behaviour. Verify: 2.1 passes; existing slash-dispatch tests stay green.
- [x] 2.3 In `packages/extension/src/command-handler.ts`, reword `NO_RELOAD_PATH_REASON` to name pi ≥ 0.84.2, add the reasons (already in progress / did not run / pi did not reload / timeout), and add `{ ok: true; handedOff: true }` to `ReloadOutcome`. Verify: `tsc --noEmit` for the extension package passes.
- [x] 2.4 Test: extend `packages/extension/src/__tests__/command-handler.test.ts` (harness exemplar: its existing `/reload` cases). Triple: `options.reload` resolving `{ok:true, handedOff:true}` / `{ok:false, reason:"x"}` / `{ok:true}` · command-handler receives `/reload` · 0 / 1 error (message `x`) / 1 completed `command_feedback`. (test-plan #E10)
- [x] 2.5 Make `command-handler.ts` emit no `command_feedback` for `handedOff`. Verify: 2.4 passes; existing reload cases green.

## 3. Bridge reload — requesting side (tests first)

All bridge tests below use a mocked `pi` and vitest fake timers; harness exemplar: `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` (mocked-pi bridge setup).

- [x] 3.1 Test: old pi. Triple: mocked pi reporting `0.84.1`, no slot · bridge `reload()` · error reason contains `0.84.2`, `sendUserMessage` 0 calls, no `process` slot written. (test-plan #E2)
- [x] 3.2 Test: in-flight refusal decision table. Triple: slot ∈ {same session started 10 s ago; other session started 10 s ago; same session started 61 s ago} · bridge `reload()` on pi 0.87.1 · row 1 error "reload already in progress", no send, slot unchanged; rows 2–3 one `sendUserMessage("/__dashboard_reload <newToken>", {expandPromptTemplates:true})`, slot replaced `armed`. (test-plan #E4)
- [x] 3.3 Test: start timeout. Triple: `sendUserMessage` never invokes handler · advance 5000 ms then invoke handler with original token · error contains "did not run", slot deleted, late handler calls `ctx.reload` 0 times. (test-plan #X1)
- [x] 3.4 Test: start-timeout boundary. Triple: handler invoked at 4999 ms · advance to 5001 ms · no start-timeout error, slot `started`. (test-plan #X2)
- [x] 3.5 Test: pi refuses. Triple: `ctx.reload` resolves with no `session_start` · handler completes · error contains "pi did not reload", slot deleted, no `completed`. (test-plan #X3)
- [x] 3.6 Test: finish timeout. Triple: `ctx.reload` never settles · advance to `armedAt` + 60000 ms, then B2 `session_start{reload}` · error (timeout), slot `expired`, B2 emits no `completed`. (test-plan #X4)
- [x] 3.7 Test: slow success. Triple: B2 marks `delivered` at 59 s, `ctx.reload` resolves at 61 s · advance through the 60 s finish timer · no error, outcome `handedOff`, total `/reload` terminal feedback across B1+B2 = 1. (test-plan #X5)
- [x] 3.8 Test: synchronous throw. Triple: `pi.sendUserMessage` throws `Error("stale")` · bridge `reload()` via command-handler · one error feedback containing "stale", no exception escapes, slot deleted. (test-plan #X6)
- [x] 3.9 Test: reload rejects. Triple: `ctx.reload` rejects `Error("boom")` · handler runs · error contains "pi did not reload", slot deleted, no `completed`. (test-plan #X7)
- [x] 3.10 Implement D1/D3/D4 requesting side in `packages/extension/src/bridge.ts`: version gate, in-flight refusal, mint token, arm `process.__pi_dashboard_pending_reload__`, self-dispatch, module-scoped deferred map keyed by token, `START_TIMEOUT_MS` = 5000 / `FINISH_TIMEOUT_MS` = 60000 from `armedAt`, compare-and-set slot transitions. Remove `RELOAD_KEY` and the stale "keeper UDS write" comment (~L1713). Verify: 3.1–3.9 pass.

## 4. Bridge reload — handler and reloaded side (tests first)

- [x] 4.1 Test: handler decision table (exemplar: `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts`). Triple: (args, slot) ∈ {(none, none); (tokenA, tokenA armed); (tokenB, tokenA armed); (tokenA, tokenA expired); (none, tokenA started 1 s ago)} · run `__dashboard_reload` handler with mock ctx · `ctx.reload` calls 1, 1, 0, 0, 0; row 2 slot `started`; last row one `ctx.ui.notify` warning; no `command_feedback`. (test-plan #E3)
- [x] 4.2 Test: B2 slot consumption decision table (same exemplar). Triple: `session_start` × slot ∈ {(reload, match, started, 59 s); (reload, match, started, 61 s); (reload, match, expired, 10 s); (reload, other session, started, 10 s); (startup, match, started, 10 s)} · new bridge instance handles `session_start` · row 1 `delivered` + one completed; rows 2–3 no feedback, slot deleted; rows 4–5 no feedback, slot untouched. (test-plan #E5)
- [x] 4.3 Test: wire order (same exemplar, capture `connection.send`). Triple: slot match/started/1 s · B2 `session_start{reason:"reload"}` · `session_register` < last replay entry < `replay_complete` < `/reload` completed, feedback sent once. (test-plan #E6)
- [x] 4.4 Test: re-entry guard (same exemplar). Triple: bridge on pi P1, generation 1 · (a) `session_shutdown{reason:"reload"}` then `initBridge(P2)`; (b) `initBridge(P3)` without shutdown · (a) generation 2, `pi === P2`, new connection; (b) generation 1, `pi === P1`, no new connection. (test-plan #E7)
- [x] 4.5 Rework the `__dashboard_reload` handler (D3 branches incl. the no-args in-flight warning), clear `prev.pi` in `session_shutdown` when `reason === "reload"`, and consume the slot in `session_start` after `replay_complete` (D4). Verify: 4.1–4.4 pass.

## 5. Server — forwarded-reload refusal and deadline (tests first)

Harness exemplars: `packages/server/src/__tests__/dispatch-reload-rollout.test.ts` (dispatchReload with a fake `DispatchReloadContext`) and `packages/server/src/__tests__/attach-proposal-replay.test.ts` (event-wiring `event_forward` + replay window).

- [x] 5.1 Test: in-flight refusal. Triple: idle connected PID-less session, `sendToSession` → true · `dispatchReload` twice, no feedback between · `"forwarded"` then `"refused"`, `sendToSession` once, one error feedback matching "already in progress". (test-plan #E8)
- [x] 5.2 Test: watch survives unregister. Triple: forwarded reload, fake timers · unregister at 1 s, re-register at 2 s, bridge completed at 3 s, advance to 80 s · completed persisted + broadcast once, no deadline error, watch map empty. (test-plan #E9)
- [x] 5.3 Test: deadline boundary. Triple: forwarded, bridge silent · advance to 74999 ms then 75001 ms · nothing at 74999; exactly one `/reload` error matching "did not report completion" by 75001; watch removed. (test-plan #X8)
- [x] 5.4 Test: late feedback dropped. Triple: deadline expired, no retry · bridge completed via `event_forward` at 80 s · not inserted, not broadcast, expired mark cleared. (test-plan #X9)
- [x] 5.5 Test: retry not swallowed. Triple: expired at 75 s · new `dispatchReload` at 76 s, bridge completed at 78 s · second forward allowed, 78 s feedback persisted + broadcast once, no second deadline error by 160 s. (test-plan #X10)
- [x] 5.6 Test: feedback inside replay-skip window. Triple: session in `replayingSessions` + `skipReplayInsert`, live watch · bridge `/reload` terminal feedback via `event_forward` · persisted + broadcast once, watch cleared, other replayed events still skipped. (test-plan #X11)
- [x] 5.7 Test: fan-out with an in-flight session (exemplar: `packages/server/src/__tests__/resource-activation-routes.test.ts`). Triple: two terminal sessions, one with a live watch · settings-save fan-out · in-flight → `"refused"` + one error; other → `"forwarded"`; counts include the refusal. (test-plan #X12)
- [x] 5.8 Implement D5 in `packages/server/src/rpc-keeper/dispatch-reload.ts` (watch map, refusal, 75 s deadline, expired mark cleared on re-arm, arm/settle/expire logs) and the settle hook at the top of the `event_forward` branch in `packages/server/src/event-wiring.ts` (before the replay-skip early return; self-persist+broadcast when it would be skipped; drop when expired-marked). Verify: 5.1–5.7 pass.

## 6. Integration / E2E

- [x] 6.1 Test: add `tests/e2e/terminal-reload-inprocess.spec.ts` (harness exemplars: `tests/e2e/headless-reload-dispatch.spec.ts` for the `/reload` pill assertions, `tests/e2e/tmux-session-shutdown.spec.ts` for `spawnStrategy: "tmux"` spawning). Triple: idle tmux session, TUI untouched · composer `/reload`, wait for the pill, repeat once · each time exactly one completed pill (2 total), no user bubble containing `__dashboard_reload`, no new assistant turn, pid unchanged, status converges to idle, no "stale" pill. (test-plan #F1)
- [x] 6.2 Test: in the same spec, concurrent reload. Triple: idle tmux session · two `/reload` back-to-back before the first pill resolves · exactly one completed pill + one error pill containing "already in progress", one reload, status idle. (test-plan #F2)
- [x] 6.3 Run 6.1–6.2 via the `run-dashboard-e2e-local-changes` skill (harness torn down afterwards), then the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`. Verify: no failures, no new Biome findings.

## 7. Docs and specs hygiene

- [x] 7.1 After archive sync (ship-change), update the `## Purpose` of `openspec/specs/headless-reload/spec.md`: drop "needs an upstream pi change"; state terminal-hosted sessions reload in-process via bridge self-dispatch with a server feedback deadline. Verify: `openspec validate --specs` passes.
- [x] 7.2 Update the stale `globalThis[RELOAD_KEY]` bootstrap wording in `packages/server/src/browser-handlers/session-action-handler.ts` (~L188 doc comment) and `packages/server/src/__tests__/session-action-handler-reload-predicate.test.ts` (~L104 comment). Verify: `grep -rn "RELOAD_KEY\|__pi_dashboard_reload_fn__" packages/` returns nothing.
- [x] 7.3 Delegate to DocScribe (caveman style) the update of `docs/faq.md` (~L1155 reload path selection) and `docs/architecture.md` (reload section + `__dashboard_reload` row): self-dispatch, token handshake, completion from the reloaded bridge after `replay_complete`, server 75 s deadline + in-flight refusal. Verify: `grep -n "RELOAD_KEY\|__pi_dashboard_reload_fn__\|once in its TUI" docs/` returns nothing.
- [x] 7.4 Update the rows (or sidecars) for `bridge.ts`, `command-handler.ts`, `slash-dispatch.ts` in `packages/extension/src/` AGENTS.md and for `dispatch-reload.ts`, `event-wiring.ts` in `packages/server/src/` AGENTS.md, plus a row for the new e2e spec in `tests/e2e/AGENTS.md`, each with `See change: fix-terminal-session-dashboard-reload`. Verify: `kb_search --doc-type agents "__dashboard_reload"` surfaces the updated rows.
- [x] 7.5 Comment on GitHub #725 with the root cause, noting the correction that headless reload is kill-and-respawn, not keeper dispatch. Link the change. Verify: the comment is visible on the issue.

## 8. Manual QA

- [x] 8.1 **DEFERRED — not yet run** (manual-only, validated post-merge). macOS real terminal: start `pi` directly in Terminal/iTerm (not tmux, not dashboard-spawned); send `/reload` from the dashboard three times, then type `/__dashboard_reload` in the TUI. Confirm the TUI shows "Reloaded …" each time, the dashboard shows one completed pill per dashboard reload, and none for the TUI-typed one. If a pi < 0.84.2 install is available, confirm the upgrade-pi error. (test-plan: manual-only, #F3)

## Implementation notes

- The requesting/handler/reloaded-side logic lives in a new module, `packages/extension/src/terminal-reload.ts`, because `bridge.ts` cannot be instantiated under a unit test. Its suite, `packages/extension/src/__tests__/terminal-reload.test.ts`, holds 3.1–3.9 and 4.1–4.4 (#E2–#E7, #X1–#X7). #E6 (wire order) pins the source order inside the bridge's `session_start` handler; #E7 tests the extracted `isBridgeReentry` / `releaseBridgeOwnerOnShutdown` decision.
- The server tests are in `packages/server/src/__tests__/dispatch-reload-forwarded-watch.test.ts` (#E8, #E9, #X8–#X12) and `event-wiring-reload-feedback.test.ts` (live pass-through over the real bridge socket). #X11 is pinned at unit level through `routeReloadFeedback`. A real replay-skip window is not reachable from a bridge socket: `memorySessionManager.register` does not carry `lastEntryCount`, so `canSkipWipe` is always false after a register (pre-existing; out of scope).
- The review round-1 finding was adopted: a missing or replaced slot is not treated as a handoff. It reports `RELOAD_SUPERSEDED_REASON`, at the start deadline if the handler never ran.
- 6.1/6.2 read live `/reload` `command_feedback` frames off the dashboard WebSocket rather than DOM pills. Each reload re-registers the session, so the server wipes and resets the chat, and earlier pills disappear.
