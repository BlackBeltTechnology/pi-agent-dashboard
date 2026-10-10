# route-tiers.ts — index

`ROUTE_TIERS`, `routeTier(method, pattern)`, `hasRouteTier`. ONE route→tier map for `/api/*`; unlisted → `operate` (fail closed). Read by the REST tier gate AND the MCP manifest's `rest` rows, so both agree. Adds `PATCH`/`DELETE /api/providers/:name` (`operate`) + `GET /api/provider-auth/catalogue-ready` (`observe`). See changes: expand-mcp-tiered-surface, redesign-providers-settings-page. Access prompts/YOLO/refusals: `GET /api/access/prompts` + `GET /api/access/yolo/roots` `observe`; `POST /api/access/prompts/:promptId`, `POST`/`DELETE /api/access/yolo`, `DELETE /api/access/refusals` `operate` (trust-widening like a grant write; MCP already denylists `/api/access/`). See change: add-access-grant-dialog (9.5). `/api/system-one/*` triaged (status reads observe; config/keys/eval/calibration/lifecycle operate). See change: add-system-one-registry.

`GET /api/pair/pending`, `POST /api/pair/approve-pending`, `POST /api/pair/deny` → `operate`. See change: add-pairing-approval-dialog.
`/api/plugins/gmail/*` (state, client, accounts, accounts/:sub, :sub/level, :sub/reauth) all `operate` — credential-bearing sign-in/level/revoke surface; MCP-denylisted. See change: add-gmail-plugin.

## electron-runtime-overlay-updates

`GET /api/runtime/status` observe; `POST /api/runtime/{source,update,activate,rollback}` operate. See change: electron-runtime-overlay-updates.

`GET /api/push/vapid-public-key` → `observe`; `GET/POST /api/push/register`, `DELETE /api/push/register/:tokenId`, `POST /api/push/test` → `operate`. See change: add-server-push-notifications.

Removes `GET /api/mcp-client/adapter`, `PUT /api/mcp-client/disabled`, `PUT /api/mcp-client/settings`; adds `GET /api/mcp-client/live` (operate), `PUT /api/mcp-client/servers/:name/enabled` (operate), `POST /api/mcp-client/servers/:name/convert` (operate). See change: migrate-mcp-to-pi-builtin.

KB routes (observe: GET /api/kb/search, GET /api/kb/sources; operate: POST /api/kb/source-trust). See change: improve-kb-settings-sources-and-search.

`/api/plugins/team/*` routes (19) tiered `operate`; MCP denylisted as per-user, owner-gated app API. See change: add-team-plugin.

`/api/services/*` (17 routes): GETs `observe`; every mutation (POST/PUT/DELETE incl. ensure/heartbeat/release) `operate`; MCP denylisted. Route itself also refuses trusted-network + observe/control callers (`canMutateServices`). See change: add-service-registry-core.
