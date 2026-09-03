## Why

A second frontend needs to read the dashboard's role→model assignments for display. Today there is **no HTTP read path for roles at all** — `grep -rn roles packages/server/src/routes/` returns nothing. The only way to read roles is the `roles:get-all` event, reached over the dashboard WebSocket via `piGateway.sendToSession(id, …)`, which means an external consumer must:

1. speak the dashboard's browser WebSocket protocol,
2. hold a **live pi session id** to route the request through, and
3. wait for an asynchronous `roles_list` broadcast rather than making a request.

Requirement (2) is the hard blocker: roles live in `~/.pi/agent/providers.json`, a file the dashboard server already reads directly in `provider-routes.ts`, yet with no session running there is no way to read them. The kb-plugin hit and solved this exact shape — its routes exist so *"a cold worktree with no live session is both indexable and configurable"*.

The dashboard has already built the sibling of what is needed here: `GET /api/models` (`agent-model-introspection`) is an ungated, read-only catalogue endpoint for external agent consumers, served from server-side state with no pi session involved. Roles have no equivalent.

## What Changes

- **Add `GET /api/roles`** — a read-only role catalogue, mirroring the `GET /api/models` envelope (`{ object: "list", data: [...] }`) and its auth posture (dashboard auth gate only, no `networkGuard` preHandler, no `pi-proxy-...` Bearer key).
- **The roles-plugin package owns the route.** `packages/roles-plugin` gains a `"server"` manifest entry and mounts the route on `ctx.fastify`, exactly as kb-plugin mounts `/api/kb/*`. The route is **not** added to `packages/server/src/routes/`. `/api/roles` is already the plugin's own id namespace.
- **Unassigned roles are returned, not omitted.** Every role in the effective schema appears with `ref: null` when it has no model. This mirrors `/api/models` returning a complete row set; for roles an unassigned entry is *expected state*, not an error. Omitting them would relocate `DEFAULT_ROLE_NAMES` into every consuming frontend, where it silently goes stale when pi adds a built-in role.
- **Presets are role groups in the same list.** A `RolePreset` is `{ name, roles: Record<string,string> }` — a named snapshot of the *same* map the live roles use, kept in sync by the write-through in `roles:set` and the wholesale replace in `preset-load`. So the response is a list of role groups: the live group (`preset: null`) plus one per preset, each carrying `active`. `activePreset` becomes a per-group `active: true` flag rather than a top-level key, keeping the envelope identical to `/api/models`.
- **One canonical role-name axis across all groups.** Presets persist only what was assigned when saved, so groups would otherwise carry different role sets and break matrix rendering. The axis is `effectiveRoleNames(cfg) ∪ (keys of every preset)`, minus removal markers, overlaid onto every group. Nothing is hidden, and every group returns identical rows in identical order. The axis is deliberately a **superset** of `effectiveRoleNames(cfg)` when a preset references a role the live config lacks — the two read surfaces are required to agree on the effective schema and assigned values, not on preset-only names, and the spec delta says so explicitly rather than claiming an identity that `overlayRoles` does not provide.
- **Invalid role state is normalized on read, never written.** A dangling `activePreset` (naming no stored preset) falls back to marking the live group active; duplicate preset names collapse to one group. Without these rules "exactly one active group" is not achievable — the existing write-through in `roles:set` only fires when the active preset actually resolves, so a dangling reference leaves the live map and the named preset genuinely divergent.
- **Each row carries `builtin`**, so a consumer classifies built-in vs custom without embedding `DEFAULT_ROLE_NAMES` — the same rationale already recorded for `roles:get-all` advertising `builtinRoleNames`.
- **Extract the pure role-schema helpers into `packages/shared`** (`DEFAULT_ROLE_NAMES`, `effectiveRoleNames`, `overlayRoles`, and the ref/thinking-level split), so the bridge, the plugin server entry, and the plugin client read one definition. `isValidRoleName` already lives in shared for exactly this bridge↔client reason.
- **Extract the read-time normalizer too, as a pure `parseRoleConfig(raw)`.** Today `loadRoleConfig` couples the file read to the normalization: it trims assigned values and drops non-string ones, but blind-casts `rolePresets`, so a preset entry that is `null` or whose `roles` is not an object would crash a consumer that projects it. Splitting normalization (pure, shared, total) from the file read (per side) means (a) the two surfaces cannot normalize differently, (b) the plugin route needs no privileged access to the config reader, and (c) structurally malformed sub-values are discarded rather than fatal — which is what makes the "always answerable" guarantee true rather than aspirational.
- **Two deliberate, bounded payload changes — declared, not discovered.** This change is **not** byte-identical to today's `roles:get-all`, and does not claim to be:
  1. `roles:get-all` relays `cfg.rolePresets` uninspected, so a structurally invalid preset entry reaches the client today. Sharing the normalizer drops it — an entry no consumer could render or load anyway.
  2. `overlayRoles` ends with `{ ...out, ...cfg.roles }`. `effectiveRoleNames` filters removed names out of the *keys*, but that final spread reintroduces any assigned key — so a config holding both `removedRoles: ["vision"]` and `roles.vision` reports `vision` today. Honouring "a removed role never appears" corrects that.

  Identity holds for every configuration with well-formed presets and no removal-marker/assignment collision. Both corrections carry their own scenario rather than hiding behind "no behavioural change".
