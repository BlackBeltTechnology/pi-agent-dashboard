---
description: Hide a session from the dashboard list. Usage /dashboard:session-hide <id-prefix>
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: resolve the id-prefix, then POST /api/session/<full-id>/hide with body {}. Report the result.

Argument (id-prefix):
