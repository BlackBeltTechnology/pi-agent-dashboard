# Spec Delta

## MODIFIED Requirements

### Requirement: Flow event wiring extraction
bridge.ts SHALL delegate generic bus-forwarding helpers to a `flow-event-wiring` module. The module SHALL hold only plugin-agnostic forwarding helpers; it SHALL NOT map any plugin channel (`subagents:*`, `flow:*`) and SHALL NOT listen to `flow:rediscover` or `flow:complete`.

NOTE: the scenario titles "Module holds only the subagent map and generic helpers" and "Flow events forwarded as protocol messages" are retained verbatim because a MODIFIED requirement cannot retire a scenario name; their bodies below are normative.

#### Scenario: Module holds only the subagent map and generic helpers
- **WHEN** `flow-event-wiring.ts` is imported
- **THEN** it SHALL export no channel rename map (no `SUBAGENT_EVENT_MAP`, no `FLOW_EVENT_MAP`)
- **AND** it SHALL NOT register any `flow:*` listener

#### Scenario: Flow events forwarded as protocol messages
- **WHEN** a subagent or flow event fires
- **THEN** it SHALL be forwarded only through its plugin's declared channels, never by `flow-event-wiring`

#### Scenario: Commands and flows re-sent on flow lifecycle
- **WHEN** any plugin emits `dashboard:commands-changed` (the flows plugin does so on `flow:rediscover` or `flow:complete`)
- **THEN** the bridge SHALL re-send `commands_list` only
