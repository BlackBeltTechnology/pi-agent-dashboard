## Why

A browser client with no active pi session cannot READ the role → model
assignments (`~/.pi/agent/providers.json#roles`). Today that slice is only
reachable in-session over the `roles:*` WS events / the in-session role tools;
a headless or fresh-workspace client (e.g. a read-only settings screen) has no
session-less way to see which model each role uses.

This adds the one missing read: a session-less, read-only `GET /api/roles`. It
reuses the role framework's existing read + overlay helpers so there is a single
source of truth for the default-role overlay.

Everything else a read-only model-settings screen needs already exists:
`GET /api/config` (`defaultModel`) and `GET /api/models` (the session-independent
InternalRegistry catalogue, now `registryReady`-aware) — so no provider-inventory
or masked-key endpoint is introduced.

## What Changes

- Promote the drift-prone role-overlay primitives into the shared package
  (`packages/shared/src/role-overlay.ts`): `DEFAULT_ROLE_NAMES`,
  `overlayDefaultRoles`, and the `RoleConfig`/`RolePreset` types. The extension's
  `role-manager.ts` retargets its import of those to `shared` (its `roles:*`
  handlers and its `loadRoleConfig` fs reader are otherwise unchanged). This is
  the single source of truth for the overlay — closing the same
  default-role-name drift class the recently-merged builtin-role-names fix
  addressed.
- Add **`GET /api/roles`** — session-less, **read-only**. The server reads
  `~/.pi/agent/providers.json` locally (network-guarded, the same self-contained
  read `provider-routes.ts` uses for `providers.json`), then applies the shared
  `overlayDefaultRoles`. Returns `{ roles, rolePresets, activePreset,
  builtinRoleNames }` (assigned wins; unconfigured stock roles empty). It SHALL
  NOT mutate or create the file, and this change SHALL NOT add a `PUT` (or any
  mutating) `/api/roles` route.
- No change to the `roles:*` extension handlers, to `GET /api/provider-auth/status`,
  to `GET /api/models`, or to any write path.

## Capabilities

### New Capabilities

- `roles-rest-api`: Session-less, **read-only** `GET /api/roles` over the
  `providers.json` role slice, with the shared default-name overlay and
  `builtinRoleNames`. No write endpoint.

### Modified Capabilities

None. `dashboard-roles-ownership` (the extension's `roles:*` handlers + on-disk
format) is unchanged; the overlay primitives simply move to `shared` and the
extension imports them from there.

## Discipline Skills

- `security-hardening` — the route reads the auth-adjacent `providers.json`; it
  must stay read-only, network-guarded, and never widen what it serializes
  (role→model refs only, never keys).

## Impact

- New `packages/shared/src/role-overlay.ts` (moved `DEFAULT_ROLE_NAMES` +
  `overlayDefaultRoles` + types); one import-line change in the extension's
  `role-manager.ts`; extension role tests re-run to stay green.
- New `packages/server/src/routes/roles-routes.ts` (GET only) + one
  `registerRolesRoutes(...)` call in `server.ts` next to `registerProviderRoutes`.
- Read-only: no file is ever written or created by the route.
- Consumed by the companion UI change's read-only Modellek tab.
