# DOX — packages/flows-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `flow-files-reporter.ts` | `collectFlowFiles` (`flow:list-flows` + `flow:get-agents` sources) + `startFlowFilesReporter`: debounced `requestPluginServer("flows","flow-files/report")` on `session_start`, `flow:(un)register-(flows|agents)-dir`, `flow:rediscover`, server ask `dashboard-flows:report-files`; retries unavailable lane. Never throws. See change: attach-flow-before-run. |
| `flow-question-adapter.ts` | PromptBus adapter claiming flow-tagged prompts for upper-slot render. Exports `FlowQuestionAdapter` implementing `PromptAdapter` (`name="flow-question"`, `priority=100`). `onRequest` returns claim with `component.type="flow-question"` + `placement="widget-bar"` only when `prompt.metadata.flowId` present; else null. `onResponse`/`onCancel` no-op. Structurally typed against `packages/extension/src/prompt-bus.ts` shapes. Beats `DashboardDefaultAdapter` (priority 9999). |
| `index.ts` | flows-plugin bridge entry. Default-export `activate(ctx)` emits `prompt:register-adapter` with fresh `FlowQuestionAdapter` via `pi.events.emit`. Auto-registered at `~/.pi/agent/settings.json#dashboardPluginBridges` (key `dashboard-flows`) by dashboard `registerAllPluginBridges`. Also starts `startFlowFilesReporter`. See change: attach-flow-before-run. |
