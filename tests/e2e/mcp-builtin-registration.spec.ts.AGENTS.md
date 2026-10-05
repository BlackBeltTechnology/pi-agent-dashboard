# mcp-builtin-registration.spec.ts — index

L3 (change: migrate-mcp-to-pi-builtin). Drives the dashboard's built-in-MCP registration end to end. X1: session env probe asserts `PI_DASHBOARD_MCP_TOKEN` is ABSENT from the pi process env (no subprocess leak). X2: `tool_search` then call `mcp__pi_dashboard__list_sessions` before and after `/api/restart` (re-mint re-registers; the stale token is dead, the fresh one works). Uses the `mcp-env-probe` + `mcp-dashboard-call` faux scenarios. See change: migrate-mcp-to-pi-builtin.
