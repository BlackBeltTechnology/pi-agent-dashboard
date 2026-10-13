# mcp-client-project-override.spec.ts — index

L3 per-project overrides of Pi-global MCP servers on the folder page. Seeds a unique `/fixtures/e2e-mcp-*` folder (pinned, trusted via `trust.json`) and the container's global `mcp.json` through `docker exec`, restores the global file afterwards. F13: Enabled radiogroup moves Inherit → On on ArrowRight (focus follows). F14: 390x844 — panel is a bottom sheet (`data-sheet="bottom"`), badge has no inline action, Reset / Project settings live in the row menu, every action >= 44x44. F15: switching `docs` off writes exactly `{"mcpServers":{"docs":{"enabled":false}}}` in the folder file, leaves the global file byte-identical, and `pi mcp list --json` reports `docs` disabled.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 per-project MCP overrides (mcp-client-project-overrides).

See change: mcp-client-project-overrides.
