# DOX — packages/gmail-plugin/src/shared

Pure modules shared by server, bridge and client. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/endpoints.test.ts` | E28 — override honoured for `http://127.0.0.1:*`/`http://localhost:*` only; foreign/https/credentialed ignored with one non-echoing warning; unset → defaults. |
| `client-json.ts` | `validateClientJson(text\|object)` → `{ok,client:{clientId,clientSecret,projectId?}}` \| `{ok:false,error:{code,step}}`. Only `installed` accepted; `web`→`web_client` step 4; id must end `.apps.googleusercontent.com`; secret required. Used by wizard (instant) AND `PUT /client` (authoritative). |
| `endpoints.ts` | `resolveGoogleEndpoints(env,warn)` → `GoogleEndpoints{issuer,authorize,token,revoke,gmail,overridden}`. `PI_E2E_GOOGLE_BASE_URL` honoured ONLY for loopback http (design D8); else `GOOGLE_DEFAULTS` + warning that never echoes the value. |
| `flow-codes.ts` | `KNOWN_FLOW_CODES` — closed set of fixed sign-in flow codes; `knownFlowCode(code)` exact match → code \| null. Server failure-log allow-list + client error table. See change: improve-gmail-settings-ux. |
| `protocol.ts` | Lane contract. `PLUGIN_ID` `gmail`, `LEASE_TYPE` `gmail/lease`, `ACCOUNTS_TYPE` `gmail/accounts`. `LeaseReply` = exactly `{accessToken,expiresAt,email,tier}`; `AccountInfo` secret-free row. |
| `scopes.ts` | Levels (design D4). `Tier` readonly/draft/send, `Op` read/draft/send/modify/trash, `SCOPE`, `TIER_SCOPES`, `tierAllows`, `scopesCover` (implication `modify ⇒ readonly, compose`), `scopesCoverTier` (lower/same level needs no re-consent), `authScopeParam` (`openid email …`). |
