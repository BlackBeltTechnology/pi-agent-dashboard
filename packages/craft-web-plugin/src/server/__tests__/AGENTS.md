# DOX — packages/craft-web-plugin/src/server/__tests__

Files in this directory. One row per source file. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `helpers.ts` | Harness. `tmp`/`cleanupTmp`, `writeTrunkBuild` (inline Trunk bootstrap fixture), `writeShim(dir, v)`, `recordingLogger`, `makeHost` (fake ctx over real Fastify; `serveApp` = REAL `mountApp`; `mount:false` models plugin enabled live). |
| `mount.test.ts` | E16 unprepared static GET → 503 + zero outbound fetch. E17 per-request CSP from forwarded host (no `'self'`/`sha256-`, ACAO `*`, no credentials). Validator registration `enabled()` follows live config (E3). `publicOrigin`/`buildCsp` unit cases. |
| `ooxml-validator.test.ts` | E18: valid per kind (deflated+stored), wrong kind, non-zip, DOCTYPE/ENTITY, missing main part, 10,001 entries, oversized/corrupt content types. |
| `post-install.test.ts` | E13: no inline script, bootstrap+shim referenced once, shim before bootstrap, idempotent, other-version refusal, `.gz` siblings, `.br` removed, `craft-build.json`. |
| `routes.test.ts` | Real `registerPlugin` over Fastify: status shape, restart-required, prepare 403/404, csp-report 200/400/413/429. |
| `service.test.ts` | E3 status decision table, E12 status side (override-dir prepare, shim bump → shim-outdated → re-prepare keeps old tree), X1/X2 failure mapping, single-flight, log lines, csp rate limit. |
| `shim-version.test.ts` | `parseShimVersion` literal contract; packaged shim declares a version; mtime re-read. |
| `validator-worker.test.ts` | Validator through the REAL registry + REAL worker pool. |
