---
description: Send a prompt to another session. Usage /dashboard:session-tell <id-prefix> <text>
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: resolve the id-prefix (first argument), then POST /api/session/<full-id>/prompt with body {"text": "<remaining text>"}. Report success, or the HTTP error (404 not found, 502 no bridge connection).

Arguments (id-prefix then prompt text):
