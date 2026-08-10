---
description: Toggle autonomous mode for a session's flow. Usage /dashboard:flow-auto <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Toggle autonomous mode for a session's flow over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts flow <id-prefix> toggle_autonomous

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `flow_control` verb with action `toggle_autonomous`. Report the new state, or the error if no session matches the prefix.

Argument (id-prefix):
