# Test Plan — fix-terminal-session-dashboard-reload

Stage: design   Generated: 2026-09-26

Constants under test: `START_TIMEOUT_MS` = 5000, `FINISH_TIMEOUT_MS` = 60000 (both from bridge `armedAt`), `FORWARDED_RELOAD_DEADLINE_MS` = 75000 (server, from forward). Slot: `process.__pi_dashboard_pending_reload__ = {token, sessionId, state, armedAt}`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D2 version gate | EP+BVA | L1 | automated | running pi version ∈ {`0.84.1`, `0.84.2-beta.1`, `0.84.2`, `0.87.1`, `"garbage"` (called twice), `undefined`} | call exported `supportsInProcessCommandDispatch(readVersion)` | returns false, false, true, true, true+true, true; exactly one `console.warn` for the two `"garbage"` calls; existing `tryDispatchExtensionCommand` tests unchanged and green |
| E2 | Spec: terminal session on pi < 0.84.2 | EP | L1 | automated | mocked pi reporting `0.84.1`, no slot | bridge `reload()` | outcome `{ok:false}` whose reason contains `0.84.2`; `pi.sendUserMessage` called 0 times; no slot written on `process` |
| E3 | D3 handler branches | decision-table | L1 | automated | handler invoked with (args, slot) ∈ {(none, none); (tokenA, `{tokenA, armed}`); (tokenB, `{tokenA, armed}`); (tokenA, `{tokenA, expired}`); (none, `{tokenA, started, armedAt: now-1s}`)} | run `__dashboard_reload` handler with a mock ctx | `ctx.reload` called 1, 1, 0, 0, 0 times; second row slot `state === "started"`; last row `ctx.ui.notify` called once with a warning; no `command_feedback` emitted in any row |
| E4 | D3 bridge in-flight refusal / Spec: concurrent reload | decision-table | L1 | automated | slot ∈ {`{same sessionId, started, armedAt: now-10s}`; `{other sessionId, started, now-10s}`; `{same sessionId, started, now-61s}`} | bridge `reload()` on pi 0.87.1 | row 1: outcome error "reload already in progress", `sendUserMessage` 0 calls, slot unchanged; rows 2–3: `sendUserMessage` called once with `"/__dashboard_reload <newToken>"` + `{expandPromptTemplates:true}`, slot replaced with new token, `state:"armed"` |
| E5 | D4 B2 slot consumption | decision-table | L1 | automated | `session_start` event × slot ∈ {(reload, match, started, age 59 s); (reload, match, started, age 61 s); (reload, match, expired, 10 s); (reload, other sessionId, started, 10 s); (`startup`, match, started, 10 s)} | new bridge instance handles `session_start` | row 1: slot `delivered`, one `command_feedback {command:"/reload", status:"completed"}`; row 2: no feedback, slot deleted; row 3: no feedback, slot deleted; row 4: no feedback, slot untouched; row 5: no feedback, slot untouched |
| E6 | Spec: completion arrives after re-register; D4 wire order | state-transition | L1 | automated | slot `{match, started, age 1 s}`, mocked connection capturing `send` order | B2 `session_start{reason:"reload"}` | captured sequence: `session_register` index < last replay entry < `replay_complete` index < `/reload` `command_feedback` index; feedback sent exactly once |
| E7 | D4 subagent re-entry guard | state-transition | L1 | automated | bridge initialised with pi object P1 (generation 1) | (a) `session_shutdown{reason:"reload"}` then `initBridge(P2)`; (b) no shutdown, `initBridge(P3)` (subagent load) | (a) generation becomes 2, `getBridgeState().pi === P2`, new connection created; (b) generation stays 1, `pi === P1`, no new connection |
| E8 | D5 server in-flight refusal | state-transition | L1 | automated | idle session, no headless PID, connected, `sendToSession` → true | `dispatchReload` twice without any feedback in between | first returns `"forwarded"`; second returns `"refused"`; `sendToSession` called exactly once; one `emitCommandFeedback(…, "/reload", "error", /already in progress/)` |
| E9 | D5 watch survives unregister | state-transition | L1 | automated | forwarded reload, fake timers | `session_unregister` (session → ended) at t=1 s, re-register at t=2 s, bridge `/reload` completed feedback at t=3 s, advance to t=80 s | the completed feedback is persisted + broadcast once; no deadline `error` emitted; watch map empty |
| E10 | D4 `handedOff` outcome | EP | L1 | automated | `options.reload` resolving `{ok:true, handedOff:true}` vs `{ok:false, reason:"x"}` vs `{ok:true}` | command-handler receives `/reload` | 0, 1 (`error`, message `x`), 1 (`completed`) `command_feedback` events respectively |

### Performance

