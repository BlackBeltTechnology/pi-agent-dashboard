# DOX — packages/demo-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Demo fixture server entry (loads only under `PI_DASHBOARD_FIXTURE_PLUGINS=1`). Registers `demo/echo` request handler (`echo: <text>`); routes `GET|DELETE /api/plugins/demo/account` (credential key `demo-account`) + `POST /api/plugins/demo/sign-in` → `ctx.oauth.startFlow` with `demoLoginFlow` (auth_url + manual_code; answer `ok` → dummy OAuth credential persisted via `ctx.credentials`). See change: expose-plugin-credential-and-oauth-seams. `GET /api/plugins/demo/vault-read` reports presence/length of declared `POLY_PIZZA_KEY` (never the value). See change: add-credential-vault. Under `fixturePluginsEnabled()` calls `ctx.registerFileValidator({claimId: DEMO_FILE_HANDLER_CLAIM "demo-docx", module: DEMO_FILE_VALIDATOR_MODULE "./src/file-handler/validator.mjs"})`. See change: add-editor-pane-file-handlers. |