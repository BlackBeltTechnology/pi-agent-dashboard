## Why

The role-name schema is already user-editable on disk — `2026-07-08-add-agent-role-model-tools` made `DEFAULT_ROLE_NAMES` a seed (not a const), added the `roleNames`/`removedRoles` markers, and shipped `addRoleName()` / `removeRoleFromSchema()`. But that editing capability was exposed **only to in-session agents** through the `update_roles` tool. The human Settings UI (`BuiltInRolesSettings` in `roles-plugin`) still renders a closed set: it maps over `Object.keys(rolesMap)` with no affordance to introduce a new role name and no client→bridge message to add or remove one.

The result is an asymmetry: an LLM can create `@doubt-verifier-1` via `update_roles`, but a person cannot do it by hand. Anyone who wants a custom role for subagent spawn (e.g. a cheap `@doubt-verifier-1` and a max-tier `@doubt-verifier-x` bound to different models, referenced as `Agent(model: "@doubt-verifier-x")`) must either drive an agent or hand-edit `~/.pi/agent/providers.json`.

This change surfaces the already-editable schema to humans: an **＋ Add custom role** affordance with inline name validation, a Built-in vs Custom grouping, and a **×** remove on custom roles only.

## What Changes

- **Add custom roles from the UI (atomic name + model).** A new **＋ Add custom role** control in the Roles section opens an inline `@`-prefixed name input with live validation; on a valid name it opens the existing `ui:model-selector` primitive, and the name + picked model land together as one `role_set` (which already auto-creates the role via `roles:set`). No separate `role_add` message — a custom role only reaches disk when a model is assigned, matching the atomic contract.
- **Group Built-in vs Custom.** The roles grid splits into a Built-in group (the seeded defaults) and a Custom group. The client learns which names are built-in from a new `builtinRoleNames: string[]` field on the `roles_list` payload (sourced server-side from `DEFAULT_ROLE_NAMES`) rather than duplicating the const in the client.
- **Remove custom roles.** Custom pills gain a **×** that dispatches a new `role_remove` WS message → `roles:remove` handler → `removeRoleFromSchema()` (purge from the schema, active map, and every preset, atomically). Removal is confirmed via `window.confirm` and takes effect immediately (consistent with preset delete). Built-in roles never show **×** (per the locked decision to keep built-ins permanent).
- **Shared name validation.** A single `isValidRoleName(name, existing)` helper in `@blackbelt-technology/pi-dashboard-shared` enforces the rules for both the client (inline UX) and the bridge (defense-in-depth reject): non-empty, `^[A-Za-z0-9][A-Za-z0-9_-]*$`, no `/` / whitespace / leading `@`, and no collision with an existing effective role name (built-in or custom).

Out of scope (explicitly): name-only placeholder roles (no model), tier/parameterized "role families", and hiding/removing built-in roles. All three were considered and deferred.

## Capabilities

### Modified Capabilities
- `model-selector`: the "Roles UI surfaces via settings-section plugin contribution" requirement gains an **＋ Add custom role** flow (inline validated name input → model picker → atomic `role_set`), a Built-in/Custom grouping driven by `roles_list.builtinRoleNames`, and a **×** remove on custom roles that dispatches `role_remove`. The grid renders the union of persisted role keys and pending-only (unsaved) custom names.
- `dashboard-roles-ownership`: adds a human-facing `role_remove` WS message + `roles:remove` handler that triggers the existing purge (`removeRoleFromSchema`); the `roles:get-all` / `roles_list` payload gains `builtinRoleNames` so the client can classify roles without duplicating `DEFAULT_ROLE_NAMES`.

## Impact

- Code: `packages/roles-plugin/src/RolesSettingsSection.tsx` (add-role flow, group split, × remove, render pending-only names), `packages/extension/src/bridge.ts` (route new `role_remove`; include `builtinRoleNames` in `roles_list` sends), `packages/extension/src/role-manager.ts` (new `roles:remove` handler over `removeRoleFromSchema`; expose `DEFAULT_ROLE_NAMES` in the `roles:get-all` payload), `packages/shared/src/…` (new `isValidRoleName` helper + `role_remove` message type + `builtinRoleNames` on `roles_list`).
- Protocol: one new client→bridge message (`role_remove`); one new field on the existing `roles_list` server→client payload (`builtinRoleNames`). No breaking changes; older clients ignore the new field.
- Data: no schema change on disk — `roleNames` / `removedRoles` / `roles` already exist. A custom role reaches `providers.json#roles` only on model assignment (unchanged write path).
- Backend behavior: unchanged resolution — `@custom-role` resolves via the existing `role:resolve-model` / `model:resolve` path; an unassigned role still reports "not configured yet".

## Discipline Skills

- `security-hardening`: a role name is user input persisted to the global, machine-wide `~/.pi/agent/providers.json`; the validation helper is the trust boundary — confirm reserved chars (`/`, whitespace, `@`) and collisions are rejected on BOTH the client and the bridge, not the client alone.
- `doubt-driven-review`: `role_remove` purges a role from every preset in one irreversible write; review the confirm gate + blast radius (and the pending-state cleanup for a removed role) before it lands.
