# subagent-inspector.spec.ts — index

L3 spec (change: add-flow-plugin-e2e-tests). Drives `[[faux:subagent-spawn]]` — parent emits an `Agent` tool call whose prompt carries `[[faux:plain-text]]`, so pi spawns a REAL subagent that resolves plain-text, replies once, completes (firing subagents:* lifecycle). Asserts the subagents-plugin inspector surface mounts (AgentToolRenderer shows the subagent description `faux subagent probe`) + the parent settles (`subagent spawn complete`). Needs PI_E2E_SEED=1.
