## Why

Every automation whose action is `flows.run` executes its flow successfully in ~2 s but its run record is never closed: it stays `status: "running"` until the stale-run reaper writes `error: "run exceeded max age"` ~30 min later (101 runs observed, 0 ever reached `done`). The proven cause is that the bridge's "EventBus catch-all" forwards nothing a foreign extension emits: `packages/extension/src/bridge.ts` monkey-patches `pi.events.emit`, but pi hands **each extension its own `events` surface** (`createExtensionAPI` → `events: { emit, on }` in `pi-coding-agent/dist/core/extensions/loader.js`), so pi-flows' `pi.events.emit("flow:complete", …)` never runs the wrapper. Live instrumentation of the running bridge proved it: for a real automation run the bridge's own `pi.events.on("flow:complete")` listener fired (`BUS-ON flow:complete`) while the patched `emit` was never entered for that channel — only channels the bridge itself emits (`flow:run`, `flow:list-flows`) passed through. Consequence beyond automation: **no live `flow_*` or `subagent_*` event has ever been forwarded**; the dashboard's flow cards are rebuilt only from pi-flows' persisted `custom/flow-event` JSONL via `packages/shared/src/state-replay.ts`.

The defect went undetected because the guard test (`packages/automation-plugin/src/__tests__/finalize-event-dispatched.test.ts`) re-implements the finalize branch inside the test file and fabricates the very event whose delivery fails — it passes 4/4 while production is 100 % broken. A contradicting spec base hid it too: `automation-action-registry` still says an event action's run finalizes on `agent_end` ("event actions add no new completion signal") while `automation-run-lifecycle` says it finalizes on its declared completion event.

## What Changes

- **Bridge forwarding (root cause).** Remove the `pi.events.emit` monkey-patch (and its restore on cleanup). Forward EventBus traffic from explicit per-channel `pi.events.on(channel, …)` subscriptions covering every `EVENT_BUS_MAP` key (flow + subagent + host-specific maps). `on()` demonstrably receives foreign-extension emits; `emit` interception cannot. **BREAKING (spec-level):** the wildcard "unknown channel forwarded by its own name" behaviour is no longer possible — pi's `EventBus` has no wildcard subscription (`dist/core/event-bus.js`), so the subscribed channel list becomes the forwarding contract.
- **Live flow/subagent forwarding becomes an explicit guarantee**, not an emergent side effect: a flow or subagent event emitted by another extension in a live session SHALL reach the server as an `event_forward` while the flow is still running, independent of JSONL replay.
- **Automation run finalization is restored end-to-end**: an event-dispatched `flows.run` run reaches `status: "done"` on the forwarded `flow_complete`, with the reaper left as a backstop that no longer fires for healthy runs.
- **Tests, test-first.** Add (a) an extension-level test that reproduces pi's real topology — one shared emitter, two independent `{emit,on}` facades — and emits `flow:complete` through the *foreign* facade, asserting a real `event_forward` leaves the bridge; (b) a server-level integration test that drives the real `registerPlugin` + the real flows action contribution and asserts on-disk `run.json` status. **Delete** `packages/automation-plugin/src/__tests__/finalize-event-dispatched.test.ts` and fold its four cases into (b).
- **Spec contradiction retired.** `automation-action-registry`'s `Scenario: Run finalization is unchanged` is removed and replaced by a pointer to `automation-run-lifecycle`, which stays the single source of truth for finalization.
- **Residual unknown discharged by execution**, not assumption: that per-channel `on()` also restores live subagent-frame forwarding (including the buffer/flush path) is currently code-read only and must be verified by running it.

## Capabilities

### New Capabilities

_None. The forwarding capability already exists (`catch-all-event-forwarding`); this change corrects its mechanism._

### Modified Capabilities

- `catch-all-event-forwarding`: the EventBus forwarding mechanism changes from `emit` interception to per-channel `pi.events.on` subscriptions; adds a live-delivery guarantee for foreign-extension flow/subagent events; removes the unknown-channel wildcard and the install-once/restore-emit requirements.
- `automation-action-registry`: removes the stale finalization scenario that contradicts `automation-run-lifecycle`.
- `automation-run-lifecycle`: adds that a healthy event-dispatched run SHALL finalize from the live forwarded completion event, with the max-age reaper as a backstop that SHALL NOT be the finalizing path for a run whose flow completed.

## Impact

- `packages/extension/src/bridge.ts` — remove the emit intercept + cleanup restore; wire per-channel subscriptions.
- `packages/extension/src/flow-event-wiring.ts` — natural home for the subscription loop; its comment currently defers to the broken intercept.
- `packages/automation-plugin/src/__tests__/finalize-event-dispatched.test.ts` — deleted (mirror test).
- New tests under `packages/extension/src/__tests__/` and `packages/automation-plugin/src/__tests__/`.
- `openspec/specs/automation-action-registry/spec.md`, `openspec/specs/catch-all-event-forwarding/spec.md`, `openspec/specs/automation-run-lifecycle/spec.md` (via deltas).
- Behavioural blast radius: every consumer of live flow/subagent events — flows plugin cards, subagents plugin live detail, automation finalization, and any plugin relying on custom-channel forwarding (the wildcard loss).
- No server, client, or shared protocol change; no data migration.

## Discipline Skills

- `systematic-debugging` — the root cause is already proven; the fix loop must stay evidence-first (watch each new test fail before it passes).
- `review-code` — non-trivial change to the single event path every plugin depends on.
- `observability-instrumentation` — the failure was silent for 101 runs; forwarding needs a diagnosable signal.
- `doubt-driven-review` — removing the wildcard catch-all is a hard-to-reverse contract narrowing.
