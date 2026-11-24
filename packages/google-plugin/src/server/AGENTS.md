# DOX — packages/google-plugin/src/server

Server entry + store + client selection + sign-in + consent + leases + routes + legacy import. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/accounts-contract.test.ts` | A32 `client_in_use` on re-key/removal, A70 same email under two clients, A83 eight product keys + unknown key refused, B77/B78 legacy import faithful + byte-identical on re-run. |
| `__tests__/clients.test.ts` | Built-in availability per browser, selection order matrix (explicit > domain > built-in > `client_required`), refresh-client gating by switches. |
| `__tests__/connect.test.ts` | Real login flow against a fake Google: disclosure gate, built-in rules (`own_client_required`, `restricted_scope_remote`), union scopes + prompts, partial grants, `client_mismatch`/`account_mismatch`, narrower reply, consent in progress, return paths, disconnect, secrets never logged. |
| `__tests__/consent.test.ts` | Incremental consent (A84–A99): covered grant applies at once, union request, reply replaces the grant, narrower reply changes nothing, abandoned / wrong-account / concurrent consent; partial grants on a new connect (A101–A105). |
| `__tests__/import.test.ts` | Legacy Gmail import: at-most-once, never overwrites, atomic on a full store, no marker when empty, skipped without a client. |
| `__tests__/accounts-multi.test.ts` | Several accounts in one store (B106–B109), full store 255/256 keys and reconnect-allowed (B114–B117, G17), local-browser consent matrix (B118/B119/B121), disconnect sticks across restart + import (B122/B123). |
| `__tests__/index.test.ts` | Entry wiring: inactive without credentials, both lanes `hubLocalOnly`, only `google.connect` provided, manifest (priority 200, no `dependsOn`). |
| `__tests__/lease-contract.test.ts` | A79–A82 per-product/level refusals, B1/B2 secret-free replies, B3 both lanes through the REAL host lane for hub-local/paired/remote sessions, B4–B9 single-flight per account, `invalid_grant`, transient 5xx, no resurrection after disconnect. |
| `__tests__/lease.test.ts` | Refusal order, built-in switches, refresh bound to the recorded client, single-flight, `invalid_grant`, re-auth wins, log shape. |
| `__tests__/pending-flows.test.ts` | One-shot state, expiry, abort, state shape (flow id + origin only). |
| `__tests__/routes-connect.test.ts` | REST connect surface: no secret field in any response (B89), email rules incl. 253/254/255 and login_hint encoding (B110–B113, GB16), tunnel request counts as remote (B119), 300 s flow expiry, own-client no-disclosure, pasted denial → `access_denied`, Drive needs an own client (C41). |
| `__tests__/routes-contract.test.ts` | A24 base precedence, A37 setup entry per browser, A38–A40 project-id warning + eight-API links, B15 local-browser matrix, B34–B37/B47 callbacks only for own live flows, B51–B60 disclosure gate over HTTP, B71–B76 disconnect. |
| `__tests__/routes.test.ts` | REST surface: state per browser, disclosure hub-local, client upload/patch/delete, accounts, callbacks without the network guard, picker token. |
| `__tests__/signin-logs.test.ts` | Ported from gmail: E8 parallel adds, E29 secret-free logs, X1–X5 one input-free warn per failed sign-in, `start_timeout`. |
| `__tests__/signin.test.ts` | Real login flow vs fake Google: E10 `login_hint`, A53/A58/A68/A69, A75–A78 no silent client switch, B10–B13 PKCE/state/nonce/`email_verified`, B17 paste refusals, B18–B20 return page + availability matrix, B23, B38/B40 no restricted scope remote, B46. |
| `__tests__/store.test.ts` | Named clients, domain uniqueness, `client_in_use`, account binding, aliases, capacity. |
| `clients.ts` | `builtinFor`, `selectClient` (D5), `clientForGrant` (recorded client id; `DEFAULT_CLIENTS=off` hard stop), `availability`. |
| `connect.ts` | `ConnectService`: `startConnect`, `changeProducts`, `signInAgain`, `deliver`, `disconnect`, disclosure. Server-side product/client rules; one `[google] signin client= path= products= result=` line per sign-in. |
| `google-oauth.ts` | `createGoogleLoginFlow` — loopback / paste / own-Web callback / return-page channels, PKCE, nonce, id_token claims, `email_verified`; fixed error codes; `revokeToken`. |
| `import.ts` | `createLegacyImporter` — `importLegacyGmail(snapshot)` for the `google.connect` service (D10). |
| `index.ts` | Server entry. No `ctx.credentials` → warn + inactive. Lanes `google/lease` + `google/accounts` (`hubLocalOnly`), `provide("google.connect")`, routes; base URL from optional `ctx.getDashboardBaseUrl`. |
| `lease.ts` | `createLeaseHandler` (D7): refusal order, 60 s refresh window, single-flight, `markReauthIf`/`storeTokensIf`. |
| `local-request.ts` | `isLocal(request)` over `shared/local.ts`. |
| `pending-flows.ts` | `PendingFlows` — one-shot 300 s pending sign-ins for callback paths; `state` = flow id (+ `~origin` on the return path). |
| `routes.ts` | `mountGoogleRoutes` under `/api/plugins/google/`: management routes behind `networkGuard` (tier `operate`), callbacks `oauth/callback` + `oauth/remote-callback` without it, rate-limited.; `PUT /clients` echoes `projectMismatch` when the body's `expectedProjectId` differs from the JSON's project. |
| `store.ts` | `GoogleStore` over namespace `google`: `client:<id>`, `acct:<sub>`, `disclosure`, `imported:gmail`; atomic `update()`, `too_many_keys`, alias/domain uniqueness. |
