## Context

See `proposal.md — Why` for motivation. The constraints that shape the approach:

- **Roles are pi-global state, not dashboard config.** They live in `~/.pi/agent/providers.json` under `roles`, `rolePresets`, `activePreset`, plus the `roleNames` / `removedRoles` schema keys. `dashboard-roles-ownership` assigns ownership of those keys to the dashboard extension's `role-manager.ts`.
- **The read model is an overlay, not the raw file.** The effective schema is `(DEFAULT_ROLE_NAMES ∪ roleNames ∪ assigned keys) − removedRoles`. Roles that are built-in but unassigned exist only in the overlay — they are absent from disk. Serving the raw file would silently under-report.
- **`RolePreset` is `{ name, roles: Record<string,string> }`** — a full map, not a single assignment. `roles:preset-load` replaces `cfg.roles` wholesale; `roles:set` writes edits *through* into the active preset. Live roles and the active preset's roles are therefore the same data kept in sync.
- **Plugins can own Fastify routes.** `ServerPluginContext` exposes `fastify: FastifyInstance`, and `kb-plugin` already mounts `/api/kb/*` from `src/server/kb-routes.ts` via a manifest `"server"` entry, explicitly so its surface works without a live pi session.
- **`GET /api/models` is the sibling precedent.** `registerModelsIntrospectionRoute` is registered at `server.ts:1766` **without** `preHandler: networkGuard`, so it inherits only the global dashboard auth gate. CORS is already solved by `cors.allowedOrigins` + the tested `isCorsOriginAllowed(configuredOrigins, trustedNetworks)` helper.
- **`roles-plugin` is client-only today** — its manifest declares `client` and a `settings-section` claim, with no `server` entry and no `configSchema`.

## Goals / Non-Goals

**Goals:**
- One role schema definition shared by the bridge, the plugin server entry, and the plugin client — so the surfaces cannot drift.
- A response a consumer can render as a role×group matrix with zero embedded constants and no conditional shape handling.
- Keep the role HTTP surface inside the roles package, so the package remains the single place a role change is made.

**Non-Goals:**
- Not a general plugin-owned-route framework — that mechanism already exists and is merely being used.
- Not a caching or invalidation design. The config file is small and read per request; no watcher, no memoization. If profiling later shows a need, it is additive.
- Not a change to role resolution, precedence, removal, or the write-through behaviour.

## Decisions

### D1 — The route lives in `packages/roles-plugin`, not `packages/server`

**Chosen:** add `"server": "./src/server/index.ts"` to the roles-plugin manifest; the entry calls `mountRolesRoutes(ctx.fastify, deps)`, mirroring kb-plugin's `mountKbRoutes(ctx.fastify, { knownCwds, registry })`. Mounting is synchronous and happens during plugin registration; the host — not the plugin — owns `listen`, so "register before listening" is a host-ordering guarantee the plugin relies on, not an action the plugin takes.

*Why:* roles are already a package. Putting the route in `packages/server/src/routes/` would split the role surface across two packages, so a future role change would need edits in both. `/api/roles` is also already the plugin's own id namespace, so the path needs no prefix negotiation.

*Alternative — a core route beside `models-introspection-routes.ts`:* rejected. It is marginally simpler for one endpoint but breaks package ownership and would make the roles plugin's boundary meaningless. The kb-plugin precedent shows the plugin path is well-trodden, including tests.

*Consequence (specified):* disabling the roles plugin removes the endpoint. That is correct — the capability belongs to the plugin — and is made explicit as a `404` scenario rather than left implicit.

### D2 — Pure helpers move to `packages/shared`, not into roles-plugin

**Chosen:** `packages/shared/src/role-schema.ts` holds `DEFAULT_ROLE_NAMES`, `effectiveRoleNames`, `overlayRoles`, and the ref/thinking-level split. Filesystem I/O (`loadRoleConfig`/`saveRoleConfig`) and the `roles:*` handlers stay in `role-manager.ts`.

