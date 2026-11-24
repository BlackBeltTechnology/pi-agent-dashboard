# DOX — packages/google-plugin/src/server

Server entry + store + client selection + sign-in + consent + leases + routes + legacy import. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/clients.test.ts` | Built-in availability per browser, selection order matrix (explicit > domain > built-in > `client_required`), refresh-client gating by switches. |
| `__tests__/connect.test.ts` | Real login flow against a fake Google: disclosure gate, built-in rules (`own_client_required`, `restricted_scope_remote`), union scopes + prompts, partial grants, `client_mismatch`/`account_mismatch`, narrower reply, consent in progress, return paths, disconnect, secrets never logged. |
| `__tests__/import.test.ts` | Legacy Gmail import: at-most-once, never overwrites, atomic on a full store, no marker when empty, skipped without a client. |
| `__tests__/index.test.ts` | Entry wiring: inactive without credentials, both lanes `hubLocalOnly`, only `google.connect` provided, manifest (priority 200, no `dependsOn`). |
| `__tests__/lease.test.ts` | Refusal order, built-in switches, refresh bound to the recorded client, single-flight, `invalid_grant`, re-auth wins, log shape. |
| `__tests__/pending-flows.test.ts` | One-shot state, expiry, abort, state shape (flow id + origin only). |
| `__tests__/routes.test.ts` | REST surface: state per browser, disclosure hub-local, client upload/patch/delete, accounts, callbacks without the network guard, picker token. |
| `__tests__/store.test.ts` | Named clients, domain uniqueness, `client_in_use`, account binding, aliases, capacity. |
| `clients.ts` | `builtinFor`, `selectClient` (D5), `clientForGrant` (recorded client id; `DEFAULT_CLIENTS=off` hard stop), `availability`. |
| `connect.ts` | `ConnectService`: `startConnect`, `changeProducts`, `signInAgain`, `deliver`, `disconnect`, disclosure. Server-side product/client rules; one `[google] signin client= path= products= result=` line per sign-in. |
| `google-oauth.ts` | `createGoogleLoginFlow` — loopback / paste / own-Web callback / return-page channels, PKCE, nonce, id_token claims, `email_verified`; fixed error codes; `revokeToken`. |
| `import.ts` | `createLegacyImporter` — `importLegacyGmail(snapshot)` for the `google.connect` service (D10). |
| `index.ts` | Server entry. No `ctx.credentials` → warn + inactive. Lanes `google/lease` + `google/accounts` (`hubLocalOnly`), `provide("google.connect")`, routes; base URL from optional `ctx.getDashboardBaseUrl`. |
| `lease.ts` | `createLeaseHandler` (D7): refusal order, 60 s refresh window, single-flight, `markReauthIf`/`storeTokensIf`. |
| `local-request.ts` | `isLocal(request)` over `shared/local.ts`. |
| `pending-flows.ts` | `PendingFlows` — one-shot 300 s pending sign-ins for callback paths; `state` = flow id (+ `~origin` on the return path). |
| `routes.ts` | `mountGoogleRoutes` under `/api/plugins/google/`: management routes behind `networkGuard` (tier `operate`), callbacks `oauth/callback` + `oauth/remote-callback` without it, rate-limited. |
| `store.ts` | `GoogleStore` over namespace `google`: `client:<id>`, `acct:<sub>`, `disclosure`, `imported:gmail`; atomic `update()`, `too_many_keys`, alias/domain uniqueness. |
