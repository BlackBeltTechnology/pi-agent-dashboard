## Context

- Dismiss path today: client `plugin_action flow.dismiss-summary` (`packages/flows-plugin/src/client/FlowDashboard.tsx:854`, `FlowSummary.tsx:346`) → server emits `flow:summary-dismissed {}` (`packages/flows-plugin/src/server/flow-control.ts:127`) → bridge forwards as `live("flow_summary_dismissed")` (`packages/flows-plugin/src/bridge/flow-event-forward.ts:44`) → reducer returns `null` (`packages/flows-plugin/src/flow-reducer.ts:724`) and `reduceFlowsSessionState` clears all `flowStates` (`packages/flows-plugin/src/client/FlowsSessionStateContext.tsx:124`).
- pi-flows persists only run events (`flow-event` entries, `FLOW_EVENT_NAME_MAP` in pi-flows `flow-persist.ts`); `flow:summary-dismissed` is not among them. Every event payload carries `runId` (pi-flows `flow-tui.ts:604`, `{ ...data, runId }`), persisted verbatim in record `data`.
- Core replay emits declared plugin records `{ seq, eventType, data }` as `event_forward`, sorted by `seq` across all declared types, after other events (`packages/shared/src/state-replay.ts:312-316`). Declared types are never forwarded live as `custom_entry`.
- Idle **Close** = `detach()` → `clearAttachment` (`FlowDashboard.tsx:812`); `resolveFlowSlot` then falls back to the last finished run (`packages/flows-plugin/src/client/flow-idle-state.ts:229-230`).

## Goals / Non-Goals

**Goals:** a dismissed run stays dismissed after any replay; Close over a finished run dismisses it; plugin-only.

**Non-Goals:** ended/disconnected sessions; pi-flows or core changes.

## Decisions

### D1 — Plugin-owned entry `flow-run-close`
The flows bridge listens to `flow:summary-dismissed` and, when `data.runId` is a non-empty string, calls `pi.appendEntry("flow-run-close", { seq, eventType: "flow_summary_dismissed", data: { runId } })`. Declared in manifest `replayEntryTypes` and `FLOW_REPLAY_ENTRY_TYPES`. Replay re-emits the same event type the live path forwards.
*Alt rejected:* appending to `flow-event` — pi-flows owns that type and its `seq`; collisions.
*Alt rejected:* pi-flows persists the dismiss — cross-repo (out of scope).

### D2 — Order-independent closed set
Replay sorts by `seq` across types, so a close record may sort before its run's events. The reducer does not rely on order: `reduceFlowsSessionState` collects `closedRunIds` from every `flow_summary_dismissed { runId }`, then after the loop drops each run whose `runId` is closed from `flowStates`, and nulls `flowState` if its `runId` is closed. `seq` for close records = `Date.now()` (monotonic enough; only used for sort).
A dismiss **without** `runId` keeps the current clear-all behaviour (legacy, live-only, never persisted).

### D3 — `runId` on `FlowState`
`flow_started` stores `data.runId` (string) on `FlowState.runId`; other events keep it. Client dismiss sends `payload: { runId }` when known.

### D4 — Server validates `runId`
`flow.dismiss-summary` accepts optional `payload.runId`: string, 1..128 chars; otherwise ignored (emit `{}` — legacy). Emits `flow:summary-dismissed { runId }`. Both entry points share `runFlowControl`: `plugin_action` passes `m.payload` (`packages/flows-plugin/src/server/index.ts:177-181`); the REST route `POST /api/plugins/flows/control` copies only whitelisted body keys (`packages/flows-plugin/src/server/flow-control.ts:192-194`) — add `runId` to that whitelist. Client `flowControl` (`FlowDashboard.tsx:809-810`) and `FlowSummaryClaim` (`FlowSummary.tsx:347`) send no `payload` today; they must.

### D5 — Close dismisses the run beneath
In `FlowDashboardClaim`, idle `onClose` = detach + (if the live fallback run exists, is not `running`, and has `runId`) send `flow.dismiss-summary { runId }`. Slot then resolves to `none`.

## Risks / Trade-offs

- [pi flush gate: custom entries written only after first assistant message] → a flow run already opened the gate (start marker), so a dismiss after a run persists.
- [Run without `runId` (pi-flows older than the `runId` stamp; installed 0.10.0 stamps it)] → dismiss stays live-only clear-all and the run CAN reappear on replay. Accepted limit.
- [pi flush gate closed (no assistant message in the session yet)] → `flow-run-close` buffered/dropped like any custom entry; same limit as `flow-event` (plugin-entry-replay "Declared entry replay covers only persisted entries"). Interactive sessions always have an assistant message.
- [Server `state-store.ts` also runs `reduceFlowEvent`] → not wired live today (`packages/flows-plugin/src/server/index.ts:211-218`); out of scope.
- [Duplicate close records] → set semantics, idempotent.

## Open Questions

- Ended sessions: keep unchanged for now; a localStorage fallback can follow if wanted.
