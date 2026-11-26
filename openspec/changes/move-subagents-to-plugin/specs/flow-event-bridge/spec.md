# Spec Delta

## MODIFIED Requirements

### Requirement: Event rename maps exported for forwarding
`flow-event-wiring.ts` SHALL export no channel rename map: neither `SUBAGENT_EVENT_MAP` nor `FLOW_EVENT_MAP`. Subagent channels are declared by the subagents plugin bridge and flow channels by the flows plugin bridge, and the bridge's per-channel EventBus forwarding subscribes to them from those declarations.

NOTE: the scenario titles "Maps importable" are retained verbatim because a MODIFIED requirement cannot retire a scenario name; their bodies below are normative.

#### Scenario: Maps importable
- **WHEN** `bridge.ts` imports from `flow-event-wiring.ts`
- **THEN** no `SUBAGENT_EVENT_MAP` export SHALL exist
- **AND** no `FLOW_EVENT_MAP` export SHALL exist
