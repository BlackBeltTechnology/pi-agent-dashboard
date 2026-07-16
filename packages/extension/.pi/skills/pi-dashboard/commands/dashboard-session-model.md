---
description: Switch a session's model. Usage /dashboard:session-model <id-prefix> <provider/modelId>
---
Use the pi-dashboard skill (see ../SKILL.md). Switch a session's model over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts model <id-prefix> <provider> <modelId>

Split the `<provider/modelId>` argument on the first '/' into provider and modelId. The CLI resolves the id-prefix to a full session id and sends the typed `set_model` verb. Report the result, or the error if no session matches the prefix.

Arguments (id-prefix then provider/modelId):
