# live-server-routes.ts — index

Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF gate via manager `validateLiveTarget`; non-loopback→400; returns proxied `/live/<id>/` path), `GET /api/live-server/list`, `DELETE /api/live-server/:id`. See change: improve-content-editor.

`POST /api/live-server/:id/capability` mints a capability URL; flat `{success,path,expiresAt}`; `capabilityPrincipalOf` derives principal. `DELETE /api/live-server/:id` revokes target tokens. See change: retire-trusted-networks-bypass.

`start` takes `addedBy`/`sessionId` (preset = memory only). `POST /start-static {cwd,path}` → `{ok,id,entry,root}` via injected `staticGate` (raw-read gate; refusal = its status+body). `GET /policy` → `{exposure,epoch,promptingEnabled}`. Mint takes `{egress,scripts,runScripts,viewerId}` fail-closed, returns `tokenId`+`policy`; route tier observe, port target needs control in-handler (`portMintRefused`). `POST /:id/touch {tokenId}` minting principal only (observe tier). Deps: `exposure`, `promptingEnabled`, `staticGate`, `getTrustedNetworks`, `localTrust`, `log`. See change: improve-canvas-html-and-url-ux.

