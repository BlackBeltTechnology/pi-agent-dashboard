# DOX — packages/automation-plugin/src/shared

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `automation-types.ts` | Types: AutomationScope, Visibility, RunMode, Sandbox, Concurrency, AutomationTrigger, AutomationAction, AutomationConfig, DiscoveredAutomation, RunStatus, RunRecord. Adds TriggerCategoryDescriptor + TriggerEventDescriptor (read-only picker descriptors); AutomationTrigger.events?: string[]; AutomationConfig.disabled?: boolean. RunRecord gains optional findings?: number (top-level bullet count from result.md; 0 for auto-archived empty; absent on old records). See change: add-automation-plugin. See change: redesign-automation-editor-and-board. See change: automation-ui-mockup-parity. AutomationAction.kind widened to string + optional `payload`; adds `ActionDescriptor`/`ActionPayloadField` types. See change: register-plugin-automation-events. |
| `cron.ts` | Pure 5-field cron evaluator. `parseCron`, `nextFire`, `isValidCron`. No node deps. Moved from server/cron.ts so client editor + server scheduler share it. See change: redesign-automation-editor-and-board. |
