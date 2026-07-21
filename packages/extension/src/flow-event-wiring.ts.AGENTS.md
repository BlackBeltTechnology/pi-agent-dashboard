# flow-event-wiring.ts — index

Register pi-flows + pi-subagents event listeners on `pi.events`. Exports `FLOW_EVENT_MAP`, `SUBAGENT_EVENT_MAP`, `registerFlowEventListeners`. Maps `flow:flow-started` etc. to dashboard protocol; re-sends commands/flows list on discovery; flow/agent output rides in event `data` verbatim.