_None._ The change has no latency, throughput or memory requirement beyond the bounded timeouts, which are covered as boundaries in X2/X4/X8.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Spec: terminal-hosted reload + repeated reloads | state-convergence | L3 | automated | docker harness, session spawned with `spawnStrategy: "tmux"`, idle, TUI never touched | send `/reload` from the composer, wait for its terminal pill; repeat a second time | after each: exactly one `/reload` completed pill (2 total), no user-message bubble containing `__dashboard_reload`, no new assistant turn, session pid unchanged, status converges to idle; no pill says "stale" |
| F2 | Spec: concurrent reload refused | state-convergence | L3 | automated | same tmux harness session, idle | send `/reload` twice back-to-back (second before the first pill resolves) | converges to exactly one completed pill + one error pill whose text contains "already in progress"; session reloaded once (one `session_start{reload}` worth of re-register); status idle |
| F3 | Spec: TUI reload still works (real terminal) | state-transition | — | manual-only | `pi` started directly in macOS Terminal/iTerm (not tmux, not dashboard-spawned) | dashboard `/reload` ×3, then type `/__dashboard_reload` in the TUI | [judgment: real-terminal TUI shows "Reloaded …" each time and dashboard one completed pill per dashboard reload; the TUI-typed one shows no dashboard pill. Real non-harness terminal host, not automatable in CI] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Spec: reload command never starts | fault-injection (abort) | L1 | automated | mocked `sendUserMessage` never invokes the handler; fake timers | advance 5000 ms, then invoke handler with the original token | outcome error containing "did not run"; slot deleted; the late handler calls `ctx.reload` 0 times |
| X2 | D4 start timeout boundary | BVA | L1 | automated | handler invoked at t = 4999 ms | advance to 5001 ms | no start-timeout error; slot `started` |
| X3 | Spec: pi refuses the reload | fault-injection (abort) | L1 | automated | `ctx.reload` resolves without any `session_start` (slot stays `started`) | handler completes | outcome error containing "pi did not reload"; slot deleted; no `completed` |
| X4 | Spec: reload does not finish in bounded time | fault-injection (delay) | L1 | automated | `ctx.reload` never settles; fake timers | advance to `armedAt` + 60000 ms; then B2 `session_start{reload}` | outcome error (timeout); slot `state:"expired"`; B2 emits no `completed` |
| X5 | D4 slow success | fault-injection (delay) | L1 | automated | B2 marks slot `delivered` at 59 s; `ctx.reload` resolves at 61 s | advance through 60 s finish timer | no error at 60 s; outcome `handedOff`; B1 emits 0 feedback; total `/reload` terminal feedback across B1+B2 = 1 |
| X6 | Spec: handing the command to pi throws synchronously | fault-injection (abort) | L1 | automated | `pi.sendUserMessage` throws `Error("stale")` synchronously | bridge `reload()` via command-handler | one `command_feedback` error with message containing "stale"; no exception escapes; slot deleted |
| X7 | Spec: pi fails the reload | fault-injection (abort) | L1 | automated | `ctx.reload` rejects `Error("boom")` | handler runs | outcome error containing "pi did not reload"; slot deleted; no `completed` |
| X8 | D5 server deadline boundary | BVA + fault-injection (delay) | L1 | automated | forwarded reload, bridge never reports; fake timers | advance to 74999 ms, then 75001 ms | no feedback at 74999; exactly one `emitCommandFeedback(…, "/reload", "error", /did not report completion/)` by 75001; watch removed |
| X9 | Spec: late bridge feedback after expiry dropped | fault-injection (delay) | L1 | automated | deadline expired (X8 state), no retry | bridge `/reload` completed feedback arrives at t = 80 s via `event_forward` | not inserted into the event store, not broadcast; expired mark cleared |
| X10 | Spec: retry after expiry not swallowed | state-transition | L1 | automated | deadline expired at 75 s | new `dispatchReload` at 76 s (forwarded), bridge completed at 78 s | second forward allowed (`"forwarded"`); the 78 s feedback persisted + broadcast once; no second deadline error by 160 s |
| X11 | Spec: feedback during replay window reaches client | fault-injection (race) | L1 | automated | session in `replayingSessions` and `skipReplayInsert`, live watch | bridge `/reload` terminal feedback via `event_forward` | feedback persisted + broadcast exactly once; watch cleared; other replayed events in the window still skipped |
| X12 | Base spec: enumerated fan-out + D5 | decision-table | L1 | automated | two terminal-hosted sessions, one with a live forwarded watch | settings-save fan-out calls `dispatchReload` for both | in-flight session → `"refused"` + one error feedback; other → `"forwarded"`; fan-out outcome counts include the refusal |

---

## Coverage summary

- Requirements covered: 2/2 modified requirements (Server-side reload dispatch; Reload feedback is truthful, singular, and keyed `/reload`), all 15 delta scenarios; unmodified base requirements touched by D5 (Enumerated reload trigger sources) via X12.
- Scenarios by class: edge 10 · perf 0 · frontend 3 · error 12
- Scenarios by level: L1 22 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

- none (L3 reuses the docker harness `spawnStrategy: "tmux"` path exercised by `tests/e2e/tmux-session-shutdown.spec.ts`; L1 uses vitest fake timers).
