# route-tiers.ts — index

`ROUTE_TIERS`, `routeTier(method, pattern)`, `hasRouteTier`. ONE route→tier map for `/api/*`; unlisted → `operate` (fail closed). Read by the REST tier gate AND the MCP manifest's `rest` rows, so both agree. Adds `PATCH`/`DELETE /api/providers/:name` (`operate`) + `GET /api/provider-auth/catalogue-ready` (`observe`). See changes: expand-mcp-tiered-surface, redesign-providers-settings-page. Access prompts/YOLO/refusals: `GET /api/access/prompts` + `GET /api/access/yolo/roots` `observe`; `POST /api/access/prompts/:promptId`, `POST`/`DELETE /api/access/yolo`, `DELETE /api/access/refusals` `operate` (trust-widening like a grant write; MCP already denylists `/api/access/`). See change: add-access-grant-dialog (9.5). `/api/system-one/*` triaged (status reads observe; config/keys/eval/calibration/lifecycle operate). See change: add-system-one-registry.

`GET /api/pair/pending`, `POST /api/pair/approve-pending`, `POST /api/pair/deny` → `operate`. See change: add-pairing-approval-dialog.
`/api/plugins/gmail/*` (state, client, accounts, accounts/:sub, :sub/level, :sub/reauth) all `operate` — credential-bearing sign-in/level/revoke surface; MCP-denylisted. See change: add-gmail-plugin.

## electron-runtime-overlay-updates

`GET /api/runtime/status` observe; `POST /api/runtime/{source,update,activate,rollback}` operate. See change: electron-runtime-overlay-updates.

`GET /api/push/vapid-public-key` → `observe`; `GET/POST /api/push/register`, `DELETE /api/push/register/:tokenId`, `POST /api/push/test` → `operate`. See change: add-server-push-notifications.

Removes `GET /api/mcp-client/adapter`, `PUT /api/mcp-client/disabled`, `PUT /api/mcp-client/settings`; adds `GET /api/mcp-client/live` (operate), `PUT /api/mcp-client/servers/:name/enabled` (operate), `POST /api/mcp-client/servers/:name/convert` (operate). See change: migrate-mcp-to-pi-builtin. Adds `PUT /api/mcp-client/servers/:name/project-override` and `POST /api/mcp-client/servers/:name/convert-to-override` (both operate). See change: mcp-client-project-overrides.

KB routes (observe: GET /api/kb/search, GET /api/kb/sources; operate: POST /api/kb/source-trust). See change: improve-kb-settings-sources-and-search.

`/api/plugins/team/*` routes (19) tiered `operate`; MCP denylisted as per-user, owner-gated app API. See change: add-team-plugin.

## add-passkey-user-auth

Rows for `/api/users`, `/api/users/:id`, `/api/users/:id/revoke`, `/api/users/:id/invites`, `/api/users/invites/:inviteId`, `/api/users/credentials/impact` — all `operate`. See change: add-passkey-user-auth.

`/api/services/*` (17 routes): GETs `observe`; every mutation (POST/PUT/DELETE incl. ensure/heartbeat/release) `operate`; MCP denylisted. Route itself also refuses trusted-network + observe/control callers (`canMutateServices`). See change: add-service-registry-core.

`POST /api/browse/create-project` row, `control` (same tier as `/api/browse/mkdir`). See change: streamline-first-run.

`GET /api/provider-auth/legacy-provider-ids` → `operate` (names pi config files holding a renamed provider id; same tier as `/status`). See change: update-pi-core-1-1-adopt-apis.

- `/api/vault*` operate; `GET /api/session/:id/vault-bindings` observe. See change: add-credential-vault.
- `GET /api/folder/project` classified `observe`. See change: add-project-scoped-apps.

Row `GET /api/plugins/skill-atlas/graph` observe. See change: add-skill-atlas-screen.

`GET /api/vault/projects` → `operate` (project picker `{open,recent}`). See change: retro-ux-credential-vault.
`POST /api/pair/request` → `operate`. Public (unauthenticated) route, listed only so the tier-map completeness test stays exhaustive. See change: add-lan-knock-pairing.

`GET /api/questions`, `GET /api/questions/:id` → `observe`; `POST /api/questions/:id/answer` and `POST /api/questions/:id/summarize` → `control`. See change: add-pending-question-stack.

Rows `GET /api/plugins/obs-studio/{instances,:service/status}` → `observe`; `GET …/:service/screenshot`, `POST …/:service/{scene,virtualcam,record}` → `operate` (the plugin additionally requires `identity.hasOperateAuthority`). See change: add-obs-studio-plugin.

Services additions: `GET /api/services/:id/logs`, `POST /api/services/:id/reset-data`, `POST /api/services/prune` → tier operate (logs is a GET but returns process output). See change: add-services-settings-ui.

`POST /api/openspec/workflow-schema` → `control`. See change: add-pi-spec-driven-schema.
`POST /api/live-server/:id/capability` → `control` (mints a live-preview capability URL). See change: retire-trusted-networks-bypass.

`POST /api/tls/issue` → `operate` (TLS cert "issue now"; authorized like `PUT /api/config`). See change: add-tailscale-cert-tls.

`PUT`/`DELETE /api/tls/acme/:sourceId` and `PUT /api/tls/acme/:sourceId/credentials` → `operate` (acme cert source entry + vault-backed solver secrets). See change: add-acme-dns01-certs.

Adds `GET /api/file/digest` (observe). See change: gate-changed-on-disk-by-content.

`POST /api/file/write-binary` → `control`. See change: add-editor-pane-file-handlers.

`GET /api/plugins/craft-web/status` → `observe`; `POST /api/plugins/craft-web/prepare/:app` + `POST /api/plugins/craft-web/csp-report` → `control`. See change: edit-office-in-pane-with-craft-web.

`POST /api/plugins/craft-web/telemetry` control (open outcome / validator reject counters, log only). See change: extend-craft-web-to-all-apps.

`GET /api/access/provision`, `GET /api/access/provision/:id` → `observe`; `POST /api/access/provision`, `POST /api/access/provision/:id/settle`, `POST /api/access/provision/dismiss-all` → `operate` (settle + dismiss-all also need a live prompt capability, checked in the route). See change: add-access-provisioning.
improve-canvas-html-and-url-ux: `/api/live-server/:id/capability` now `observe` (port targets still need `control`, enforced in the handler); added `start-static`, `:id/touch`, `GET policy` as `observe`. `GET :id/egress`, `POST :id/allow-once`, `POST :id/egress-grant-request` are `control` (handler also requires the token's minting principal); `DELETE /api/access/preview-egress` is `operate`.

