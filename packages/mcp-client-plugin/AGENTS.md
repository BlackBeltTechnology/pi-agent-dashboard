# DOX — packages/mcp-client-plugin

First-party dashboard plugin `mcp-client` — the generic MCP server manager. Owns ONE
effective view over pi's two built-in MCP layers (Pi global + trusted folder), global +
folder server editing with provenance, live state from `pi mcp list --json`, secret
masking, and adapter-leftover conversion. Uses pi's BUILT-IN MCP (pi ≥ 1.0.0); no
`pi-mcp-adapter`. Claims `settings-section`, the two folder pills, and the
`/folder/:encodedCwd/mcp` overlay route. Supersedes apple-tools' local `mcp-config.ts`.
See change: extract-mcp-client-plugin, migrate-mcp-to-pi-builtin.

Subdirectories: `src/core/AGENTS.md` (host-free logic + the `mcp-client.config` service),
`src/server/AGENTS.md` (REST + plugin entry), `src/client/AGENTS.md` (settings section + folder
surfaces).

| File | Purpose |
|------|---------|
| `README.md` | Package overview: what the plugin owns, the two-layer model, the REST surface, the published schema. |
| `package.json` | id `mcp-client`; exports `./client` `./server` `./core` (core carries NO host/React import); NO `requires`; `ajv` direct dep (schema validation). `pi-mcp-adapter` + `strip-json-comments` removed. See change: migrate-mcp-to-pi-builtin. |
| `schema/mcp-config.schema.json` | Published pi 1.0.0 entry shape: `ServerEntry` `description`/`oauth.clientName`/`oauth.authServerMetadataUrl`/`auth.provider` (global-only)/`exposure` (alias)/`toolExposure`/`timeout`/`enabled`; markers `x-secret` (redaction + masking), `x-transport`, `x-global-only`. Adapter-only keys (`McpSettings`, `inheritEnv`, `caFile`, `tasks`, `directTools`, `disabled`) removed. See change: migrate-mcp-to-pi-builtin. |
| `tsconfig.json` | Package TS project (extends the repo base). |
| `vitest.config.ts` | jsdom test project + home-isolation `globalSetup`; aliases `@blackbelt-technology/pi-dashboard-shared` to the worktree source so tests see the same code the build does. |
