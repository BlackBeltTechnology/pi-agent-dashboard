# DOX — packages/mcp-client-plugin

First-party dashboard plugin `mcp-client` — the generic MCP server manager. Owns ONE
effective view over every `pi-mcp-adapter` config layer, global + folder server editing with
layer provenance, secret masking, and the adapter's own global settings. Claims
`settings-section`, the two folder pills, and the `/folder/:encodedCwd/mcp` overlay route.
Supersedes apple-tools' local `mcp-config.ts` (which it deleted) and mcp-server-plugin's local
adapter probe. See change: extract-mcp-client-plugin.

Subdirectories: `src/core/AGENTS.md` (host-free logic + the `mcp-client.config` service),
`src/server/AGENTS.md` (REST + plugin entry), `src/client/AGENTS.md` (settings section + folder
surfaces).

| File | Purpose |
|------|---------|
| `README.md` | Package overview: what the plugin owns, the worker-thread adapter load, the REST surface, and the published schema. |
| `configSchema.json` | Host config for `plugins.mcp-client`. One key `adapterLoadTimeoutMs` (integer, default 10000, min 1000, max 120000, `additionalProperties: false`) — bounds the worker-thread adapter config load; does NOT affect pi sessions. |
| `package.json` | id `mcp-client`; exports `./client` `./server` `./core` (core carries NO host/React import); `requires.piExtensions: ["pi-mcp-adapter"]`; `pi-mcp-adapter` + `ajv` + `strip-json-comments` direct deps; the four slot claims. |
| `schema/mcp-config.schema.json` | Published `$defs`: `ServerEntry`, `McpSettings`, `OAuthConfig`, `McpTraceSettings`, `McpOutputGuardSettings`, `HttpRequestHeadersCommand`. Carries the `x-secret` / `x-atomic` / `x-transport` markers the client editor renders from — never hardcode those lists client-side. |
| `tsconfig.json` | Package TS project (extends the repo base). |
| `vitest.config.ts` | jsdom test project + home-isolation `globalSetup`; aliases `@blackbelt-technology/pi-dashboard-shared` to the worktree source so tests see the same code the build does. |