- **`provider` is reported only when the assignment carries one.** Legacy role values persisted before provider prefixes were canonical are bare ids; the client resolves them opportunistically against a live models list (`inferProviderForBareId`). The endpoint has no registry and SHALL NOT acquire one for this — it omits `provider` for a bare id rather than guessing, and never rewrites the stored value.
- **Read-only.** No POST/PUT/DELETE. Mutation keeps flowing through the existing `roles:*` WebSocket protocol via a live pi session. **Not BREAKING** — purely additive; `roles:get-all` is untouched.

Not in scope: writing roles over HTTP; changing role resolution, precedence, or removal semantics; a client UI for the new endpoint; per-consumer authorization beyond the existing dashboard auth gate and `cors.allowedOrigins`.

## Capabilities

### New Capabilities
- `agent-role-introspection`: an ungated, read-only HTTP role catalogue (`GET /api/roles`) owned by the roles-plugin package. Covers the response envelope and row shape, the complete-axis/unassigned-as-`null` contract, role-group and preset representation, the no-credential-material guarantee, and the never-503/never-empty behaviour on a fresh install.

### Modified Capabilities
- `dashboard-roles-ownership`: two requirements change. (a) *"SHALL define a canonical default role-name set and overlay it at read time"* currently scopes the overlay to *"the `roles:get-all` response"*; the overlay becomes a property of **every** role read surface, including the new HTTP one, with removal markers (`removedRoles`) equally respected, and the cross-surface agreement obligation is stated in terms of the effective schema so the preset-only superset is not a contradiction. (b) *"The role-events back-end implementation SHALL live in its own module"* is amended from *sole owner of reads and writes* to **sole writer of the role slice** — reading becomes non-exclusive, but every reader must normalize through the one shared normalizer. Stated as "all disk I/O stays in `role-manager.ts`", the requirement would forbid the very endpoint this change adds; stated as "sole writer of `providers.json`" it would be factually false, since `provider-routes.ts` already writes the `providers` key of the same file (atomic tmp+rename, preserving other fields). Ownership is per-key, matching how requirement (a) of this capability was already scoped.

## Impact

**`packages/shared`**
- `src/role-schema.ts` — NEW. Pure, dependency-free: `DEFAULT_ROLE_NAMES`, `effectiveRoleNames(cfg)`, `overlayRoles(cfg)`, `splitRef(ref)` / `joinRef(model, level)`, `parseRoleConfig(raw: unknown): RoleConfig`, and the `RoleConfig` / `RolePreset` types. No `node:fs`, so the client can import it. `parseRoleConfig` is **total**: any input, including malformed sub-values, yields a well-formed config — it validates preset entries (object with string `name` and object `roles`), deduplicates preset names deterministically, and keeps the existing trim/drop rules for assigned values.
- `src/dashboard-plugin/AGENTS.md` sibling rows — the new file needs a purpose row in `packages/shared/src/AGENTS.md` per the Documentation Update Protocol.

**`packages/roles-plugin`** (the package owns its own surface)
- `package.json` — three edits, matching kb-plugin's shape rather than only its manifest key: the `pi-dashboard-plugin` manifest gains `"server": "./src/server/index.ts"`; `exports` gains a `"./server"` entry (roles-plugin currently exports only `"."` and `"./client"`); and `fastify: ^5.0.0` is added to `peerDependencies` + `devDependencies` (roles-plugin currently declares only `react` as a peer). Without the latter two the monorepo may resolve by path while the published package and the typecheck do not.
- `src/server/index.ts` — NEW. Plugin server entry; mounts the route synchronously on `ctx.fastify` during plugin registration, which the host performs before the server begins listening. The plugin does not own or call `listen` — it only registers, exactly as kb-plugin's entry does.
- `src/server/roles-routes.ts` — NEW. `mountRolesRoutes(fastify, deps)` registering `GET /api/roles`. Reads `~/.pi/agent/providers.json` (same path constant posture as `provider-routes.ts`), builds the canonical axis, projects every group. Registered **without** `preHandler: networkGuard`, matching `registerModelsIntrospectionRoute` at `server.ts:1766`.
- `src/client/` — existing `RolesSettingsSection` switches to the shared helpers; no behavioural change.
- `packages/roles-plugin/AGENTS.md` — rows for the two new server files; new `src/server/` directory needs its tree node scaffolded.

