# DOX — packages/flows-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `flow-reducer.ts` | Flow event fold. Reads `nodeKind` at `flow_agent_started` (decided once; agent-card fallback), `typedOutputs`/`branch`/`outcome` at complete, code target from `data.target`, `cost` from `result.cost` (verbatim, undefined when absent; see change surface-flow-agent-cost). Pre-lists code/code-decision steps as pending cards. `flow_complete` non-success downgrades in-flight cards to error/hard. See change: rework-flows-plugin-for-new-pi-flows. |
| `reducer.ts` | Re-export barrel for `isFlowEvent`, `reduceFlowEvent`. Architect reducer exports REMOVED (flow-architect deleted upstream). See change: rework-flows-plugin-for-new-pi-flows. L1/L2 reducer coverage: `__tests__/flow-reducer-seed-on-start.test.ts` (missing-start -> null; start-then-progression advances status + agents to terminal) and `__tests__/flow-reducer-bridge-contract.test.ts` (CONTRACT-PINNED: event types read from the bridge `FLOW_EVENT_MAP` values, never hand-typed; core lifecycle reduces to terminal, reducer never throws on any mapped `flow_*`, passthrough leaves state unchanged). See change: add-flow-plugin-e2e-tests. |
