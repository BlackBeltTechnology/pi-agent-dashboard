---
description: Attach an OpenSpec change to a session. Usage /dashboard:proposal-attach <id-prefix> <change-name>
---
Use the pi-dashboard skill (see ../SKILL.md). Attach an OpenSpec change to a session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts proposal-attach <id-prefix> <change>

The CLI resolves the id-prefix (first argument) to a full session id and sends the typed `attach_proposal` verb with the change name. Report the result, or the error if no session matches the prefix.

Arguments (id-prefix then change-name):
