---
description: Hide a session from the dashboard list. Usage /dashboard:session-hide <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Hide a session from the dashboard list over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts hide <id-prefix>

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `hide` verb. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
