# api-not-found.spec.ts — index

Playwright E2E. L3 X11: unknown `/api/does-not-exist` → 404 `application/json` `error:"not_found"`; registered `/api/plugins/demo/vault-read` → 200 JSON. Uses `OperatorSession`. See change: retro-ux-credential-vault. `OperatorSession.arm` narrows through `narrowTrust`; `afterEach` restore removed. See change: triage-browser-e2e-offbox-poison.
