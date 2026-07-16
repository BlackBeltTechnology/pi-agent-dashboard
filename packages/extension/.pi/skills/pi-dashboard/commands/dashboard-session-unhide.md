---
description: Unhide a previously hidden session. Usage /dashboard:session-unhide <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Unhide a previously hidden session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts unhide <id-prefix>

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `unhide` verb. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
