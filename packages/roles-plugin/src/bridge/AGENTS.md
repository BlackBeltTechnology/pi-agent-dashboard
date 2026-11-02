# DOX — packages/roles-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Roles plugin bridge entry. On `before_agent_start`, only when `selectedTools` includes `Agent`, probes `roles:get-all` and appends one `toolGuidelines.Agent` bullet (only when ≥1 assigned role): prefer `model:"@role"`, call `list_roles` to discover usable roles; lists no roles (no cap). See change: roles-discovery-via-list-roles. Exports `buildRoleGuideline`, `ROLES_GET_ALL_CHANNEL`. Errors swallowed. See change: add-plugin-bridge-contributions. |
