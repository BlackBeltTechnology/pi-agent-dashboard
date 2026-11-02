# Test Plan — restore-flow-agent-claude-compat

Stage: design   Generated: 2026-10-28

## Scenarios

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | compat: Flow agents receive the same rewrite | decision-table | L1 | automated | process-global `claudeSubscriptionCompat` ∈ {true, false, absent} × agent `ctx.model.provider` ∈ {anthropic, openai}; announced factory applied to a stub agent `pi` | agent `before_provider_request` with a payload whose `system` holds pi's docs block | rewritten only for (true, anthropic); otherwise `undefined`; the agent bus is never emitted on |
| F2 | compat: Factory survives a pi-flows re-seed | state-transition | L1 | automated | flows-plugin bridge activated on a stub parent `pi` | `session_start` fired 3 times | `flow:register-agent-extension` emitted 4 times with the same `factory` reference |
| M1 | compat: Flow agent on Anthropic (end to end) | manual | manual-only | switch on; run a flow with an `anthropic` agent step | the step's request succeeds on the subscription |
