## Context

See `proposal.md` — Why. The mechanics that constrain the design:

- `extractSessionUpdates` (`packages/server/src/session/event-status-extraction.ts:69`) is **pure** — no gateway, no session manager, no socket. A reconcile needs the session's *current* status, which the extractor does not have. So the comparison cannot live inside it as an ordinary event arm.
- `isUnreadTrigger` (same file, L219) classifies on a before/after snapshot, not on the event alone. Any `streaming → idle` edge it sees is an unread trigger. A reconcile that produces that edge through the normal path would falsely stamp unread.
- `session_heartbeat` already reaches `event-wiring.ts`: `pi-gateway.ts:878` calls `onEvent?.(...)` for **every** owned message, and `handleOwnedMessage` (L817) already resets the watchdog and writes `processMetrics` from it. There is an existing, per-session, periodic, already-wired carrier.
- `bridge.ts:1480` sends a synthetic `agent_start` on reconnect when `isAgentStreaming` — the positive half of the heal already exists and works.
- `event_forward` is fire-and-forget (no ack, no replay queue), so no amount of care at the send site makes an individual `agent_end` reliable. The fix has to be a *convergent* reconciler, not a delivery guarantee.

## Goals / Non-Goals

**Goals:**
- A session stuck in `streaming` self-heals within one heartbeat interval, on a socket that never closes as well as across a reconnect.
- The correction path is structurally incapable of firing run-boundary side effects (unread, auto-name, follow-up drain, retry disposition).
- Old bridge + new server, and new bridge + old server, both degrade to today's behaviour.

**Non-Goals:**
- Making `event_forward` reliable (acks, sequence numbers, replay queue). Out of scope; the reconciler makes delivery loss survivable instead.
- Removing the WS churn that raises the loss rate — separate change (proposal → Impact).
- Any client change. `StatusBar.tsx` / `session-status-visuals.ts` render whatever `status` says.

## Decisions

### D1 — One carrier: `agentRunning` on `session_heartbeat`, not a new message type

The heartbeat is already periodic, already per-session, already routed to `event-wiring.ts`, and already writes session state (`processMetrics`). Adding one optional boolean gets both healing modes for one field:

- **socket-never-closes loss** — the next beat corrects it (bounded by the heartbeat interval);
- **reconnect loss** — the bridge sends one immediate heartbeat right after the reconnect handshake, carrying `agentRunning: false` when idle.

*Alternative rejected:* a dedicated `agent_liveness` / `status_reconcile` message type. It buys nothing the heartbeat does not already carry, and adds a second protocol surface, a second gateway branch, and a second wiring branch for the same fact.

*Alternative rejected:* a server-side watchdog ("streaming for > N minutes with no events → idle"). It has no ground truth — a legitimately long `bash` (a 29-minute one was observed live while diagnosing this) is indistinguishable from a stuck latch by elapsed time alone. Guessing here trades a stuck-thinking bug for a false-settle bug, which is worse: a false settle drops the run's follow-up handling.

### D2 — The reconcile is a separate exported function, not a new arm in `extractSessionUpdates`

`extractSessionUpdates` stays pure and event-keyed. Add `reconcileAgentLiveness(currentStatus, agentRunning)` in the same module, returning a `Partial<Session>` or `null`. It compares two values and has no I/O — same purity contract, testable in isolation, and it cannot be reached by an event dispatch.

*Alternative rejected:* threading `currentStatus` into `extractSessionUpdates` as a second context input (as `hasPendingPrompt` already is). That would put the reconcile on the same code path as the event arms and re-open the unread question by construction. Keeping the function separate is what makes D3 free.

### D3 — Unread exemption by call path, not by flag

The reconcile branch in `event-wiring.ts` calls `sessionManager.update` + `broadcastSessionUpdated` **without** calling `stampUnreadIfTriggered` (`event-wiring.ts:632`). No `isUnreadTrigger` parameter, no "isReconcile" flag threaded through the classifier — the exemption is that the correction never enters the classifier at all.

