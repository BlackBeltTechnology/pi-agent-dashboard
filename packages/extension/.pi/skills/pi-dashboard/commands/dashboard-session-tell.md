---
description: Send a prompt to another session. Usage /dashboard:session-tell <id-prefix> <text>
---
Use the pi-dashboard skill (see ../SKILL.md). Send a prompt to another session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts prompt <id-prefix> <text...>

The CLI resolves the id-prefix (first argument) to a full session id from the live snapshot and sends the typed `send_prompt` verb with the remaining text. Report success, or the error if no session matches the prefix.

Arguments (id-prefix then prompt text):
