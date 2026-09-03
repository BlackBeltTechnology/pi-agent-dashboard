# DOX — packages/roles-plugin/src/server

Files in this directory. One row per source file. See change: add-roles-read-api.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry `registerPlugin(ctx)`. Mounts the read-only `GET /api/roles` route via `mountRolesRoutes(ctx.fastify)` synchronously during plugin registration (host owns `listen`). Consumes no host services — the route reads `~/.pi/agent/providers.json` directly, so a session-less worktree still reads its role schema. See change: add-roles-read-api. |
| `roles-routes.ts` | `mountRolesRoutes(fastify, {configPath?})` registering `GET /api/roles` WITHOUT a `networkGuard` preHandler (only the dashboard auth gate, mirroring `/api/models`). Returns `{object:"list", data: RoleGroup[]}`. Reads + normalizes via shared `parseRoleConfig`; `readRoleConfig` degrades every read/parse failure (missing / EACCES / EISDIR / TOCTOU / bad JSON) to "no assignments" → never 503, never empty. `buildAxis` = effective schema (defaults→user-added→assigned) ∪ preset-only names (first-referencing order) − removals. `buildGroups`: live group first (`preset:null`), then presets in stored order; dangling `activePreset` → live group active; exactly one `active`. `toRow` builds each row field-by-field (never spreads config) → `role`/`ref`/`assigned`/`builtin` always; `model`/`provider`/`thinkingLevel` omitted when undeterminable (bare id omits provider). `configPath` dep injectable for tests. See change: add-roles-read-api. |
