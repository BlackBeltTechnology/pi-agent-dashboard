## 1. Shared overlay module (A2)

- [ ] 1.1 Create `packages/shared/src/role-overlay.ts` holding `DEFAULT_ROLE_NAMES` + `overlayDefaultRoles` + the `RoleConfig`/`RolePreset` types (moved from `role-manager.ts`)
- [ ] 1.2 `packages/extension/src/role-manager.ts` imports those symbols from `shared` instead of defining them; its `roles:*` handlers and its `loadRoleConfig` fs reader stay unchanged
- [ ] 1.3 Re-run the extension's role tests → green (no behavior change, only import source)

## 2. Roles read route (GET only)

- [ ] 2.1 Create `packages/server/src/routes/roles-routes.ts` with `registerRolesRoutes(fastify, { networkGuard })`
- [ ] 2.2 Local guarded `providers.json` read (roles/rolePresets/activePreset), tolerant of missing/malformed file → empty (mirrors the self-contained read in `provider-routes.ts`)
- [ ] 2.3 Apply the shared `overlayDefaultRoles` (assigned wins; unconfigured defaults empty) + include `builtinRoleNames` (= `DEFAULT_ROLE_NAMES`)
- [ ] 2.4 `GET /api/roles` (network-guarded, read-only, never mutates/creates the file)
- [ ] 2.5 NO `PUT`/mutation route in this change
- [ ] 2.6 Register `registerRolesRoutes(...)` in `server.ts` next to `registerProviderRoutes`

## 3. Tests

- [ ] 3.1 Shared `role-overlay` unit: overlay applies defaults (assigned wins, unconfigured empty); `DEFAULT_ROLE_NAMES` content stable
- [ ] 3.2 `GET /api/roles`: returns assigned roles + overlaid defaults + `builtinRoleNames` + `rolePresets` + `activePreset`; missing file → empty, not created; read never mutates
- [ ] 3.3 `GET /api/roles`: no PUT route registered (PUT → 404/405)
- [ ] 3.4 `GET /api/roles`: network-guarded (rejects like the other config routes)
- [ ] 3.5 Extension role tests still green after the import retarget

## 4. Docs

- [ ] 4.1 Add the `roles-routes.ts` row to `packages/server/src/routes/AGENTS.md` and the `role-overlay.ts` row to `packages/shared/src/AGENTS.md`
- [ ] 4.2 Document `GET /api/roles` in the REST API reference (`packages/extension/.pi/skills/pi-dashboard/references/api-reference.md`)
