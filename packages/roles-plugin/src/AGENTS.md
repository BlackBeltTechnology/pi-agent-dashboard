# DOX — packages/roles-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.tsx` | Client entry barrel. Re-exports `BuiltInRolesSettings`. Export name preserved for Vite-plugin named-import generator. See change: fix-pi-flows-end-to-end, rename-builtins-to-roles-plugin. |
| `RolesSettingsSection.tsx` | Roles editing UI: preset CRUD, role grid, model picker. Reads roles + models via `useSessionData`. Dispatches existing `role_set` / `role_preset_*` WS messages. See change: fix-pi-flows-end-to-end. Consumes `ui:model-selector` via `useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector)` (replaces inline picker). Sends full `"provider/modelId"` string as `modelId` in `role_set`. Exports pure helper `inferProviderForBareId(stored, models)` for read-time migration of legacy bare-id role values. See change: add-ui-model-selector-primitive. Splits grid into Built-in/Custom groups via `computeRoleGroups(rolesMap, pending, builtinRoleNames)` (union of persisted+pending keys; empty `builtinRoleNames`→one flat group). `+ Add custom role` inline `@`-name input validated by shared `isValidRoleName` → opens model picker → stages `pending` (atomic `role_set` on unified Save). Custom pills get `×` → `window.confirm` → dispatch `role_remove` + drop `pending[role]`; built-ins never removable. See change: add-custom-roles-ui. |
