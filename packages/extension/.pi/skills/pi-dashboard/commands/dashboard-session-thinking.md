---
description: Set a session's thinking level. Usage /dashboard:session-thinking <id-prefix> <level>
---
Use the pi-dashboard skill (see ../SKILL.md). Set a session's thinking level over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts thinking <id-prefix> <level>

Levels are off, low, medium, high. The CLI resolves the id-prefix to a full session id and sends the typed `set_thinking_level` verb. Report the result, or the error if no session matches the prefix.

Arguments (id-prefix then level):
