# Test Plan — fix-stuck-streaming-status-latch

Stage: design   Generated: 2025-06-10

No clarifications needed: every Triple slot resolved from the specs or from a
constant in source (`HEARTBEAT_INTERVAL = 15_000`, `bridge.ts:105`;
`WATCHDOG_CHECK_INTERVAL = 15_000` / `DEFAULT_WATCHDOG_TIMEOUT = 60_000`,
`connection.ts:240-241`).

---

## Scenarios

### Edge-case

Technique: decision table over the full `status` × `agentRunning` domain
(design D9). Every cell is enumerated — the `ended` and `active` cells are the
ones the first draft of the spec left undefined.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | reconcile semantics | decision-table | L1 | automated | session status `streaming`, `currentTool: "bash"` | `reconcileAgentLiveness("streaming", false)` | returns `{status:"idle", currentTool:null}` |
| E2 | reconcile semantics | decision-table | L1 | automated | status `idle`, `currentTool: "bash"` | `reconcileAgentLiveness("idle", true)` | returns `{status:"streaming"}`; `currentTool` key absent (unchanged) |
| E3 | reconcile semantics | decision-table | L1 | automated | status `active` (post-register resting state) | `reconcileAgentLiveness("active", true)` | returns `{status:"streaming"}` |
| E4 | reconcile semantics | decision-table | L1 | automated | status `active` | `reconcileAgentLiveness("active", false)` | returns `null` — no churn on every beat of every idle session |
| E5 | reconcile semantics (`ended` guard) | decision-table, illegal edge | L1 | automated | status `ended` | `reconcileAgentLiveness("ended", true)` | returns `null` — terminal session is never resurrected |
| E6 | reconcile semantics (`ended` guard) | decision-table, illegal edge | L1 | automated | status `ended` | `reconcileAgentLiveness("ended", false)` | returns `null` |
| E7 | reconcile agreement inert | decision-table | L1 | automated | status `streaming` | `reconcileAgentLiveness("streaming", true)` | returns `null` |
| E8 | reconcile agreement inert | decision-table | L1 | automated | status `idle` | `reconcileAgentLiveness("idle", false)` | returns `null` |
| E9 | absent liveness leaves behaviour unchanged | EP (valid/absent) | L1 | automated | `session_heartbeat` with `metrics` and NO `agentRunning`, session status `streaming` | wiring handles the beat | no `sessionManager.update` of `status`, no `session_updated` broadcast, status stays `streaming` |
| E10 | heartbeat field optional (old-bridge compat, D5) | EP | L1 | automated | `SessionHeartbeatMessage` object without `agentRunning` | type-check + `protocol.test.ts` | validates unchanged; `agentRunning` present as `true`/`false` also validates |
| E11 | pending prompt preserves `currentTool` (D10) | decision-table | L1 | automated | status `streaming`, `currentTool: "ask_user"`, one pending prompt request outstanding | beat with `agentRunning: false` | `status` becomes `idle`; `currentTool` remains `ask_user` |
| E12 | `extractSessionUpdates` unchanged | regression / EP over event types | L1 | automated | every event type the existing suite covers | `extractSessionUpdates(event, hasPendingPrompt)` | output identical to pre-change baseline — no reconcile arm leaked into the event path |
| E13 | correcting reconcile logs (D6) | state-transition | L1 | automated | status `streaming`, captured logger | beat with `agentRunning: false` | one log line containing the session id, previous status `streaming`, corrected status `idle` |
| E14 | inert reconcile is silent (D6) | state-transition | L1 | automated | status `idle`, captured logger | beat with `agentRunning: false` | logger received nothing |
| E15 | `→ streaming` arm preserves `currentTool` end-to-end | decision-table (wiring half of E2) | L1 | automated | status `idle`, `currentTool: "bash"` stamped by a tool event that arrived after the lost `agent_start` | beat with `agentRunning: true` | `status` becomes `streaming`; `currentTool` still `bash` after `sessionManager.update` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | steady-state emits no churn | invariant counting | L1 | automated | one `idle` session, 20 consecutive agreeing beats (`agentRunning: false`) | `sessionManager.update` calls touching `status` == 0 AND `broadcastSessionUpdated` calls == 0 | 20 beats |
| P2 | heal is bounded by the heartbeat interval | threshold | L3 | automated | a session latched into `streaming` on an open socket | card leaves `Thinking…` within `HEARTBEAT_INTERVAL` + 5 s slack (20 s) of the first post-drop beat | single observation |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | stale `streaming` self-heals | state-transition (convergence) | L3 | automated | dashboard showing a session card latched in `Thinking…` (server status `streaming`, bridge idle) | bridge emits its next heartbeat with `agentRunning: false` | card converges to the idle rendering; no page reload, no session restart, no `Thinking…` on re-render |
| F2 | reconcile suppressed during replay (D10) | state-transition (illegal edge) | L1 | automated | `replayingSessions` contains the session id, status `streaming` | beat with `agentRunning: false` | no status update applied and no `session_updated` broadcast — replay exit remains the single broadcaster |
| F3 | mid-turn reconnect holds `streaming` (D7) | state-transition (legal edge) | L1 | automated | bridge with `isAgentStreaming === true` | reconnect completes | server status is `streaming`; the existing synthetic `agent_start` branch still fires |
| F4 | reconcile is not an unread trigger (D3) | state-transition | L1 | automated | session `streaming`, `unread: false`, no browser viewing it | reconcile corrects to `idle` | `unread` stays `false`; `stampUnreadIfTriggered` was not called |
| F5 | reconcile carries no run-boundary meaning | state-transition | L1 | automated | session `streaming` with a transcript | reconcile corrects to `idle` | no `agent_end` appended to the transcript; auto-namer, follow-up drain and retry disposition not invoked; `lastSettledAt` unchanged |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | latch heals across a transient reconnect | fault-injection (abort) | L1 | automated | WebSocket force-closed between `agent_start` and `agent_end`, so the `agent_end` never reaches the server | connection reopens, bridge is idle, heal fires post-flush | server status transitions `streaming` → `idle`; no `session_register` was required to achieve it |
| X2 | latch heals on a socket that never closes | fault-injection (drop) | L1 | automated | `agent_end` dropped in transport, socket stays OPEN | next periodic beat carries `agentRunning: false` | server status transitions `streaming` → `idle` on that beat |
| X3 | buffered `agent_end` is not overtaken by the heal (D8) | fault-injection (abort) + ordering | L1 | automated | a real `agent_end` buffered in `ConnectionManager` during the drop | connection reopens; `onReconnect` runs, buffer flushes, heal is sent from the post-flush hook | server observes `agent_end` BEFORE the heal beat; the `streaming`→`idle` edge is seen by `isUnreadTrigger` and the session is stamped unread exactly as without this change |
| X4 | beat racing teardown does not resurrect (D9) | fault-injection (race) | L1 | automated | session already `ended`, one in-flight beat with `agentRunning: true` | beat is processed after teardown | status stays `ended`; no `session_updated` broadcast |
| X5 | watchdog timing unaffected by the new field | fault-injection (silence) | L1 | automated | server silent for 60 s, last heartbeat reported `agentRunning: true` | watchdog check fires | connection force-closed and reconnect triggered — a running agent grants no extra grace |
| X6 | watchdog does not shorten on idle | fault-injection (silence) | L1 | automated | server last seen 30 s ago, last heartbeat reported `agentRunning: false` | watchdog check fires | no action; connection stays open |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | live-instance sanity after rebuild | exploratory | — | manual-only | the running local dashboard after `POST /api/restart` + `npm run reload` | a human runs a real multi-tool turn in a live session | [judgment: status transitions look correct throughout the turn — no premature settle, no stuck `Thinking…`, no card flicker] |

---

## Coverage summary

- Requirements covered: 6/6 (reconcile semantics · reconcile observability · unread exemption · symmetric reconnect heal · heartbeat carries liveness · watchdog unaffected)
- Scenarios by class: edge 15 · perf 2 · frontend 5 · error 6 · manual 1
- Scenarios by level: L1 26 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 28 · manual-only 1

## New infra needed

- **F1 / P2 (L3)** need a way to induce a *lost* `agent_end` against the docker
  harness — the dashboard has no "drop this event" affordance today. Cheapest
  route that stays inside the existing harness: drive the bridge socket
  directly from the spec (register a synthetic session, send `agent_start`,
  never send `agent_end`, then beat with `agentRunning: false`) rather than
  intercepting a real pi turn. Read the harness port from
  `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.
- Everything else reuses existing tiers: `packages/server/src/session/__tests__/`,
  `packages/server/src/__tests__/` (wiring), `packages/extension/src/__tests__/`,
  `packages/shared/src/__tests__/protocol.test.ts`.
- No L2 (`qa/`) row: nothing here is install/spawn/multi-OS shaped.
