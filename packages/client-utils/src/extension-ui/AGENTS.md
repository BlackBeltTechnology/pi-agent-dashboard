# DOX — packages/client-utils/src/extension-ui

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `AgentMetricSlot.tsx` | Phase-2 `agent-metric` slot. Exports `AgentMetricSlot({ session, agentId })` — renders `kind: "agent-metric"` decorators matching `payload.agentId`, inside `FlowAgentCard`. Ignores unknown agentId. Uses `decoratorsOfKind`. |
| `BreadcrumbSlot.tsx` | Phase-2 `breadcrumb` slot. Exports `BreadcrumbSlot({ session })` — renders most-recently-cached `kind: "breadcrumb"` descriptor as step indicator at top of `FlowDashboard`. Last-write-wins on collision. Step status active/done/error/pending. Uses `decoratorsOfKind`. |
| `decorator-utils.ts` | Exports `decoratorsOfKind(decorators, kind)` — type-narrowing helper filtering `DashboardSession.uiDecorators` record by `DecoratorKind`. Shared by all Phase-2 decorator slot components (`AgentMetricSlot`, `BreadcrumbSlot`, `GateSlot`). |
| `GateSlot.tsx` | Phase-2 `gate` slot. Exports `GateSlot({ session, flowId })` + `aggregateGateState` pure helper. Most-restrictive-wins: any `available: false` for `flowId` blocks; reasons concatenated. Renders amber banner inside `FlowLaunchDialog`; `useGateState` disables Run button. |