*Why:* the three consumers are the bridge extension (a pi extension), the plugin server entry (Node), and the plugin client (React). `shared` is the only package all three already depend on, and `isValidRoleName` is already there for exactly this bridge↔client reason.

*Alternative — put the core in `roles-plugin` and have the extension import it:* rejected. The bridge would then depend on a React-peer dashboard plugin, inverting the dependency direction across two different runtimes.

*Alternative — duplicate a read-only copy in the plugin:* rejected. Duplication is the precise failure this change exists to prevent; a second copy of `DEFAULT_ROLE_NAMES` would go stale the next time a built-in role is added.

*Constraint:* the helper module must not import `node:fs`, or the client bundle breaks. This is asserted in the spec delta.

### D2a — Split normalization from the file read: pure `parseRoleConfig(raw)`

**Chosen:** shared exports `parseRoleConfig(raw: unknown): RoleConfig`, taking already-parsed data. Each side keeps its own file read (`role-manager.ts` for the bridge, the route for HTTP) and pipes the result through it.

*Why:* three separate problems collapse into this one seam.

1. **Ownership.** `dashboard-roles-ownership` said `role-manager.ts` owns *reads and writes*. Taken literally that forbids the new route. Narrowing it to **sole writer of the role slice**, with a mandatory shared normalizer for every reader, keeps the invariant that actually matters (one writer per key slice, no torn state) without inventing a privileged cross-package reader seam. The narrowing must be per-key, not per-file: `provider-routes.ts` already writes the `providers` key of the same file via tmp+rename while preserving other fields, so a blanket "sole writer of `providers.json`" claim would be false on arrival.
2. **Divergence.** `loadRoleConfig` already normalizes on read — it trims assigned values and drops non-string ones. A second, independently written parser in the route would report different assigned values for the same file, breaking the cross-surface agreement requirement in a way no reviewer would see until it shipped.
3. **Totality.** The current reader blind-casts `rolePresets`, so `[null]` or `{ name: "x", roles: null }` reaches a consumer intact. Today nothing projects preset contents, so it is latent; the moment `/api/roles` projects every preset onto an axis, it throws — and the "always answerable" guarantee is false. `parseRoleConfig` validates preset entries and deduplicates names, so the guarantee holds by construction rather than by hope.

*Cost, stated plainly:* this is the one place the change is **not** behaviour-preserving. `roles:get-all` relays `cfg.rolePresets` uninspected today, so sharing the normalizer drops structurally invalid preset entries that currently reach the client. Claiming byte-identity "for every configuration the current reader accepts" would be false — the current reader accepts `[null]`. The honest scope is: identical for well-formed presets, and a specified, scenario-covered correction for invalid ones, which no consumer could render or load anyway. The alternative — normalizing only in the route — was rejected because it reintroduces exactly the two-parsers divergence this seam exists to remove.

*Also in scope for totality:* the **read** itself can fail independently of the contents — `EACCES`, the path being a directory, or removal between an existence check and the read. Those must degrade to "no assignments" too, or the never-fail guarantee is falsified by a 500 the design never mentioned.

*Alternative — export `loadRoleConfig` itself from shared:* rejected. It performs filesystem access, so the client could not import it, defeating D2.

*Alternative — have the route call into the extension's reader:* rejected. The bridge extension and the dashboard server are different processes; there is no in-process call available.

### D3 — Response is a list of role groups, with `active` per group

**Chosen:**

```jsonc
{ "object": "list",
  "data": [
    { "preset": null,    "active": true,  "roles": [ /* rows */ ] },
    { "preset": "cheap", "active": false, "roles": [ /* rows */ ] }
  ] }
```

*Why:* a preset is the *named* version of a role group and the live map is the anonymous one — the same type, kept in sync by the `roles:set` write-through. Modelling both as "group" makes that structural fact explicit, and keeps the envelope byte-compatible with `/api/models`.

*Alternative — top-level `presets` and `activePreset` siblings beside `data`:* rejected. It breaks the `{object, data}` envelope the consumer is being told to mirror, and re-encodes as two shapes something that is one shape.

