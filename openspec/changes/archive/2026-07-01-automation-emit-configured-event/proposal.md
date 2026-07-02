## Why

An automation action can only seed a **text prompt** into its spawned run session (`buildPrompt` → `sendToSession`). The `register-plugin-automation-events` change specified a general `dispatch` handler, but it shipped as prompt-only. That forces event-driven capabilities to be faked as slash-command text:

- `flows.run` seeds `/<ns>:<name>` instead of emitting the `flow:run` event that pi-flows actually listens for.
- `flows.cancel` / `flows.resume` seed `/flows:cancel` / `/flows:resume` — commands that do not exist on the pi-flows side at all.

The natural primitive is: automation spawns a session, then **emits a configured event** into it. Plugins register which event their action emits. The transport already exists — the server relays control messages to a session and the in-session bridge re-emits them on `pi.events` (this is exactly how `abortSession` and the web UI's `flow_management` controls work). It was simply never exposed as a general, plugin-registerable capability.

## What Changes

- Add `emitEventToSession(sessionId, eventType, data?)` to `ServerPluginContext`, trust-gated like `spawnSession`/`abortSession`. It relays a `plugin_emit_event` control message to the session; the in-session bridge does `pi.events.emit(eventType, data)`. Decoupled: the host never enumerates event types — a plugin emits whatever it registered.
- The in-session bridge handles a new `plugin_emit_event` control message: emit `eventType` with `data` on `pi.events`.
- Generalize an action's dispatch: an `ActionRegistration` MAY declare `buildEvent(payload, automation) → { eventType, data? } | null` as an alternative to `buildPrompt`. On run-session register, the engine delivers the event (event actions) or seeds the prompt (prompt actions). `core.prompt` / `core.skill` keep `buildPrompt`.
- Run finalization is UNCHANGED — runs still close on `agent_end`. Any flow-specific completion signal is handled inside pi-flows, not the dashboard.
- The flows plugin registers `flows.run` only (emits `flow:run` with `{ flowName, task }`). `flows.resume` and `flows.cancel` are REMOVED — pi-flows exposes no run-scoped resume/cancel reachable by the dispatch path.

Scope: in-process dashboard plugins only, over the existing bridge control channel. No new run finalization or timeout mechanism; pi bridge extensions emitting arbitrary host actions remain out of scope.

## Capabilities

### Modified Capabilities
- `dashboard-plugin-loader`: `ServerPluginContext` gains `emitEventToSession`, trust-gated, relayed over the bridge.
- `bridge-extension`: handles the `plugin_emit_event` control message → in-session `pi.events.emit`.
- `automation-action-registry`: actions may dispatch by emitting a configured event (`buildEvent`) instead of seeding a prompt; finalization unchanged (`agent_end`).
- `automation-run-lifecycle`: on register, the engine delivers the action's dispatch (prompt seed OR configured event); finalization stays `agent_end`.
- `flows-plugin`: `flows.run` dispatches by emitting `flow:run`; `flows.resume`/`flows.cancel` removed.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts`: `EmitEventToSessionFn` + interface/deps/wiring.
- `packages/server/src/server.ts`: `emitEventToSession` host impl (trust gate → `plugin_emit_event`).
- `packages/extension/src/bridge.ts`: `plugin_emit_event` control handler.
- `packages/automation-plugin/src/server/action-registry.ts`: `buildEvent` on `ActionRegistration` (+ exactly-one-dispatch guard; `buildPrompt` optional).
- `packages/automation-plugin/src/server/engine.ts` + `index.ts`: dispatch union (prompt|event); event actions delivered via `emitEventToSession`; finalization unchanged.
- `packages/flows-plugin/src/server/automation-actions.ts`: `flows.run` event dispatch; drop `flows.resume`/`flows.cancel`.
- On-disk `automation.yaml`: unchanged.
