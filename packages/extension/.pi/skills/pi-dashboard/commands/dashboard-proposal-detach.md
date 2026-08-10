---
description: Detach the OpenSpec change from a session. Usage /dashboard:proposal-detach <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Detach the OpenSpec change from a session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts proposal-detach <id-prefix>

The CLI resolves the id-prefix to a full session id from the live snapshot and sends the typed `detach_proposal` verb. Report the result, or the error if no session matches the prefix.

Argument (id-prefix):
