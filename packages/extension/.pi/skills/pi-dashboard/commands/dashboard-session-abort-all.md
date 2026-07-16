---
description: Abort multiple running sessions (asks which). Usage /dashboard:session-abort-all
---
Use the pi-dashboard skill (see ../SKILL.md). List active sessions over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts sessions

This prints sessions from the live snapshot (status streaming or active). Confirm scope with the user (all of them, only those in the current cwd, or a named subset) BEFORE acting. Then abort each chosen session:

    npx tsx ./scripts/dashboard-bus.ts abort <id>

The CLI resolves each id-prefix to a full session id and sends the typed `abort` verb. Report per-session results.

Optional argument (a filter hint, e.g. 'here' or a cwd):
