# live-server-routes.ts — index

Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF gate via manager `validateLiveTarget`; non-loopback→400; returns proxied `/live/<id>/` path), `GET /api/live-server/list`, `DELETE /api/live-server/:id`. See change: improve-content-editor.

`POST /api/live-server/:id/capability` mints a capability URL; flat `{success,path,expiresAt}`; `capabilityPrincipalOf` derives principal. `DELETE /api/live-server/:id` revokes target tokens. See change: retire-trusted-networks-bypass.

`start` takes `addedBy`/`sessionId` (preset = memory only). `POST /start-static {cwd,path}` → `{ok,id,entry,root}` via injected `staticGate` (raw-read gate; refusal = its status+body). `GET /policy` → `{exposure,epoch,promptingEnabled}`. Mint takes `{egress,scripts,runScripts,viewerId}` fail-closed, returns `tokenId`+`policy`; route tier observe, port target needs control in-handler (`portMintRefused`). `POST /:id/touch {tokenId}` minting principal only (observe tier). Deps: `exposure`, `promptingEnabled`, `staticGate`, `getTrustedNetworks`, `localTrust`, `log`. See change: improve-canvas-html-and-url-ux.


Egress routes (registered when deps `egress` is set; all flat `{success,ok}`; owner-only = token's minting principal, other principal 403, unknown token 404): `GET /:id/egress?token=<tokenId>` (control) → `{origins,scanIncomplete,rootAbsolute,runtimeChannel,promptingEnabled}`; `POST /:id/allow-once {tokenId,viewerId,origin}` (control; viewer must own the token; ungrantable/invalid → 400, logged `allow refused`; logs `allow-once`); `POST /:id/egress-grant-request {tokenId,origin}` (control; static + markup-detected + grantable only → `requestEgressGrant`; prompting off → 200 `{ok:false,reason:"prompting-disabled"}`; registry rate limit → 429 `rate-limited`). Deps `egress`, `requestEgressGrant`, `channelOf`. See change: improve-canvas-html-and-url-ux.

`StaticStartGate` failure gains optional `headers` (the 503 of an undecidable cwd admission carries `Retry-After: 1`). See change: core-file-cwd-admission.
