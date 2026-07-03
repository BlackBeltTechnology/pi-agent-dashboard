# DOX — packages/flows-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `flow-reducer.ts` | Flow event fold. Reads `nodeKind` at `flow_agent_started` (decided once; agent-card fallback), `typedOutputs`/`branch`/`outcome` at complete, code target from `data.target`. Pre-lists code/code-decision steps as pending cards. `flow_complete` non-success downgrades in-flight cards to error/hard. See change: rework-flows-plugin-for-new-pi-flows. |
| `reducer.ts` | Re-export barrel for `isFlowEvent`, `reduceFlowEvent`. Architect reducer exports REMOVED (flow-architect deleted upstream). See change: rework-flows-plugin-for-new-pi-flows. |
