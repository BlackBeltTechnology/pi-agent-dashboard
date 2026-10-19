## Why

This change was drafted on 2026-05-05 against the bridge's `pi.events.emit` wrapper. That wrapper forwarded every emission, including RPC probes such as `emit("flow:list-flows", probe)` followed by a read of `probe.flows`. These probes leaked into the event store and showed up as `rawEvent` chat rows.

Change `fix-automation-run-lifecycle` (archived 2026-08-10) has since removed the wrapper. Forwarding now uses one `pi.events.on` subscription per declared channel (`packages/extension/src/flow-event-wiring.ts` `registerEventBusForwarding`). The live `catch-all-event-forwarding` requirement "EventBus forwarding via per-channel subscription" forbids wrapping emit, and it says that bridge-emitted control channels outside the mapping (such as `flow:list-flows`, `roles:*`, `ui:*`) are not forwarded. So the leak is fixed, and the original plan (a mutation-snapshot heuristic inside the emit wrapper) has nothing to hook into.

Two gaps remain:
1. **Nothing pins the fix down.** The existing suite (`packages/extension/src/__tests__/eventbus-foreign-emit-forwarding.test.ts`) covers forwarding, not-ready gating and throw safety, but nothing fails in two cases:
   - a probe channel becomes a core map key;
   - bridge code assigns `pi.events.emit` again (the historical wrapper form).
   The spec also never forbids mapping a probe channel.
2. **Stale wording.** Several things still describe the removed emit intercept: three requirements, three code comments, two AGENTS rows and one `docs/architecture.md` line. Two more requirements still claim the bridge forwards "all `flow:*`" events, which would include the `flow:list-flows` probe.

## What Changes

- **Rescoped to tests, comments, AGENTS rows and spec text.** No runtime behaviour change.
- Add `packages/extension/src/__tests__/eventbus-rpc-probe-not-forwarded.test.ts` (design D1) with three cases:
  - a static check that no known probe channel is in `forwardedBusChannels()`;
  - a two-facade round trip with a positive control;
  - a `readBridgeSource` source guard: no `events.emit` rebinding in bridge code; `registerEventBusForwarding` called once with two arguments (no `extraMaps`); and `bridge.ts` `EVENT_BUS_MAP` pinned to `{ ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP }`.
- Extract the two-facade host helpers into `__tests__/helpers/` and reuse them.
- Register the new guard in `source-guards-not-vacuous.test.ts`.
- Known probe channels:
  - `flow:list-flows`
  - `flow:get-agents`
  - `flow:get-available-models`
  - `model:resolve`
  - `role:resolve-model`
  - `roles:get-all`
  - `roles:set`
  - `roles:remove`
  - `roles:preset-load`
  - `roles:preset-save`
  - `roles:preset-delete`
  - `ui:list-modules`
- Spec changes:
  - Add the requirement "RPC probe channels are kept out of the core forwarding map".
  - Reword the three emit-intercept requirements, and rename "Event rename maps exported for intercept".
  - Narrow the two "all `flow:*`" requirements to the `FLOW_EVENT_MAP` channels, matching the live declared-set contract.
- Fix stale comments in `packages/extension/src/bridge.ts` (`EVENT_BUS_MAP` line), `packages/extension/src/flow-event-wiring.ts` (`FLOW_EVENT_MAP` NOTE) and `packages/extension/src/subagent-frame-buffer.ts` (header).
- Fix the stale rows in `packages/extension/src/bridge-handlers/AGENTS.md` and `packages/extension/src/bridge.ts.AGENTS.md`, and the `docs/architecture.md` "extension-ui-forwarding (catch-all `pi.events.emit` forwarding)" line (delegated to DocScribe).
- **Dropped from the original draft:** the snapshot/`equalSnapshot` helpers, the `listenerCount` fast-path, the async-dispatch warn-once, the `KNOWN_RPC_CHANNELS` handler lint, and the original draft's MODIFIED delta. That delta targeted a requirement titled "EventBus catch-all via emit intercept", which `fix-automation-run-lifecycle` replaced with "EventBus forwarding via per-channel subscription".

## Capabilities

### Modified Capabilities
- `catch-all-event-forwarding`: ADDED "RPC probe channels are kept out of the core forwarding map".
- `flow-event-bridge`:
  - RENAMED "Event rename maps exported for intercept" → "Event rename maps exported for forwarding" (+ MODIFIED body).
  - MODIFIED "Remove forwarding loops from flow-event-wiring" (wording).
  - MODIFIED "Bridge captures flow lifecycle events from pi.events" (correction: `FLOW_EVENT_MAP` channels, not all `flow:*`).
- `bridge-decomposition`: MODIFIED "Lifecycle handlers, event forwarders and inbound dispatch are importable" (wording).
- `bridge-extension`: MODIFIED "Bridge listens to flow events on pi.events" (correction: `FLOW_EVENT_MAP` channels, not every `flow:*` name).
- `subagent-live-detail-reliability`: MODIFIED "Subagent live frames buffered across a connection gap" (wording).

## Impact

- New: `packages/extension/src/__tests__/eventbus-rpc-probe-not-forwarded.test.ts`, plus `packages/extension/src/__tests__/helpers/event-bus-host.ts` (the extracted two-facade host).
- Edited tests: `eventbus-foreign-emit-forwarding.test.ts` (imports the extracted helper), `source-guards-not-vacuous.test.ts` (two `GUARDS` rows).
- Comment-only edits: `packages/extension/src/bridge.ts`, `packages/extension/src/flow-event-wiring.ts`, `packages/extension/src/subagent-frame-buffer.ts`.
- AGENTS rows:
  - `packages/extension/src/AGENTS.md`: new test row.
  - `packages/extension/src/__tests__/helpers/AGENTS.md`: helper row.
  - `packages/extension/src/bridge-handlers/AGENTS.md` and `packages/extension/src/bridge.ts.AGENTS.md`: stale wording.
- `docs/architecture.md`: one line.
- No protocol, server, client, config or data change. Nothing to migrate.
- **Rollback:** revert the commit.
- **Out of scope / residual risk:**
  - Plugin declarations naming a probe channel are not rejected. No in-repo declarer does this, and rejecting it needs probe-name knowledge in the bridge.
  - Probe channels not yet known are not detected.
  - Stale `## Purpose` prose (deltas cannot edit it).

## Discipline Skills

- None of the checkpoint skills apply. The change touches no auth, untrusted input, latency budget, new endpoint/job or irreversible step.
- `security-hardening` was considered for the residual plugin path and not triggered. A plugin declaring a probe channel such as `model:resolve` (whose `probe.auth` carries credentials) would forward it. But plugins run in-process with the same `pi` surface, so they can already read that data; declaring the channel grants nothing new. This change does not touch that path.
