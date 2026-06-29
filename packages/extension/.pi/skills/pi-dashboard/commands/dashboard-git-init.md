---
description: Initialise a git repo in a directory. Usage /dashboard:git-init [cwd]
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: POST /api/git/init with body {"cwd": "<cwd>"}. Default <cwd> to the current working directory if no argument is given. Report the result.

Optional argument (cwd):
