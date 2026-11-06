---
description: Toggle autonomous mode for a session's flow. Usage /dashboard:flow-auto <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Toggle autonomous mode for a session's flow over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts flow <id-prefix> toggle_autonomous

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the flows plugin's `flow.toggle-autonomous` action. Report the new state, or the error if no session matches the prefix.

REST equivalent (full session id): `pi-dashboard api POST /api/plugins/flows/control --data '{"sessionId":"<full-id>","action":"flow.toggle-autonomous"}'`.

Argument (id-prefix):
