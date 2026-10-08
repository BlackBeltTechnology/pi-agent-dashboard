# role-manager.ts — index

Manages session model roles. Registers six `roles:*` handlers… → see `role-manager.ts.AGENTS.md` Sole WRITER of the role slice; the pure schema helpers (`DEFAULT_ROLE_NAMES`, `effectiveRoleNames`, `overlayRoles`, types) + the normalizer now live in shared `role-schema.ts` and are imported back — `loadRoleConfig` keeps the file read but delegates normalization to `parseRoleConfig`; re-exports the shared names for existing importers. See change: add-roles-read-api.
