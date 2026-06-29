---
description: Abort multiple running sessions (asks which). Usage /dashboard:session-abort-all
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: GET /api/sessions and list those with status streaming or active. Confirm scope with the user (all of them, only those in the current cwd, or a named subset) BEFORE acting. Then POST /api/session/<id>/abort for each chosen session. Report per-session results.

Optional argument (a filter hint, e.g. 'here' or a cwd):
