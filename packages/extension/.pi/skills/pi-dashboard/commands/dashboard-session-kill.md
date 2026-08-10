---
description: Shut down (kill) a session. DESTRUCTIVE. Usage /dashboard:session-kill <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). This is DESTRUCTIVE — the session process is terminated. Confirm with the user first, then kill the session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts kill <id-prefix>

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed shutdown verb. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
