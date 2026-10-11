# DOX — packages/extension/src/bridge-handlers

Handler bodies extracted from `../bridge.ts`. One row per source file.
Rules: modules take one `BridgeInstance`; no module-level mutable state; never import `../bridge.ts` (guard `bridge-handlers-boundary.test.ts`).

| File | Purpose |
|------|---------|
| `dispatch.ts` | Inbound server→bridge WS dispatch. Exports `handleInboundMessage(inst, data)`. ~25 `msg.type` branches; unknown type falls through to `inst.commandHandler.handle`. Stale-listener guard first (`inst.isActive()`). See change: test-trust-audit. |
| `forwarders.ts` | pi event forwarders. Exports `registerEnrichedForwarders(inst)`, `registerPassThroughForwarders(inst)`. Owns `enrichedEventTypes` / `passThroughEventTypes`. `EVENT_BUS_MAP` + emit intercept stay in `bridge.ts`. See change: test-trust-audit. |
| `instance.ts` | `BridgeInstance` + `createInstance(pi, generation, shared, overrides?)` + `BridgeState`. `shared` = process-global state surviving reload; `isActive()` = `shared.generation === generation`. Closure fields typed present, assigned by `initBridge` as declarations run. See change: test-trust-audit. |
| `lifecycle.ts` | pi lifecycle handlers. Exports `registerSessionStart`, `registerTurnEnd`, `registerSessionShutdown`, `registerSessionInfoChanged`, `registerProjectTrust`. Owns `handleSessionChange`, `startGitPollTimer`, heartbeat/git-poll/process-scan constants. Each `register*` is called from `bridge.ts` at the original registration position (order is load-bearing). See change: test-trust-audit. |
| `ui-prompt-patch.ts` | Exports `patchUiForPromptBus(inst, ctx, promptBus)`. Captures original `ctx.ui` methods, registers TUI adapter (only when `ctx.hasUI`), patches select/input/confirm/editor/multiselect/batch/inputWithImages/notify onto the bus. Guard: `no-tui-multiselect-arm-regression.test.ts` scans `tui-prompt-adapter.ts`. See change: test-trust-audit. |
