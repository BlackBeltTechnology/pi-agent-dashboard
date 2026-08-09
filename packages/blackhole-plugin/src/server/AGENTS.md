# DOX — packages/blackhole-plugin/src/server

Files in this directory. One row per source file. See change: add-blackhole-plugin.

| File | Purpose |
|------|---------|
| `config-io.ts` | `readConfig(path) → ConfigOk \| ConfigParseError` — FAILS CLOSED (design D6): unparseable file yields the parser message and NO config object, never defaults. `saveConfig(path, managed) → { preservedUnmanagedKeys, externalWriteDetected }` — read-modify-write within the request (design D5): unmanaged + annotation keys keep value AND position, new keys append, `undefined`/`null` deletes. Throws `ConfigParseErrorOnWrite` without touching the file when unparseable. `writeAtomic` = tmp-in-same-dir + `fs.rename`, tmp cleanup on failure. |
| `config-path.ts` | `resolveBlackholeConfigPath(env)` → agent root (`PI_CODING_AGENT_DIR` trimmed/`~`-expanded/resolved, else `<home>/.pi/agent`) + fixed `BLACKHOLE_CONFIG_DIR`/`BLACKHOLE_CONFIG_FILENAME`. Mirror of blackhole `src/core/unified-config.ts` `getAgentDir`. Never from request input (no traversal). |
| `index.ts` | `registerPlugin(ctx)` + `registerBlackholeRoutes(fastify, { logger, env })` (factored for injected-Fastify tests). `GET`+`PUT /api/plugins/blackhole/config`. PUT validates BEFORE any disk access (400 + no write); 409 on unparseable file; 500 on an unwritable dir. Structured logging: path, key counts, failure reason — NEVER field values (config holds provider/model hints). |
