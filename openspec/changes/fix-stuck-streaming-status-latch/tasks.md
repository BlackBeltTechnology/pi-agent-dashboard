## 1. Reproduce the drop (systematic-debugging)

- [ ] 1.1 Reproduce a stuck `streaming` deterministically: start a turn, force-close the bridge WebSocket between `agent_start` and `agent_end`, and verify the session card stays `Thinking…` after reconnect — record the exact steps in the change notes so the fix can be shown to clear them
- [ ] 1.2 Confirm `getBridgeState().isAgentStreaming` is `false` in the stuck state (bridge log or a temporary diagnostic), verifying the bridge holds the truth the server is missing

## 2. Protocol (`packages/shared`)

- [ ] 2.1 Add optional `agentRunning?: boolean` to `SessionHeartbeatMessage` in `packages/shared/src/protocol.ts` (`type: "session_heartbeat"` at L248)
- [ ] 2.2 Test — heartbeat shape with and without the field (test-plan #E10, automated, L1). See `packages/shared/src/__tests__/protocol.test.ts`. Triple: a `SessionHeartbeatMessage` object without `agentRunning` (input) · type-check + protocol test (trigger) · validates unchanged, and the same object with `agentRunning: true` / `false` also validates (observable)

## 3. Server reconcile — pure function (`packages/server`)

Home: `packages/server/src/__tests__/event-status-extraction.test.ts` (the existing
suite for this module — extend it rather than adding a parallel file).

- [ ] 3.1 Test — streaming + not-running settles (test-plan #E1, automated, L1). Triple: session status `streaming` with `currentTool: "bash"` (input) · `reconcileAgentLiveness("streaming", false)` (trigger) · returns `{status:"idle", currentTool:null}` (observable)
- [ ] 3.2 Test — idle + running corrects to streaming without touching the tool (test-plan #E2, automated, L1). Triple: status `idle`, `currentTool: "bash"` (input) · `reconcileAgentLiveness("idle", true)` (trigger) · returns `{status:"streaming"}` with no `currentTool` key (observable)
- [ ] 3.3 Test — active + running corrects to streaming (test-plan #E3, automated, L1). Triple: status `active` (input) · `reconcileAgentLiveness("active", true)` (trigger) · returns `{status:"streaming"}` (observable)
- [ ] 3.4 Test — active + not-running is inert (test-plan #E4, automated, L1). Triple: status `active`, the routine post-register resting state (input) · `reconcileAgentLiveness("active", false)` (trigger) · returns `null` (observable)
- [ ] 3.5 Test — ended + running never resurrects (test-plan #E5, automated, L1). Triple: status `ended` (input) · `reconcileAgentLiveness("ended", true)` (trigger) · returns `null` (observable)
- [ ] 3.6 Test — ended + not-running is inert (test-plan #E6, automated, L1). Triple: status `ended` (input) · `reconcileAgentLiveness("ended", false)` (trigger) · returns `null` (observable)
- [ ] 3.7 Test — streaming + running is inert (test-plan #E7, automated, L1). Triple: status `streaming` (input) · `reconcileAgentLiveness("streaming", true)` (trigger) · returns `null` (observable)
- [ ] 3.8 Test — idle + not-running is inert (test-plan #E8, automated, L1). Triple: status `idle` (input) · `reconcileAgentLiveness("idle", false)` (trigger) · returns `null` (observable)
- [ ] 3.9 Implement `reconcileAgentLiveness(currentStatus, agentRunning)` in `packages/server/src/session/event-status-extraction.ts` as a separate exported pure function (design D2/D9) and verify 3.1–3.8 pass
- [ ] 3.10 Test — the event path is untouched (test-plan #E12, automated, L1). See the existing cases in `packages/server/src/__tests__/event-status-extraction.test.ts`. Triple: every event type the existing suite covers (input) · `extractSessionUpdates(event, hasPendingPrompt)` (trigger) · output identical to the pre-change baseline, no reconcile arm leaked into the event path (observable)

## 4. Server reconcile — wiring (`packages/server/src/event-wiring.ts`)

Home: a new `packages/server/src/__tests__/heartbeat-liveness-reconcile.test.ts`.
Harness exemplars: `packages/server/src/__tests__/unread-trigger-wiring.test.ts`
(wiring + unread assertions) and `packages/server/src/__tests__/heartbeat-ack.test.ts`
(driving a `session_heartbeat` through the gateway).

- [ ] 4.1 Add a `session_heartbeat` branch to the gateway event handler in `packages/server/src/event-wiring.ts` that calls `reconcileAgentLiveness` against the session's current status and, on a non-null result, applies `sessionManager.update` + `broadcastSessionUpdated` — honouring the replay and pending-prompt guards (design D10). No change is needed in `pi-gateway.ts`: `handleOwnedMessage` already fans every owned message to `onEvent`
- [ ] 4.2 Test — a latched session heals on one beat (test-plan #X2, automated, L1). Triple: server status `streaming`, `agent_end` dropped in transport, socket still OPEN (input) · next periodic beat carries `agentRunning: false` (trigger) · status transitions `streaming` → `idle` on that beat (observable)
- [ ] 4.3 Test — absent field changes nothing (test-plan #E9, automated, L1). Triple: `session_heartbeat` with `metrics` and no `agentRunning`, session status `streaming` (input) · wiring handles the beat (trigger) · no `status` update, no `session_updated` broadcast, status stays `streaming` (observable)
- [ ] 4.4 Test — reconcile is not an unread trigger (test-plan #F4, automated, L1). Triple: session `streaming`, `unread: false`, no browser viewing it (input) · reconcile corrects to `idle` (trigger) · `unread` stays `false` and `stampUnreadIfTriggered` was not called (observable)
- [ ] 4.5 Test — reconcile carries no run-boundary meaning (test-plan #F5, automated, L1). Triple: session `streaming` with a transcript (input) · reconcile corrects to `idle` (trigger) · no `agent_end` appended, auto-namer / follow-up drain / retry disposition not invoked, `lastSettledAt` unchanged (observable)
- [ ] 4.6 Test — suppressed during replay (test-plan #F2, automated, L1). See the replay-window convention at `event-wiring.ts:883`. Triple: `replayingSessions` contains the session id, status `streaming` (input) · beat with `agentRunning: false` (trigger) · no status update applied and no `session_updated` broadcast (observable)
- [ ] 4.7 Test — a live `ask_user` survives the correction (test-plan #E11, automated, L1). Triple: status `streaming`, `currentTool: "ask_user"`, one pending prompt request outstanding (input) · beat with `agentRunning: false` (trigger) · `status` becomes `idle`, `currentTool` remains `ask_user` (observable)
- [ ] 4.8 Test — a beat racing teardown does not resurrect (test-plan #X4, automated, L1). Triple: session already `ended`, one in-flight beat with `agentRunning: true` (input) · beat processed after teardown (trigger) · status stays `ended`, no `session_updated` broadcast (observable)
- [ ] 4.9 Test — the `→ streaming` arm leaves `currentTool` alone at the wiring level too (test-plan #E15, automated, L1). Triple: status `idle`, `currentTool: "bash"` stamped by a tool event that arrived after the lost `agent_start` (input) · beat with `agentRunning: true` (trigger) · `status` becomes `streaming`, `currentTool` still `bash` (observable)
- [ ] 4.10 Test — steady state emits no churn (test-plan #P1, automated, L1, perf-invariant). Triple: one `idle` session, 20 consecutive agreeing beats with `agentRunning: false` (workload) · `sessionManager.update` calls touching `status` == 0 AND `broadcastSessionUpdated` calls == 0 (metric + threshold) · over the 20 beats (window)

## 5. Observability (observability-instrumentation)

- [ ] 5.1 Log a correcting reconcile with sessionId + previous status + corrected status (design D6)
- [ ] 5.2 Test — the correcting reconcile logs (test-plan #E13, automated, L1). Triple: status `streaming`, captured logger (input) · beat with `agentRunning: false` (trigger) · one log line containing the session id, previous status `streaming`, corrected status `idle` (observable)
- [ ] 5.3 Test — the inert reconcile is silent (test-plan #E14, automated, L1). Triple: status `idle`, captured logger (input) · beat with `agentRunning: false` (trigger) · logger received nothing (observable)

## 6. Bridge (`packages/extension`)

- [ ] 6.1 Add `agentRunning: getBridgeState().isAgentStreaming` to the periodic heartbeat send at `packages/extension/src/bridge.ts:3439` (`HEARTBEAT_INTERVAL = 15_000`, L105)
- [ ] 6.2 Add an explicit post-flush hook in `packages/extension/src/connection.ts` — `onopen` calls `onReconnect()` BEFORE draining the buffer, so the heal must be ordered after the flush (design D8)
- [ ] 6.3 Add the idle half of the reconnect heal: when `isAgentStreaming === false`, send one `session_heartbeat` carrying `agentRunning: false` from the post-flush hook. Leave the existing synthetic `agent_start` branch at `bridge.ts:1480` untouched (design D7)
- [ ] 6.4 Test — the latch heals across a transient reconnect (test-plan #X1, automated, L1). See `packages/extension/src/__tests__/bridge-resume-disconnect.test.ts`. Triple: WebSocket force-closed between `agent_start` and `agent_end` so the `agent_end` never reaches the server (fault) · connection reopens, bridge is idle, heal fires post-flush (trigger) · server status transitions `streaming` → `idle` with no `session_register` involved, and no synthetic `agent_end` is emitted (observable)
- [ ] 6.5 Test — the buffered `agent_end` is not overtaken by the heal (test-plan #X3, automated, L1). See `packages/extension/src/__tests__/connection-dropped-frames.test.ts` for the buffer/flush harness. Triple: a real `agent_end` buffered in `ConnectionManager` during the drop (fault) · connection reopens, `onReconnect` runs, buffer flushes, heal sends from the post-flush hook (trigger) · the server observes `agent_end` BEFORE the heal beat and the session is still stamped unread (observable)
- [ ] 6.6 Test — a mid-turn reconnect still holds `streaming` (test-plan #F3, automated, L1). Triple: bridge with `isAgentStreaming === true` (input) · reconnect completes (trigger) · server status is `streaming`; the existing synthetic `agent_start` branch still fires (observable)
- [ ] 6.7 Test — a silent server force-closes even mid-turn (test-plan #X5, automated, L1). See `packages/extension/src/__tests__/connection.test.ts` for the watchdog harness (`WATCHDOG_CHECK_INTERVAL`/`DEFAULT_WATCHDOG_TIMEOUT`, `connection.ts:240-241`). Triple: server silent for 60 s, last heartbeat reported `agentRunning: true` (fault) · watchdog check fires (trigger) · connection force-closed and reconnect triggered — a running agent grants no extra grace (observable)
- [ ] 6.8 Test — an idle agent does not shorten the threshold (test-plan #X6, automated, L1). Triple: server last seen 30 s ago, last heartbeat reported `agentRunning: false` (fault) · watchdog check fires (trigger) · no action, connection stays open (observable)

## 7. End-to-end (`tests/e2e/`, docker harness)

Harness exemplar: `tests/e2e/bridge-contention-health.spec.ts` (drives the bridge
socket directly). Read the port from `.pi-test-harness.json` (`dashboardPort`) —
never hardcode `:18000`. Per test-plan → New infra needed, induce the loss by
driving a synthetic session over the bridge socket (register, `agent_start`, never
`agent_end`, then beat with `agentRunning: false`) rather than intercepting a real
pi turn.

- [ ] 7.1 Test — the stuck card self-heals in the rendered UI (test-plan #F1, automated, L3). Triple: dashboard showing a session card latched in `Thinking…` (server status `streaming`, bridge idle) (input) · bridge emits its next heartbeat with `agentRunning: false` (trigger) · the card converges to the idle rendering with no page reload and no session restart (observable)
- [ ] 7.2 Test — the heal is bounded by the heartbeat interval (test-plan #P2, automated, L3). Triple: a session latched into `streaming` on an open socket (workload) · card leaves `Thinking…` within `HEARTBEAT_INTERVAL` + 5 s slack = 20 s of the first post-drop beat (metric + threshold) · single observation (window)

## 8. Verification & landing

- [ ] 8.1 Re-run the 1.1 repro against the built change and verify the card returns to idle — both on reconnect AND on a socket that stays open
- [ ] 8.2 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify no regressions
- [ ] 8.3 Rebuild + restart per the `implement` skill (shared/server → `POST /api/restart`; extension → `npm run reload`)
- [ ] 8.4 Confirm on the live instance that status transitions look correct through a real multi-tool turn — no premature settle, no stuck `Thinking…`, no card flicker (test-plan #M1) (test-plan: manual-only)
- [ ] 8.5 Run `review-code` over the full diff (protocol + bridge + connection + server wiring) before commit
