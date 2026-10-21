# check-plugin-boundary.mjs — index

Core/plugin import ratchet for `ship-it` step 4.4 + `npm run check:plugin-boundary`: NEW edge / STALE row fails. → see `check-plugin-boundary.mjs.AGENTS.md` Also the `./host` symbol check (in-repo plugin file importing a `host.ts` name from the runtime ROOT fails unless an allowlist `hostRootImports` row `{file, expires, reason}` covers it; `expires` inclusive vs runtime version).
