# DOX — packages/hermes-memory-plugin/src/server

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `config-path.ts` | `resolveHermesConfigPath(env)` → agent root (`PI_CODING_AGENT_DIR` trimmed/`~`-expanded/resolved, else `<home>/.pi/agent`) + fixed `HERMES_CONFIG_FILENAME`. Mirror of pi-hermes-memory paths.ts `resolveAgentRoot`. Filename never from input (no traversal — design D2). |
| `config-io.ts` | `readEffectiveConfig(path) → { filePath, exists, raw, fields }` (per-key value/default/isDefault, design D4; tolerates absent + malformed JSON). `writeResolvedConfig(path, obj)` atomic pretty-JSON write (tmp in same dir + `fs.rename`, `mkdir -p` parent — design D7). |
| `index.ts` | `registerPlugin(ctx)` server entry + `registerHermesRoutes(fastify, { logger, env })` (factored for injected-Fastify tests). `GET`+`PUT /api/plugins/hermes-memory/config`. PUT validates via `validateHermesConfig` BEFORE any write (400 + no write on failure). Structured logging: path + field count on success, failure reason on error, NEVER field values (design D9). |
