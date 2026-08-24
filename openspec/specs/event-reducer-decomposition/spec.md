# event-reducer-decomposition Specification

## Purpose

Extracts flow-event handling out of the client's main event reducer into its own reducer with co-located types, so flow state transitions can be reasoned about and tested without the surrounding session reducer.

## Requirements

### Requirement: Flow reducer extraction
event-reducer.ts SHALL delegate flow state machine logic (flow_started, flow_agent_started, flow_agent_complete, flow_tool_call, flow_tool_result, flow_assistant_text, flow_thinking_text, flow_loop_iteration, flow_auto_decision, flow_complete) to a `flow-reducer` module.

#### Scenario: Flow events processed by flow reducer
- **WHEN** an event with a flow-related eventType arrives
- **THEN** the main reducer delegates to flow-reducer which returns updated FlowState

#### Scenario: Non-flow events bypass flow reducer
- **WHEN** an event with a non-flow eventType arrives (e.g., message_start, tool_execution_start)
- **THEN** the main reducer processes it directly without calling flow-reducer

### Requirement: Flow reducer types co-located
The flow-reducer module SHALL export FlowState, FlowAgentState, and related flow types alongside the reducer function.

#### Scenario: Flow types importable from flow-reducer
- **WHEN** a component needs FlowState or FlowAgentState types
- **THEN** they can be imported from the flow-reducer module
