## 1. Guideline → list_roles pointer

- [x] 1.1 Update bridge test: bullet names `list_roles` + `model: "@<role>"`, contains no `@name`/ref; 13 roles → same text; empty / unassigned-only → no bullet
- [x] 1.2 `packages/roles-plugin/src/bridge/index.ts`: `buildRoleGuideline` returns pointer text when ≥1 assigned role; drop `MAX_LISTED_ROLES`
- [x] 1.3 Update `packages/roles-plugin/src/bridge/AGENTS.md` row

## 2. list_roles reports usable roles

- [x] 2.1 Tests in `packages/extension/src/__tests__/role-model-tools.test.ts`: removed role excluded; unavailable model → `unavailable` with `model-not-available`; level suffix stripped for the check; unhydrated registry → `registryReady:false`, no filter; presets unchanged
- [x] 2.2 `packages/extension/src/role-model-tools.ts`: `list_roles` uses `overlayRoles(cfg)` + `deps.getRegistry()?.getAvailable()`; update tool description
- [x] 2.3 Update `packages/extension/src/role-model-tools.ts.AGENTS.md`

## 3. Verify

- [x] 3.1 Targeted vitest for both packages green
- [x] 3.2 `npm run reload`; new turn shows pointer bullet; `list_roles` output shows `unavailable`/`registryReady`
