---
description: Fork a session into a new one. Usage /dashboard:session-fork <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Fork a session into a new one over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts resume <id-prefix> --fork

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `resume` verb in fork mode. Report the new session id, or the error if no session matches the prefix.

Argument (id-prefix):