The spec still states the exemption as a requirement (`event-status-extraction` → *Reconcile-driven settle is not unread*) so the behaviour is pinned by a test even if the call sites move.

*Alternative rejected:* a synthetic `agent_end` from the bridge. It rides the server's event path and therefore fires the **server-side** `agent_end` consumers in `event-wiring.ts`: `stampUnreadIfTriggered` (L632; `agent_end` + `streaming→idle` is a trigger), the completed-first card reordering, and the OpenSpec attach-proposal clearing. Three wrong side effects to fix one status field.

Precision on which consumers are where, since a wrong list makes the wrong fix look safe:

- The auto-session-namer and the retry-tracker are **bridge-side** `pi.on` intercepts (`bridge.ts:2083-2130`). A `connection.send`-level synthetic `agent_end` never re-enters them.
- `captureLifecycleTimestamp` (`embed-lifecycle/lifecycle-event-capture.ts:23-29`) maps `agent_start`→`lastRunStartedAt` and `agent_settled`→`lastSettledAt`; `agent_end` returns `null`. A synthetic `agent_end` would NOT stamp `lastSettledAt`.

So the blast radius is three subsystems, not five. Three is still three too many for a status correction.

### D4 — Reconcile is bidirectional but asymmetric in likelihood

`agentRunning: true` while status is `idle` or `active` also corrects (to `streaming`). This is the mirror of a lost `agent_start` and costs one extra comparison. It deliberately does **not** synthesize a run start: no `lastRunStartedAt` stamp, no unread, no naming.

"Status only" here means **`status` and nothing else** — unlike the `→ idle` direction, this arm does NOT touch `currentTool`. A tool event delivered after the lost `agent_start` may legitimately have stamped `currentTool` (e.g. `bash`); clearing it would erase live truth to fix a stale field. The two directions are asymmetric on purpose: `→ idle` clears `currentTool` because a not-running agent cannot be inside a tool; `→ streaming` leaves it because a running agent may well be.

`ended` is excluded from this arm entirely — see D9.

### D5 — Optionality is the compatibility story

`agentRunning?: boolean` on `SessionHeartbeatMessage`. Absent ⇒ no liveness truth ⇒ no reconcile ⇒ exactly today's behaviour. This covers old-bridge/new-server (field never sent) and new-bridge/old-server (field ignored by the schema's existing tolerance for unknown fields) without a capability flag or a version gate.

### D6 — The correcting reconcile logs; the inert one does not

A reconcile that changes status is proof a run-boundary event was lost in transport. It logs `sessionId`, previous status, corrected status. The steady-state case (agreement) is the overwhelming majority of beats and must stay silent or it would drown the log at the heartbeat rate. This log is the data source for the WS-churn follow-up change.

### D7 — The existing synthetic `agent_start` on reconnect stays

`bridge.ts:1480` is not removed — only an `else` is added. Removing it would change which path stamps `lastRunStartedAt` on reconnect (`captureLifecycleTimestamp`), which is unrelated to this bug. Surgical: add the missing half, leave the working half alone.

### D8 — The reconnect heal is sent AFTER the buffer flush, not from `onReconnect`

`connection.ts` `onopen` calls `this.onReconnect?.()` and only *then* drains the ring buffer of frames queued during the drop. A heal sent from inside `onReconnect` therefore **overtakes** any buffered real `agent_end`. The server would reconcile to `idle` first (side-effect-free, by D3), and the real `agent_end` would then arrive with `before.status === "idle"` — the `streaming→idle` edge `isUnreadTrigger` needs is gone, and the unread stripe is silently lost. That is a regression against today's behaviour, where the buffered `agent_end` replays and stamps correctly.

So: `connection.ts` gains an explicit post-flush hook, and the heal heartbeat is sent from there. Ordering is pinned by construction, not by comment.

The existing synthetic `agent_start` (D7) stays where it is — it asserts `streaming`, which cannot erase an unread edge, and moving it would change which path stamps `n` (run-start).

