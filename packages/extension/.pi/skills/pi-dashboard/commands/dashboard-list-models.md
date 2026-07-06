---
description: List reachable models from the dashboard registry. Usage /dashboard:list-models [annotated]
---
Use the pi-dashboard skill (see ../SKILL.md). Discover the base URL: prefer the $PI_DASHBOARD_PORT or $DASHBOARD_PORT env var, else read the port from ~/.pi/dashboard/config.json (default 8000); BASE="http://localhost:$PORT". When auth is enabled, include the JWT cookie.

Task: GET $BASE/api/models. If the argument is `annotated` (or `1`), GET $BASE/api/models?annotated=1 instead. The response is `{ "object": "list", "data": [...] }` where each row is `{ id: "provider/modelId", provider, reasoning?, input?, contextWindow?, maxTokens?, cost? }`. In annotated mode each row also carries `excludedReason` (`null` = reachable, `no-credential` or `oauth-incompatible` = why it is not). Report the rows (id + provider + key capabilities; in annotated mode note the excludedReason for unreachable ones).

IMPORTANT: never parse ~/.pi/agent/providers.json or ~/.pi/agent/models.json for model inventory — those files hold roles/presets/custom entries, NOT the reachable catalogue, and a parse returns empty (silent failure). GET /api/models is the only correct model-introspection surface.

Arguments (optional `annotated`):
