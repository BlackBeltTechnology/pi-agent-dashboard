# streaming-latch-heal.spec.ts — index

L3 (change: fix-stuck-streaming-status-latch, test-plan #F1 + #P2). Induces the latch by driving the bridge socket directly (ticketed register → `agent_start`, never `agent_end`), asserts the card reaches `Thinking…`, then sends one `session_heartbeat{agentRunning:false}` and asserts the card leaves `Thinking…` for `Idle` within 20 s (HEARTBEAT_INTERVAL + 5 s slack) with no reload and no restart. Gateway port from `/api/health`, dashboard port from the harness fixtures — never hardcoded.
