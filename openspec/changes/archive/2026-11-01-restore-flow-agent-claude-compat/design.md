## Context

- pi-flows agents: `extensionFactories = [createGuardExtension(...), ...extraAgentExtensions]`, built into an in-memory `ResourceLoader` (`pi-flows/extensions/flow-engine/execution.ts:396-437`). `extraAgentExtensions` is fed by `pi.events.on("flow:register-agent-extension", ...)`, deduped by factory reference (`pi-flows/extensions/flow-engine/index.ts:340-362`).
- Flow agents run in the parent pi process. The dashboard extension mirrors the server-relayed switch into the process-global bridge state `process.__pi_dashboard_bridge__.claudeSubscriptionCompat` (`packages/extension/src/bridge-handlers/dispatch.ts`, `BRIDGE_KEY` at `packages/extension/src/bridge.ts:114`).
- `claudeCompatExtension(readSwitch)` lives in `packages/shared/src/dashboard-plugin/claude-compat.ts` and registers `before_agent_start` + `before_provider_request` on the pi it is applied to.
- Main sessions and `pi-dashboard-subagents` children already get the rewrite from the dashboard extension (they load the settings packages).

## Goals / Non-Goals

**Goals:** flow agents on `anthropic` get the rewrite while the switch is on; plugin-only change.

**Non-Goals:** a process-wide hook for any in-process spawner (rejected: global `fetch` or `ModelRuntime` patches); pi-flows changes; registering the rewrite on the parent session from the plugin (the dashboard extension already does).

## Decisions

### D1. Announce one stable factory from the flows-plugin bridge

Module-level `const factory = claudeCompatExtension(readSwitch)`; `activate` emits `flow:register-agent-extension {factory}` once and again on every parent `session_start`. Same reference each time, so pi-flows keeps one copy.

### D2. Read the switch from the process-global bridge state

`readSwitch = () => process.__pi_dashboard_bridge__?.claudeSubscriptionCompat === true`. No probe channel; absent bridge or value → off. The key is the dashboard extension's existing process-global contract.

## Risks / Trade-offs

- A future in-process spawner with its own loader is not covered; it would need its own hook → accepted for now.
- The process-global key is a cross-package string contract → pinned by the test reading the same key the extension writes.
