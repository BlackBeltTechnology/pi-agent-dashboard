# DOX — packages/gmail-plugin/src/shared

Pure modules shared by server, bridge and client. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/endpoints.test.ts` | E28 — override honoured for `http://127.0.0.1:*`/`http://localhost:*` only; foreign/https/credentialed ignored with one non-echoing warning; unset → defaults. |
| `__tests__/scopes.test.ts` | E16 — filter ops × tiers × grants; `authScopeParam` adds `settings.basic` only with `{filters:true}`. See change: improve-gmail-plugin-setup-ux. |
| `__tests__/setup.test.ts` | E1 `classifyProjectId` vectors, E2 31-char JSON id → absent, E5 owner email normalize/validate. See change: improve-gmail-plugin-setup-ux. |
| `auto-setup.ts` | Automatic-setup wire types: `SETUP_STEP_IDS`, `WIZARD_STEP_OF` (project,api→1; branding→2; publish→3; client,capture→4), `SetupRunState/View` (secret-free, no instance id; `handoff.domains` for `domain_blocked`; `audience`), `AutoSetupState` (`runId` with `run_active`), `HandoffReason`, `SetupDecision`, `SetupRunRequest`, `SetupContinueRequest`, `DEFAULT_PUBLISH_LINKS`. Types + constants only. See change: add-gmail-auto-setup. |
| `client-json.ts` | `validateClientJson(text\|object)` → `{ok,client:{clientId,clientSecret,projectId?}}` \| `{ok:false,error:{code,step}}`. Only `installed` accepted; `web`→`web_client` step 4; id must end `.apps.googleusercontent.com`; secret required. Used by wizard (instant) AND `PUT /client` (authoritative). `project_id` kept only when it passes shared `PROJECT_ID_RE` (else absent). See change: improve-gmail-plugin-setup-ux. |
| `endpoints.ts` | `resolveGoogleEndpoints(env,warn)` → `GoogleEndpoints{issuer,authorize,token,revoke,gmail,overridden}`. `PI_E2E_GOOGLE_BASE_URL` honoured ONLY for loopback http (design D8); else `GOOGLE_DEFAULTS` + warning that never echoes the value. |
| `flow-codes.ts` | `KNOWN_FLOW_CODES` — closed set of fixed sign-in flow codes; `knownFlowCode(code)` exact match → code \| null. Server failure-log allow-list + client error table. See change: improve-gmail-settings-ux. |
| `protocol.ts` | Lane contract. `PLUGIN_ID` `gmail`, `LEASE_TYPE` `gmail/lease`, `ACCOUNTS_TYPE` `gmail/accounts`. `LeaseReply` = exactly `{accessToken,expiresAt,email,tier}`; `AccountInfo` secret-free row. `AccountInfo.filters?`. See change: improve-gmail-plugin-setup-ux. |
| `scopes.ts` | Levels (design D4). `Tier` readonly/draft/send, `Op` read/draft/send/modify/trash, `SCOPE`, `TIER_SCOPES`, `tierAllows`, `scopesCover` (implication `modify ⇒ readonly, compose`), `scopesCoverTier` (lower/same level needs no re-consent), `authScopeParam` (`openid email …`). Ops `filters_read` (min readonly) / `filters_write` (min send) → `SCOPE.settingsBasic`; `isFilterOp`, `scopesCoverFilters` (`modify` does not imply it), `authScopeParam(tier,{filters})`. See change: improve-gmail-plugin-setup-ux. |
| `setup.ts` | Pure setup validators shared by client + server: `PROJECT_ID_RE`, `normalizeProjectId`, `normalizeEmail`, `classifyProjectId` → `ok\|empty\|looks_like_name\|invalid`, `isEmail`. See change: improve-gmail-plugin-setup-ux. |
