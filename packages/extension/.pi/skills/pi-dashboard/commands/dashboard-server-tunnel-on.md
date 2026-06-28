---
description: Connect the public tunnel. Usage /dashboard:server-tunnel-on
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie. Resolve any <id-prefix> via GET /api/sessions, matching the first session whose id starts with the prefix.

Task: POST /api/tunnel-connect. Then GET /api/tunnel-status and report the public URL.
