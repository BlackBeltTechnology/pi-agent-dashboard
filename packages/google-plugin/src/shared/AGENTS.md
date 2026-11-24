# DOX — packages/google-plugin/src/shared

Pure code shared by server, client and tools. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/products.test.ts` | Catalogue order + D4 scopes, implication coverage, union consent scopes (no `include_granted_scopes`), built-in Drive limit, restricted products, `parseSelection` strictness. |
| `__tests__/shared.test.ts` | Operator switches (A1), client JSON (A4), domains (A5), return origins (B3), endpoints override, local-browser rule, flow-code allow-list. |
| `client-json.ts` | `validateClientJson` — Desktop (`installed`) OR Web (`web`), never both (`ambiguous_client`); codes `not_json`/`not_installed`/`bad_client_id`/`missing_secret`. `normalizeDomain` (trim, lowercase, strip `@`, needs a dot), `slugify`. |
| `default-clients.ts` | `BUILT_IN = {local:null, remote:null}` (ships empty until verification), `DISCLOSURE_VERSION`, `RETURN_PAGE_URL`, `createSwitchReader(env,warn)` — `PI_GOOGLE_DEFAULT_CLIENTS` / `PI_GOOGLE_REMOTE_RETURN` (`off`/`0`/`false` disable; unknown warned once), read live. |
| `endpoints.ts` | `resolveGoogleEndpoints` — `PI_E2E_GOOGLE_BASE_URL` honoured ONLY for loopback http; non-loopback ignored with one warning. |
| `flow-codes.ts` | `knownFlowCode` — allow-list of fixed sign-in failure codes for the log line / client table. |
| `local.ts` | `isGenuinelyLocal(headers, remoteAddress)` — loopback peer AND no `x-forwarded-*`/`forwarded`/`via`/`x-real-ip`. |
| `products.ts` | Catalogue (single source): products, ordered levels, scopes, Google class, built-in availability. `scopesFor`/`requiredScopes`/`effectiveScopes`/`coversSelection`/`unionScopes`/`scopeParam`/`restrictedProducts`/`builtinRefused`/`parseSelection`. |
| `protocol.ts` | Lane names `google/lease`, `google/accounts`, service `google.connect`; `LeaseReply`, `LeaseRefusal`, `AccountStatus`. |
| `return-origin.ts` | `allowedReturnOrigin` — `https:` or loopback `http:` origins without userinfo (B3); mirrored by `site/oauth/return.html`. |
| `setup.ts` | `PROJECT_ID_RE`, `normalizeEmail`, `isEmail` (linear-time). Ported from gmail-plugin. |
