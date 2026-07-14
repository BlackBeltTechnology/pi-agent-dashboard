## Context

The role → model map (`~/.pi/agent/providers.json#roles`) lacks a session-less
READ surface — it is only reachable in-session via `roles:*` / the in-session
role tools. A read-only client (the InvoiceBot Modellek tab) needs it without a
session. Provisioning stays owned by the deployment (env-seeded `auth.json` +
`providers.json`); this change adds only a read.

## Goals / Non-Goals

**Goals:**
- Session-less `GET /api/roles` (read-only) returning the role slice + the
  default-name overlay + `builtinRoleNames`.
- A single source of truth for the overlay primitives (constant + overlay fn),
  reused by both the extension and the server.

**Non-Goals:**
- No `PUT`/`DELETE`/mutation anywhere.
- No change to `GET /api/provider-auth/status`, `GET /api/models`, the `roles:*`
  handlers, or the on-disk format.
- No provider-inventory / masked-key endpoint (see D3).

## Decisions

**D1 — `GET /api/roles` is read-only.** It reads `providers.json`, applies the
overlay, and returns `{ roles, rolePresets, activePreset, builtinRoleNames }`.
Tolerant of a missing/malformed file (→ empty). It never creates or writes the
file, and no `PUT` route is added.

**D2 — Reuse the overlay via a shared module (A2, precise).** The drift-prone
primitives — `DEFAULT_ROLE_NAMES`, `overlayDefaultRoles`, and the
`RoleConfig`/`RolePreset` types — move to `packages/shared/src/role-overlay.ts`
(next to the existing `role-name-validation.ts`, which already establishes
role logic in `shared`). The extension's `role-manager.ts` imports them from
`shared` instead of defining them; its `roles:*` handlers and its `loadRoleConfig`
fs reader are otherwise untouched. The server imports the same shared primitives.
- *Why not import from the extension (A1):* the server today imports only from
  `shared`, never from the extension; the extension has no `exports` map, so a
  deep `src/*.ts` import would couple the server to an internal path. Rejected.
- *Why not duplicate locally (B):* a second copy of `DEFAULT_ROLE_NAMES` is
  exactly the drift the recently-merged builtin-role-names fix closed. Rejected.
- *Why NOT also move `loadRoleConfig` (A2 full):* the fs reader is not
  drift-prone, it carries extension-adjacent concerns (schema/logging/companion
  writers), and `shared` should stay free of `homedir`/fs config-path
  responsibilities. The server instead does its own guarded `providers.json`
  read — the same self-contained pattern `provider-routes.ts` already uses — and
  applies the shared overlay.

**D3 — No provider-inventory endpoint; `/api/models` covers "live providers".**
The consuming UI derives which providers are live from `GET /api/models`
(session-independent InternalRegistry, `registryReady`-aware). Masked API keys
were dropped, so there is no need to read/merge `auth.json` +
`providers.json#providers` server-side. `GET /api/provider-auth/status` is left
unchanged.

**D4 — Keep `builtinRoleNames` in the response.** Parity with the existing
`roles:get-all` contract (reinforced by the merged builtin-role-names relay fix).
The InvoiceBot UI ignores it (it uses its own `FLOW_ROLES`), but other clients
rely on it — harmless to include.

## Risks / Trade-offs

- **[Trade-off] Moving primitives to `shared` touches the extension.** One import
  line in `role-manager.ts`; re-run the extension's role tests to confirm green.
  Bounded, one-time.
- **[Trade-off] Two file readers exist** (extension `loadRoleConfig`, server's
  own read). Acceptable: file reads are not drift-prone, and this mirrors the
  existing `provider-routes.ts` convention. The drift-prone overlay is single-source.
- **[Risk] Malformed `providers.json`.** The server read is tolerant
  (missing/parse-fail → empty), so the route never throws.