*Alternative — omit the live group when a preset is active (it is duplicated):* rejected. A conditional shape forces every consumer to branch. The live group is always present so `data[0]` is unconditionally "current roles"; the redundancy is a few hundred bytes.

### D3a — Normalize invalid active-preset state on read

"Exactly one group is active" is not free — two stored states break it, and both are reachable:

| Stored state | Naive result | Chosen rule |
|---|---|---|
| `activePreset` names no stored preset (dangling) | zero groups active | live group is active; no preset group is |
| two presets share a name | two groups active | collapse to one group — **first entry wins** |

*First-wins is not arbitrary:* `roles:preset-save` upserts by `findIndex(p => p.name === name)`, so the first entry with a given name is the one the existing write path keeps updating. A later duplicate is stale by construction, and last-wins would surface the stale copy.

*Why this matters beyond tidiness:* `roles:set` writes edits through into the active preset **only when the name resolves** (`if (preset)`). So a dangling `activePreset` is precisely the state in which the live map and the named preset genuinely diverge — the invariant that justifies D3's group modelling does not hold there. The endpoint therefore reports the live group as active rather than pointing at a preset that no longer describes current state.

*Rejected — repair the dangling reference by writing `activePreset: null`:* a read endpoint must not write, and `role-manager.ts` remains the sole writer (D2a). The normalization is presentational and per-request.

### D4 — One canonical role-name axis across all groups

**Chosen:** axis = `effectiveRoleNames(cfg) ∪ (keys of every preset)`, minus removal markers, applied to every group.

*Why:* presets persist only what was assigned at save time, so a preset saved before a role existed lacks that key. Projecting each group onto its own keys would yield ragged groups and break matrix rendering; filtering presets to the live schema would silently hide preset data. The union is both uniform and lossless, and it is the same principle the response already applies to unassigned roles — report the name, leave the value null.

*Accepted ambiguity:* "the preset assigns nothing here" and "the preset predates this role" both render as `ref: null`. Distinguishing them would require a per-preset presence flag; for a display consumer the distinction is not actionable.

*Consequence that had to be specified:* the axis is a **superset** of `effectiveRoleNames(cfg)`, because `overlayRoles` does not consider preset keys. An earlier draft of the spec delta asserted the two read surfaces report "the same set of role names", which this design contradicts outright. Two ways to remove the contradiction were available:

- widen `overlayRoles` to include preset keys — rejected, it changes the `roles:get-all` payload and breaks the byte-identical constraint;
- scope the agreement obligation to the **effective schema and assigned values**, and state the preset-only extension explicitly — chosen.

The cross-surface guarantee that consumers actually need is "the surfaces never disagree about a role's assignment", not "the surfaces emit identical name lists".

### D5 — `ref` is always present; decomposed fields are omitted when absent

**Chosen:** `ref: string | null` on every row, always serialized. `model`, `provider`, `thinkingLevel` are omitted when there is no assignment.

*Why:* `ref` is the row's identity and its null-ness is the very state the consumer must render, so it must never be absent — absent and null would otherwise be indistinguishable from a serialization bug. The optional *metadata* follows `/api/models`'s existing omit-when-unknown idiom, and that endpoint likewise returns both the composite `id` and the decomposed `provider`, so pre-splitting is consistent rather than novel.

*`provider` is genuinely optional, not merely omitted-when-convenient.* Role values persisted before provider prefixes were canonical are stored as **bare ids** — the roles-plugin client ships `inferProviderForBareId` precisely to display them, resolving the provider opportunistically against a live models list. The server has no such list. Two options existed: give the route a model-registry dependency to resolve bare ids, or omit `provider` when the ref carries none. The registry dependency was rejected — it would reintroduce exactly the runtime coupling that lets `/api/models` return 503, destroying D6's never-fail property for a cosmetic field. So `provider` is present only when the stored ref actually identifies one, `model` is always derivable (ref minus thinking-level suffix), and the stored value is never rewritten.

