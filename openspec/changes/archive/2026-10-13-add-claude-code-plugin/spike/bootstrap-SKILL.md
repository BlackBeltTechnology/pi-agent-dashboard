---
name: pi-dashboard-bootstrap
description: Make sure the local pi-dashboard server is running before any pi-dashboard action. Use FIRST whenever the user mentions the pi dashboard, pi sessions or pi agents, or asks to start/open the dashboard; also when a dashboard call fails with "connection refused".
---

# Ensure the pi-dashboard server is running

Run exactly this, as ONE foreground Bash call (never run_in_background, never `&` — the script
starts the server detached itself and returns):

```bash
sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"
```

- Exit 0: the output contains `BASE=<url>`. Use that exact URL for every later dashboard call
  (shell variables do not survive between Bash calls — write the literal URL each time).
- Exit 2 (`SANDBOX`): tell the user this session runs in a sandbox, not on their computer, so it cannot
  start or reach pi-dashboard; they should use Claude Code on their machine. Do not try workarounds.
- Exit 1: show the error lines. A cold `npx` install needs Node >= 22.19 and a C++ toolchain (node-pty).

Then continue with the `pi-dashboard` skill. If a control call returns 401 / `local_proof_required`, ask
the user to run `pi-dashboard token create --label claude-code --tier control` and give you the token;
send it as `-H "Authorization: Bearer <token>"`. Never write the token to a file or echo it back.
