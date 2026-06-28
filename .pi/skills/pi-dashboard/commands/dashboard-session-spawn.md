---
description: Spawn a new session in a directory. Usage /dashboard:session-spawn [cwd]
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: POST /api/session/spawn with body {"cwd": "<cwd>"}. Default <cwd> to the current working directory if no argument is given. Report the new session id.

Optional argument (cwd):