**`packages/extension`**
- `src/role-manager.ts` — keeps `activate(pi)`, every `roles:*` handler it registers today (six: `get-all`, `set`, `remove`, `preset-load`, `preset-save`, `preset-delete` — the existing spec prose says "five", which is stale and left untouched here), `saveRoleConfig` (it remains the **sole writer of the role slice**), and the write-through into the active preset. `loadRoleConfig` keeps the file read but delegates normalization to shared `parseRoleConfig`. Its local copies of the pure helpers are replaced by imports from shared. `roles:get-all` output must remain byte-identical for every configuration the current reader already accepts.

**Unaffected**
- `packages/server/src/routes/` — no new file, no edit. The route is plugin-owned.
- CORS needs **no code**: `cors.allowedOrigins` + `isCorsOriginAllowed(configuredOrigins, trustedNetworks)` already exist and are unit-tested. The second frontend's origin is a config entry.
- The `roles:*` WebSocket protocol, `model:resolve`, `role:resolve-model`, and the subagents harness are untouched.

**Security**
- `providers.json` also holds provider credential material. The response SHALL carry role names and model refs only — never `apiKey`s or any sibling key — mirroring `agent-model-introspection`'s "No credential material in responses" requirement. The projection is allowlist-based and field-by-field; the parsed config object is never serialized or spread into the response.
- **Accepted limitation:** the guarantee covers keys *other than* the role and preset maps. A value a user has stored *as a role assignment* is returned verbatim as that role's `ref`. Validating refs against a `provider/model[:level]` grammar and suppressing non-conforming values was considered and rejected: it would let the endpoint silently hide a real assignment the Roles UI still displays, trading a self-inflicted, auth-gated exposure for a cross-surface disagreement.

**Failure behaviour**
- Unlike `/api/models` (which 503s with `MODEL_PROXY_RUNTIME_MISSING` when the model runtime is unresolved), this endpoint has **no runtime dependency**. A missing, empty, or malformed `providers.json` still yields the built-in role names with `ref: null`, so the endpoint never 503s and never returns an empty list.
- "Never fails" must cover **read** failures too, not just parse failures: permission denied, the path resolving to a directory, and removal between an existence check and the read all degrade to "no assignments". Left unhandled these would surface as a 500 and quietly falsify the guarantee.

**Observed but out of scope** (raised in review; neither introduced nor worsened by this read-only change)
- `provider-routes.ts` and `role-manager.ts` both do read-modify-write of `providers.json` for their own key slices, so concurrent writes can lose an update. Pre-existing; a read-only endpoint does not participate.
- The existing `dashboard-roles-ownership` requirement text says "five `flow:role-*` handlers" while the module registers six `roles:*` handlers including `roles:remove`. The stale count is carried verbatim into the MODIFIED block as the delta format requires; a separate existing requirement already governs the `roles:*` registrations. Correcting the count belongs to its own change.

**Tests**
- Unit (shared): axis construction — defaults ∪ `roleNames` ∪ assigned ∪ preset keys, minus `removedRoles`; order stability. `parseRoleConfig` totality — non-object preset entry, preset with non-object `roles`, non-string assigned value, duplicate preset names, missing file contents.
- Unit (roles-plugin server): row projection incl. `ref: null`, `builtin`, thinking-level split; group projection incl. `active`; dangling `activePreset`; duplicate preset names; empty/malformed config; credential-key exclusion (plant a credential in a sibling key and assert it is absent from the serialized body).
- Regression (extension): `roles:get-all` payload unchanged after the helper extraction for every well-formed config. The two declared corrections get their own assertions instead: a config with a structurally invalid preset entry now drops it, and a config with both a removal marker and an assignment for the same role now omits that role.
- Cross-surface: `roles:get-all` and `GET /api/roles` agree on the effective schema and assigned values for the same config.
- Bare-id assignment: `provider` omitted, `ref` verbatim, file untouched.
- Unreadable config (permission denied, path is a directory): `200` with built-ins unassigned, no unhandled error.

**Rollback**: additive. Reverting removes the manifest `server` entry and the two new files; the shared helpers become unreferenced by the server but still serve bridge + client.

## Discipline Skills

- `security-hardening` — the route reads a file that also contains provider credentials and is exposed on an ungated HTTP surface reachable cross-origin. The credential-exclusion boundary and the auth/CORS posture inherited from `/api/models` need an explicit pass.
- `observability-instrumentation` — this adds a new HTTP endpoint; it needs the same logging/error surface the sibling plugin routes have.
- `review-code` — the helper extraction touches three packages and must leave `roles:get-all` byte-identical; a review pass before commit is warranted.

No `performance-optimization` checkpoint (single small file read, no latency budget, no large-data path).
