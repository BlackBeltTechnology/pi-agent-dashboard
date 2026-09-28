# bridge-contention-health.spec.ts — index

L3 (test-plan #F6). Asserts `/api/health` always carries `bridgeContentionCount` + `contendedSessionIds`, then provokes a refusal over the gateway port from `piGatewayPort` and polls the contended id appearing and clearing (no stuck badge); cumulative count never rolls back. See change: fix-duplicate-bridge-registration.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 contention health surface (test-plan #F6).
