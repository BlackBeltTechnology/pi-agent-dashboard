## REMOVED Requirements

### Requirement: Bridge uses flow:list-flows for flow command detection

**Reason**: Core no longer queries pi-flows. pi-flows registers each discovered flow as its own slash command, so `/<flow-name> <task>` reaches pi-flows through the normal extension command routing.
**Migration**: None for users; typing `/<flow-name> <task>` still starts the flow.

## MODIFIED Requirements

### Requirement: Remove forwarding loops from flow-event-wiring
The `registerFlowEventListeners` function SHALL remove the `event_forward` sending loops for `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` channels. Event forwarding for these channels is handled by the bridge's per-channel EventBus subscriptions (see `catch-all-event-forwarding`).

The function SHALL retain one non-forwarding responsibility:
- Listening to `flow:rediscover` and `flow:complete` to resend `commands_list` (newly registered flow commands). It SHALL NOT send any flow list.

#### Scenario: No duplicate forwarding
- **WHEN** a `flow:flow-started` event is emitted on `pi.events`
- **THEN** only the per-channel EventBus subscription SHALL forward it (not the flow-event-wiring listener)

#### Scenario: Commands and flows refresh preserved
- **WHEN** `flow:rediscover` or `flow:complete` fires
- **THEN** `registerFlowEventListeners` SHALL still resend `commands_list`
- **AND** it SHALL NOT send a `flows_list` message
