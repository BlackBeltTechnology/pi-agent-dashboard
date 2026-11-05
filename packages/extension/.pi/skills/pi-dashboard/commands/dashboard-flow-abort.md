---
description: Abort the running flow on a session. Usage /dashboard:flow-abort <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Abort the running flow on a session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts flow <id-prefix> abort

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the flows plugin's `flow.abort` action. Report the result, or the error if no session matches the prefix.

REST equivalent (full session id): `pi-dashboard api POST /api/plugins/flows/control --data '{"sessionId":"<full-id>","action":"flow.abort"}'`.

Argument (id-prefix):
