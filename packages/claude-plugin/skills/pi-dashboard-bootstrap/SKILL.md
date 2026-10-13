---
name: pi-dashboard-bootstrap
description: Make sure the local pi-dashboard server is running before any pi-dashboard action. Use FIRST whenever the user mentions the pi dashboard, pi sessions or pi agents, or asks to start or open the dashboard; also when a dashboard call fails with "connection refused".
---

# Ensure the pi-dashboard server is running

Run exactly this as ONE foreground Bash call with the tool timeout set to 600000 ms (600 s).
Never run it in the background and never add `&`: the script starts the server detached itself.

```bash
sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"
```

Shell variables do not survive between Bash calls. Write the literal `BASE` URL in every later call.
If the tool call itself times out, run the same command again: the script is idempotent and reports
`already-running` once the server is up.

Read the `STATUS=` line on stdout:

- `already-running` or `started` (exit 0): use the printed `BASE=<url>`. Continue with the
  `pi-dashboard-control` skill.
- `busy` (exit 3): something holds the port or a dashboard is still starting. Tell the user to
  retry in a minute; point to the server log path printed on stderr if it persists. Do not start another one.
- `recovery` (exit 3): the dashboard is in recovery mode. Tell the user; do not try to start it.
- `port-conflict` (exit 5): another program answers on the dashboard port. Tell the user to free
  the port or set `DASHBOARD_PORT`. Do not send any credentials to it.
- `sandbox` (exit 2): this session does not run on the user's computer, so it cannot start or reach
  pi-dashboard. Tell the user to use Claude Code on their own machine. Do not try workarounds.
- `not-installed` (exit 4): ask the user before installing, and wait for an explicit yes. Say that the
  install:
  - runs a global npm install of the latest release on the machine running this Claude session;
  - downloads about 1 GB and takes about a minute;
  - adds the `pi-dashboard` command and the pi bridge;
  - should be declined if this session runs in Cowork or on the web.

  Only after a yes, run the same command once more with `--install` appended.
- `failed` (exit 1): show the error lines from stderr. A first-run Electron app may need its setup
  wizard finished.