### D6 — Never 503, never empty

**Chosen:** a missing/empty/malformed config is treated as "no assignments"; the overlay still yields the built-in names with `ref: null`.

*Why:* unlike `/api/models`, this endpoint has no runtime dependency to be missing — the answer is always computable. A fresh install returning "7 built-ins, all unassigned" is the semantically correct answer, not a degraded one.

*What is genuinely inherited, and what is new.* `loadRoleConfig` already degrades **missing file** and **unparseable JSON** to an empty config, so those two cases are free. Two cases are **not** inherited and must be built: structurally malformed sub-values (D2a — `rolePresets` is blind-cast today), and failures of the read itself (`EACCES`, path is a directory, removal between an existence check and the read). The new route performs its own filesystem read, so it does not inherit any error handling from the extension's reader. Claiming the guarantee "falls out of the existing reader" would be false on both counts.

## Risks / Trade-offs

- **Credential leak from a shared config file** → `providers.json` holds provider credential material alongside roles. The projection is allowlist-based: rows are constructed field-by-field from the role map, never by spreading a parsed config object. Asserted by a dedicated spec requirement and a test that plants a credential and greps the serialized body.
- **The helper extraction changes `roles:get-all`** → the bridge payload is consumed by the shipped client; a subtle behavioural change during the move would break the Roles UI. Mitigated by a regression test asserting the payload is unchanged, and by moving the helpers verbatim rather than rewriting them.
- **A second read surface can drift from the first** → precisely the failure being designed out; both surfaces call the same shared overlay, and a spec scenario asserts they agree on the effective schema, assigned values, and removals.
- **Over-broad "every surface must overlay" wording breaks unrelated surfaces** → the obligation is scoped to surfaces that *enumerate the schema for display*. Resolution surfaces and the deliberately bound-only `list_roles` tool (which omits empty slots by documented design) are explicitly excluded; a universal overlay requirement would have silently made both non-compliant.
- **Ungated read surface widens the attack surface** → mitigated by inheriting the `/api/models` posture exactly (dashboard auth gate, existing origin allowlist) and by the endpoint being read-only with no parameters — there is no `cwd`-style untrusted input to validate, which is the class of guard kb-plugin needed.
- **A credential-like value stored *as a role assignment* is still echoed** → accepted trade-off, documented in the spec. The allowlist stops credential material reaching the response from *adjacent* config keys, which is the realistic exposure; it cannot stop a user from having typed a secret into a role slot, and that value is already displayed by the Roles UI. Suppressing non-conforming refs was rejected because it would make the HTTP surface disagree with the UI about what is assigned — trading a self-inflicted, auth-gated exposure for a silent correctness bug.
- **Package metadata drift between monorepo and published resolution** → the manifest `server` key alone is not the whole kb-plugin shape: kb-plugin also declares an `exports["./server"]` entry and `fastify` in both `peerDependencies` and `devDependencies`. roles-plugin currently declares neither, and only `react` as a peer. The monorepo may resolve the entry by path regardless, masking the gap until publish or typecheck. All three edits land together.
- **Plugin-owned route means the endpoint disappears if the plugin is disabled** → accepted and specified as a `404`, rather than surprising a consumer with a silent absence.

## Migration Plan

Purely additive; no data migration and no config migration.

1. Land the shared helpers and repoint `role-manager.ts` + the plugin client at them. `roles:get-all` must be unchanged — this step is behaviour-preserving on its own.
2. Add the plugin `server` entry and the route. The endpoint appears; nothing else changes.
3. Add the consuming frontend's origin to `cors.allowedOrigins` (configuration, not code).

**Rollback:** revert steps 2 then 1. Removing the manifest `server` entry removes the endpoint; the shared helpers remain valid for the bridge and client. No persisted artifact is created, so nothing needs cleaning up.

## Open Questions

- Should the response expose a `schemaVersion` for future shape evolution? Deferrable: adding a top-level field later is backward-compatible for consumers reading `data`, and does not affect the specs, the approach, or the task breakdown.
