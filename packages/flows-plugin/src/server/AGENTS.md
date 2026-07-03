# DOX — packages/flows-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `automation-actions.ts` | Flows→automation action registration. `discoverFlows(cwd)` scans `<cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml` → `<ns>:<name>`. `registerFlowAutomationActions` registers flows.run/resume/cancel, available=hasFlows(cwd), flows.run payload {flow enum, task multiline}, buildPrompt `/<ns>:<name> <task>`. `wireFlowAutomationActions(consume,...)` consumes `automation.action-registry` service, no-op when absent. See change: register-plugin-automation-events. `flows.run` emits `flow:run` event `{flowName,task}` via buildEvent (was slash-command prompt); `flows.resume`+`flows.cancel` removed. See change: automation-emit-configured-event. Rewritten as pure publisher: `flowsActionContributions()` + `provideFlowsActions(provide)` publish under `automation.action.flows`. Drops consume, registry, ACTION_REGISTRY_SERVICE. See change: decouple-automation-action-registry. |
| `index.ts` | registerPlugin calls wireFlowAutomationActions(ctx.consume,...). See change: register-plugin-automation-events. registerPlugin calls `provideFlowsActions(ctx.provide,…)` instead of `wireFlowAutomationActions(ctx.consume,…)`. See change: decouple-automation-action-registry. |
| `render-actions.ts` | Pure render fn for `SessionFlowActions` intent. Exports `RenderActionsInput`, `RenderedActionItem`, `renderSessionFlowActions`. Translates (flows, commands) into `ui:action-list` IntentNode; each item carries `dataAction` descriptor (`flow.run`/`flow.new`). Returns null when no flows and no `/flows:new`. |
| `state-store.ts` | Per-session server-side flow state holder. Exports `FlowsSessionServerState`, `stateStore` singleton. Holds `flows`, `commands`, `flowState`. Methods: `ensure`, `getState`, `applyEvent` (runs `reduceFlowEvent`), `setFlows`, `setCommands`, `clearSession`, `__resetForTests`. |
