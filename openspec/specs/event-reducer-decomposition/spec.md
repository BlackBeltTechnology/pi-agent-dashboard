# event-reducer-decomposition Specification

## Purpose

Extracts flow-event handling out of the client's main event reducer into its own reducer with co-located types, so flow state transitions can be reasoned about and tested without the surrounding session reducer.

## Requirements

### Requirement: Flow reducer types co-located
The flow-reducer module SHALL export FlowState, FlowAgentState, and related flow types alongside the reducer function.

#### Scenario: Flow types importable from flow-reducer
- **WHEN** a component needs FlowState or FlowAgentState types
- **THEN** they can be imported from the flow-reducer module
