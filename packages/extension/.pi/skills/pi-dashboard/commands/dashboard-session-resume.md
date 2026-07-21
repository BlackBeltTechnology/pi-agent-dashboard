---
description: Resume a session (continue mode). Usage /dashboard:session-resume <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Resume a session (continue mode) over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts resume <id-prefix>

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `resume` verb. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
