## REMOVED Requirements

### Requirement: Flow state tracked in SessionState
**Reason**: Ownership transferred to the new `flows-plugin` capability. `SessionState.flowState` remains as a typed field on the central `SessionState` (per design.md Decision 1), and the runtime contract is unchanged, but the *requirement* that the core `event-reducer` capability owns the flow-state lifecycle moves with the code that implements it. The same requirement is re-stated under the `flows-plugin` capability.
**Migration**: No behavioral migration. Consumers continue to read `session.flowState` as before. Source-level: the type definition stays in `packages/shared/src/types.ts`, so no import paths change.

### Requirement: Reducer processes flow_started event
**Reason**: Implementation moved to `packages/flows-plugin/src/client/flow-reducer.ts`. `event-reducer.ts` continues to dispatch `flow_started` to the moved reducer, but the requirement is now owned by the `flows-plugin` capability spec.
**Migration**: None. Behavior preserved 1:1.

### Requirement: Reducer processes flow_agent_started event
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.

### Requirement: Reducer processes flow_agent_complete event
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.

### Requirement: Reducer processes flow tool call events
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.

### Requirement: Reducer processes flow_assistant_text and flow_thinking_text
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.

### Requirement: Reducer processes flow_loop_iteration event
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.

### Requirement: Reducer processes flow_complete event
**Reason**: Same as above — implementation owned by `flows-plugin`.
**Migration**: None.
