# DOX — packages/demo-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `docx-validator.mjs` | Worker-thread validator for the `.docx` file-handler fixture claim: rejects empty bytes and the marker `REJECT-ME`. See change: add-editor-pane-file-handlers. |
| `index.ts` | Demo fixture server entry (loads only under `PI_DASHBOARD_FIXTURE_PLUGINS=1`). Registers `demo/echo` request handler (`echo: <text>`); routes `GET|DELETE /api/plugins/demo/account` (credential key `demo-account`) + `POST /api/plugins/demo/sign-in` → `ctx.oauth.startFlow` with `demoLoginFlow` (auth_url + manual_code; answer `ok` → dummy OAuth credential persisted via `ctx.credentials`). See change: expose-plugin-credential-and-oauth-seams. `GET /api/plugins/demo/vault-read` reports presence/length of declared `POLY_PIZZA_KEY` (never the value). See change: add-credential-vault. Registers `ctx.registerFileValidator({claimId:'docx', module:'./src/server/docx-validator.mjs'})` (`?.` — older hosts). See change: add-editor-pane-file-handlers. |