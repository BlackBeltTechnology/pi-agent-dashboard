# DOX — packages/gmail-plugin/src

Files in this directory. One row per source file. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/fakes.ts` | Test fakes. `memoryCredentials` (in-memory `PluginCredentials`, `update` atomic), `fakeGoogleFetch` (token + revoke endpoints; records `calls`/`revokes`), `idToken`/`validClaims` (unsigned JWT, claims only), `capturingLogger` (`lines` all, `warns` warn-only), `TEST_ENDPOINTS` (loopback, `overridden:true`), `CLIENT`. |
| `configSchema.json` | Empty object schema — no plugin config; state lives in the credential store. |
| `i18n.ts` | `catalog` — zh-CN + hu leaf keys (parity enforced); English at call sites. |
