---
description: Rename a session. Usage /dashboard:session-rename <id-prefix> <name>
---
Use the pi-dashboard skill (see ../SKILL.md). Rename a session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts rename <id-prefix> <name...>

The CLI resolves the id-prefix (first argument) to a full session id and sends the typed `rename` verb with the remaining text as the new name. Report the result, or the error if no session matches the prefix.

Arguments (id-prefix then new name):
