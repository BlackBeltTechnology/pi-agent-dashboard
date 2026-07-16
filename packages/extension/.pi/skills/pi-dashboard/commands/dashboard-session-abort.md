---
description: Abort the current run of a session. Usage /dashboard:session-abort <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Abort a session's current run over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts abort <id-prefix>

The CLI resolves the id-prefix to a full session id from the live subscription snapshot and sends the typed `abort` verb. It discovers the port itself. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