### D9 — The reconcile acts on the latch, not on the whole status domain

`status` is not a `streaming`/`idle` binary; `active` and `ended` are routine values (`register` unconditionally writes `active`). The reconcile is therefore defined over the full domain, deliberately narrow:

| current status | `agentRunning: false` | `agentRunning: true` |
|---|---|---|
| `streaming` | → `idle` (the fix) | inert |
| `idle` | inert | → `streaming` |
| `active` | **inert** — the routine post-register idle state; correcting it would churn every beat | → `streaming` |
| `ended` | inert | **inert** — terminal; a beat racing teardown must never resurrect a session |

The `ended` guard is the load-bearing one: without it, D4's "non-streaming + running → streaming" arm would revive an ended session on a late in-flight heartbeat.

### D10 — The reconcile obeys the two existing wiring conventions

The reconcile branch is a new writer on an established path, so it inherits that path's rules rather than inventing its own:

- **Replay window.** `event-wiring.ts` suppresses `session_updated` broadcasts while `replayingSessions.has(sessionId)` (L883) to avoid card flicker; status is accumulated from the replayed events during the window and broadcast at replay exit (`reconcileAndRecomputeOnReplayExit`, L703, additionally recomputes `currentTool` from the PromptBus). A 15 s beat can land inside a replay. The reconcile therefore does not run during replay at all — the accumulated replay result is better ground truth than one beat, and racing it would flicker the card.
- **Pending prompt.** `extractSessionUpdates` takes `hasPendingPrompt` precisely so a live `ask_user` is not erased (`event-wiring.ts:876`). The reconcile's `currentTool: null` respects the same gate: with a pending prompt request outstanding, status is corrected but `currentTool` is left alone.

(The pending-prompt case is believed unreachable in practice — `isAgentStreaming` stays `true` across an `ask_user` pause, cleared only by `agent_end`/`agent_settled` (`bridge.ts:2113,2121`) and `session_shutdown` (L3586), so the reconcile is inert there. The gate is defense-in-depth against that invariant changing, and costs one condition.)

## Risks / Trade-offs

- **A false `agentRunning: false` mid-turn would settle a live session.** → The value is read from `getBridgeState().isAgentStreaming`, the same source the mid-turn prompt queue and the retry aborter already trust for correctness decisions. If it were unreliable those features would already be broken. Verified by reproducing a real drop (kill the WS mid-turn) rather than by assumption — `systematic-debugging`.
- **Heal latency is bounded by the heartbeat interval, not instant.** → Accepted. A stuck card that clears in one interval is a different class of bug from one that needs a restart. The reconnect path covers the close-triggered case immediately.
- **The reconcile masks the underlying event loss.** → Mitigated by D6: every heal logs, so the follow-up change gets a loss-rate signal instead of silence.
- **A reconcile to `streaming` does not stamp `n` (run-start), so embed quiescence still sees the session at rest** (`isAtRest` = `lastSettledAt >= n`, `embed-lifecycle/quiescence.ts`), and the idle-reaper could reap it mid-turn. → Accepted, and **not introduced here**: this arm only fires when a real `agent_start` was lost, in which case `n` was never stamped either way. The reconcile corrects the card without making the reaper hazard worse. Stamping a synthetic `n` would be exactly the run-boundary side effect D3 forbids.
- **Two writers for `status` (event path + reconcile path).** → Both funnel through `sessionManager.update`, which is already the single mutation point; the reconcile only writes when it disagrees, so a steady session sees no extra writes and no extra broadcasts.

## Migration Plan

Additive protocol change, no data migration, no coordinated deploy. Server first is safe (it just never sees the field); bridge first is safe (an old server ignores it). Rollback = revert; nothing persists that a reverted build would misread.

Rebuild path per the `implement` skill: `packages/shared` + `packages/server` → `POST /api/restart`; `packages/extension` → `npm run reload`. Both are touched here, so: restart the server, then reload sessions.
