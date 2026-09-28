# i18n-lint.mjs

Hardcoded-string lint over shipped UI. `--strict` gates (exit 1); plain run reports only.
Skips `node_modules`, tests, `dist`, templates, `demo-plugin`, `dashboard-plugin-skill`, `mcp-server-plugin`, `browser-plugin/src/server`, `mcp-client-plugin/src/core`.
`DEAD_CODE` excludes retained-but-unwired files.
`NON_SPA_PAGES` excludes `dashboard-plugin-runtime/src/server/loopback-callback.ts` — completion page served by bare `node:http` to the system browser, outside the SPA + its i18n runtime; plugins override via `successHtml`. See change: expose-plugin-credential-and-oauth-seams.
Walk excludes `gmail-plugin/src/(server|bridge)` — bridge text is MODEL-facing (agent contract); server strings are OAuth-flow prompt + REST error payloads the client maps to translated copy. Client subtree still scanned. See change: add-gmail-plugin.
