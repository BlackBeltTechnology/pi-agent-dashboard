## Context

The dashboard owns roles + model resolution (specs `dashboard-roles-ownership`, `dashboard-model-resolution`) but exposes them only via WebSocket messages driven by the human Settings UI (`RolesSettingsSection.tsx`). An in-session agent has no way to see or wire roles/models.

Two live resolvers exist plus one deprecated:
- `model:resolve` (provider-register.ts) — full resolver: `@role` → literal → `registry.find` → `Model` + `auth`. Primary.
- `role:resolve-model` (role-manager.ts) — narrow adapter for the `pi-dashboard-subagents` harness: `@role` → literal string only, stops there (lenient).
- `flow:resolve-model` (provider-register.ts) — deprecated alias, no `@role`.

Session-log evidence (prior "model resolve wrong" session) established the real resolution bug: `getModelRegistry()` falls back to `pi.modelRegistry`, which does **not exist** on `ExtensionAPI` in pi-coding-agent 0.80 (only on `ExtensionContext`). In spawned/headless subagent sessions `modelRegistryRef` is never captured, the fallback yields `undefined`, and resolution fails uniformly — even for models the session runs. The registry itself holds ~1000 models; the handle is the problem. The current `dashboard-model-resolution` spec actively *mandates* this dead fallback, so this change corrects the spec.

The role-name set is a hardcoded `DEFAULT_ROLE_NAMES` const overlaid at read time (`overlayDefaultRoles`), making defaults un-removable — blocking user-defined roles.

## Goals / Non-Goals

**Goals:**
- Two agent-facing tools: `list_roles` (read) and `update_roles` (write, confirmed, action-dispatched).
- Editable role-name schema; new roles surface as empty slots across all presets; removal purges.
- Consolidate resolution onto `model:resolve`: single `lookupRole()` accessor; `role:resolve-model` demoted to a one-release alias (legacy `probe.resolved` string-consumers only).
- Fix the dead registry handle so `model:resolve` works in spawned/headless sessions (the actual "resolution is still an issue").
- Delete the subagents harness's own dead `pi.modelRegistry` fallback; bump its installed build (it already emits `model:resolve` / reads `probe.model`).

**Non-Goals:**
- Per-session role scoping — roles stay global in `providers.json`.
- Changing `agent-model-introspection`'s `GET /api/models` requirements; that REST surface stays for out-of-process/HTTP callers.
- Keeping any `flow:role-*` compatibility alias — the rename is atomic (no external emitters).

## Decisions

**D0. `list_models` is a TOOL (in-process Registry #1), added alongside the existing REST surface.** `GET /api/models` + the `dashboard-list-models` slash command already exist but read the dashboard server's registry (Registry #2) over HTTP. The tool reads the session's own registry (Registry #1) in-process, so its `ref`s are guaranteed consistent with what `set_role` persists and `model:resolve` resolves — and it matches the human ModelSelector exactly. The tool SUPERSEDES `dashboard-list-models` for in-session agents; the REST endpoint + command stay for out-of-process/HTTP consumers. *Alt:* reuse the command only — rejected (Registry #2 can drift from the session's actual registry). *Alt:* retire the command — rejected (still needed for browser/external).

**D1. Three tools; read/write split AND model/role decouple.** `list_models` (read), `list_roles` (read), `update_roles` (dispatched write). A safe read and a global-mutating write behind one call would muddy the schema + confirmation story (write split). Model listing is a lower-level primitive with an independent failure mode from roles — an agent may want the catalogue when roles are absent/unconfigured/malformed — so `list_models` is its own tool that never touches the role slice (model/role decouple). *Alt considered:* bundle models into `list_roles` (a single read) — rejected: couples model listing to role-slice health, so a malformed `providers.json#roles` would break model discovery too. *Alt:* single `roles` tool with a mode flag — rejected (conflates safety tiers).

**D2. `update_roles` uses a discriminated `action` schema.** Mirrors the repo's existing `ask_user` discriminator pattern (`ask-user-schema-discriminator.test.ts`) — clean per-action arg shapes instead of a bag of optionals. Actions: `set_role`, `remove_role`, `create_preset`, `load_preset`, `delete_preset`.

**D3. Global writes require `ask_user` confirmation.** `providers.json` is shared by every session/process; a silent rebind of `coding` hits all of them. Confirm each mutating action. *Alt:* silent writes — rejected (blast radius). *Alt:* per-session role store — rejected (Non-Goal; large).

**D4. `set_role` on a new name implicitly creates the role; only removal needs a dedicated action.** Fewer actions, matches natural agent phrasing. `preset?` optional arg lets the agent wire a named preset without loading it first — making today's implicit "active preset gets mirrored" behavior explicit.

**D5. Role-name schema is shared across presets (Model 1), not per-preset bags.** Roles are resolution targets that flows/agent configs depend on; a role must mean the same thing regardless of active preset. Adding a role surfaces an empty slot everywhere. *Alt (Model 2):* independent per-preset key bags — rejected (`@role` could silently vanish on preset switch, breaking configs).

**D6. `remove_role` purges from every preset (confirmed).** Orphaned bindings confuse the next reader and re-appear unexpectedly. *Alt:* orphan/recoverable dead data — rejected (cruft, surprise).

**D12. Consolidate custom providers onto pi-native `models.json` (the root cleanup).** pi has no `/v1/models` discovery; its custom-model persistence is `models.json` (read by `ModelRegistry.create` in every session/flow/subagent). NOTE (corrected by D16): the dashboard SERVER does NOT use pi's `ModelRegistry` — it has a bespoke `InternalRegistry` reading a different `models.json` shape, so the server reader must be reworked too, not merely fed. The dashboard instead kept customs in its own `providers.json` (pi-invisible) + ephemeral runtime `registerProvider` (session-only), causing the divergence (server/`GET /api/models` shows zero customs), the async-discovery race (`preRegisterProviderAuth` workaround), and the registry juggling. Fix: after discovery+enrichment, WRITE customs to `models.json` (merge-not-clobber, atomic); let pi load them natively everywhere. Discovery stays (pi lacks it, and hand-authoring model lists is poor UX) but its OUTPUT is persisted, not just injected. *Alt:* teach the server to do `/v1/models` discovery too — rejected (duplicates discovery in two processes; still no cross-session persistence). *Alt:* keep runtime `registerProvider` only — rejected (root cause of every divergence bug).

**D16. The dashboard SERVER does NOT use pi's `ModelRegistry` — its bespoke `InternalRegistry` reads a DIFFERENT `models.json` shape. (Cross-model doubt finding, verified.)** `registry-singleton.ts:37-43` `readModels()` expects a flat top-level `models: []` (or bare array), NOT pi's canonical `{providers:{<name>:{models:[...]}}}` (`internal-registry.ts:149` consumes `CustomModelEntry[]`, resolving `baseUrl` from `providers.json#providers` — empty post-migration). So writing pi-schema `models.json` feeds pi sessions/flows/subagents (which DO use `ModelRegistry.create`) but the server would still see zero customs and any it did see would get `baseUrl=""`. **Consolidation MUST also rework the server: parse pi-schema `models.json` (provider `baseUrl`/`api` + its `models[]`).** Without this, `GET /api/models` stays empty and the CONTRACT is violated. Regression gate: `internal-registry` + `models-introspection-routes` tests.

**D17. `models.json` writes are SINGLE-OWNER / change-triggered, NOT per-session-startup. (Cross-model doubt finding, verified.)** Every pi session runs the extension; if each did a read-modify-write of `models.json` at startup, concurrent sessions race (`loadModelsJson`→merge→`saveModelsJson` is not locked) and last-writer-wins silently drops providers. Writes MUST happen only on a provider add/edit/remove (a discrete user action), owned by a single writer. OPEN: server-owned (move `/v1/models` discovery server-side, write on the existing provider-routes CRUD) vs extension-owned-with-lock. Resolve before 0.3. Per-session startup only READS `models.json` (via pi's registry) — never writes.

**D18. Keep `preRegisterProviderAuth`; migration is write-verify-then-strip. (Cross-model doubt findings.)** `preRegisterProviderAuth` stays: a NEWLY-added provider is absent from `models.json` until its ~10s async `/v1/models` discovery completes, so the sync auth pre-registration is still needed to close the spawn window for new providers (removing it reintroduces the race). Migration ordering: write+`ModelRegistry`-verify `models.json` FIRST, only then strip `providers` from `providers.json`; back up both; on any failure, restore from backup (crash between the two writes must not lose providers).

**D13. Keep discovery + `registerProvider` as a fast-path; `models.json` is the durable source.** Runtime `registerProvider` MAY remain for immediate in-session effect after a UI edit, but the write to `models.json` is what makes customs durable + cross-process. This preserves the snappy UX while fixing persistence. Regression guard: existing tests (`build-provider-catalogue`, `custom-provider-apikey-roundtrip`, `enrich-model-metadata`, `internal-registry`, `provider-routes*`) must stay green.

**D15. Track dashboard-managed providers in `providers.json#managedProviders`, keep `models.json` pure-pi-schema.** Merge-not-clobber needs to distinguish dashboard-written providers from hand-authored ones. pi's TypeBox `models.json` schema tolerates extra keys (verified: no `additionalProperties:false` on `ProviderConfigSchema`/`ModelDefinitionSchema`), but polluting pi's user-facing file with a `_dashboardManaged` marker is ugly. Instead, the dashboard records the set of provider names it owns in its OWN file `providers.json#managedProviders: string[]` (which already survives migration holding roles). The `models.json` writer upserts only names in that set and never touches providers absent from it (hand-authored preserved). *Alt:* marker key in models.json — rejected (writes non-pi keys into pi's file). *Alt:* diff by heuristics — rejected (fragile).

**D14. Auto-migration script, idempotent, backed-up.** A one-time script moves `providers.json#providers` → `models.json#providers` (discover+enrich), strips `providers` from `providers.json`, preserves `roles`/`rolePresets`/`activePreset`, backs up both files, and no-ops on re-run. Roles stay in `providers.json` (dashboard-specific; pi never reads them).

**D7. Registry-handle fix = acquire `ctx.modelRegistry`, drop the dead fallback (Option A). This is sufficient — Option B (threading) is NOT needed to fix the bug.** Resolution runs in the PARENT session: the harness's `resolveModelFromRef` fires on a mid-session tool call (long after the parent's `session_start`), emits `model:resolve` on the parent's bus, and reads back `probe.model`; the resolved `Model` is then passed into `createAgentSession` and the child never resolves itself. So a registry IS available parent-side — the bug was only that the dashboard's `getModelRegistry()` reached for the dead `pi.modelRegistry` (via a `(piRef as any)` cast) when `modelRegistryRef` hadn't been captured. Fix: capture `ctx.modelRegistry` across the parent's lifecycle points, drop the dead fallback, so `probe.model` fills reliably. *Alt (Option B):* resolve fully in the parent and thread `Model`+`auth` into the spawn so the child needs no registry — architecturally cleaner but unnecessary here (no registry-less resolve exists in the real flow); filed as a deferred insurance task only.

**D8. No `probe.resolved` leniency reorder — subagents read `probe.model`, not `probe.resolved`.** The harness (verified in source) reads `probe.model` (a real registry-resolved Model), then `probe.error`; it never reads `probe.resolved`. A lenient string therefore does nothing for it — the fix must fill `probe.model`, which D7 does. Setting `probe.resolved` early would only benefit a *legacy* `role:resolve-model` string-consumer, which the deprecated alias already covers. Dropped from scope. *Alt considered:* keep the early-`probe.resolved` assignment for cold-start string survival — rejected (no current consumer reads it; adds surface for nothing).

**D9. `role:resolve-model` kept one release as a thin alias over the shared resolve path.** Same one-release pattern already used for `flow:resolve-model`; avoids a flag day where an un-migrated subagents build hard-fails. Delete at next major.

**D11. Atomic `flow:role-*` → `roles:*` rename, no alias; delete `flow:resolve-model` now.** Roles are 100% dashboard-owned; the `flow:` prefix is a cosmetic legacy holdover from when the code lived in pi-flows. pi-flows now has zero role code, and every `flow:role-*` emitter (bridge.ts, ~11 sites) and handler (role-manager.ts, 5) is in-repo, so there is no external producer to break — the base spec's "preserve for one release" shim is obsolete and its window expired. Rename all producers + consumers in one commit; no `flow:` alias retained. `flow:resolve-model` (deprecated, replacement `model:resolve`, zero in-repo emitters) is deleted in the same pass rather than deferred. *Contrast with D9:* `role:resolve-model` DOES keep a one-release alias because it has a known external consumer (older installed subagents-harness builds); `flow:role-*` has none. *Alt:* keep `flow:` aliases one release — rejected (no consumer to protect; keeps dead surface).

**D10. Single `lookupRole()` accessor.** The `@role` → `providers.json#roles[name]` lookup is currently duplicated (`getModelRole()` vs `loadRoleConfig().roles[name]`). Collapse into one accessor consumed by the resolver, the alias, and both tools — no fourth independent reader.

## Risks / Trade-offs

- **Agent mutates global machine config** → `ask_user` confirmation on every write (D3); `security-hardening` review of the gate + blast radius.
- **Subagents harness/dashboard version coupling** → one-release `role:resolve-model` alias (D9); no lockstep flag day.
- **Editable schema breaks the UI's never-empty overlay** → overlay must key off the effective schema (defaults minus removals), not the hardcoded const; covered in tasks + `RolesSettingsSection` tests.
- **Removal markers vs. "defaults re-inject on read"** → need a way to record that a default was removed so the read-time overlay does not re-add it; simplest is a persisted schema/removed-set, resolved during design of the accessor.
- **Custom-provider async discovery races** → resolution is parent-side and mid-session; `preRegisterProviderAuth` (KEPT, D18) covers the newly-added-provider window until discovery + `models.json` write complete.
- **Concurrent `models.json` writers (TOCTOU)** → single-owner/change-triggered writes (D17); per-session startup never writes. Verified cross-model finding.
- **Server sees a different `models.json` shape** → rework server `InternalRegistry`/`readModels` to pi schema (D16); gated by `internal-registry` + `models-introspection-routes` tests.
- **`refresh()` wipes global pi-ai state during `unregisterProvider`** → module-level singletons shared across same-process sessions; a reload window can transiently drop auth. Likely pre-existing; document + avoid triggering during discovery.
- **Migration crash between strip + write** → write+verify `models.json` FIRST, then strip `providers.json`; backups + restore-on-failure (D18).

## Migration Plan

0. Consolidate custom providers onto `models.json`: add the writer (done), rework the SERVER `InternalRegistry`/`readModels` to pi schema (D16), make writes single-owner/change-triggered (D17), KEEP `preRegisterProviderAuth` (D18), ship the write-verify-then-strip migration (D18).
1. Land the registry-handle cleanup (`ctx.modelRegistry` capture, drop dead cast) — corollary of consolidation.
2. Add `lookupRole()`; route resolver + alias + tools through it.
3. Add `list_roles` / `update_roles` tools; editable schema + purge.
4. Delete the harness's dead `pi.modelRegistry` fallback + bump its build. Keep `role:resolve-model` as a deprecated alias for legacy harness builds.
5. Rename `flow:role-*` → `roles:*` atomically across `bridge.ts` (emitters) + `role-manager.ts` (handlers) + comments (`App.tsx`, `provider-register.ts`) + tests, in one commit; delete `flow:resolve-model`.
6. Next major: delete `role:resolve-model`.

Rollback: tools and alias are additive; reverting the extension restores prior behavior. The registry-handle fix is a strict correction (dead code removed) — low rollback risk.

## Open Questions

- **Who owns `models.json` writes (D17): server-owned (move `/v1/models` discovery server-side, write on provider-routes CRUD) vs extension-owned-with-lock? RESOLVE before task 0.3.** Server-owned is cleaner (single process, no cross-session race, already handles provider CRUD) but moves discovery; extension-owned needs a cross-session file lock.
- Exact persistence shape for the editable role-name schema + removal markers (new `roleNames` array? a `removedRoles` set?) — resolve when implementing `lookupRole()`.
- Whether `managedProviders` bookkeeping belongs in `providers.json` (D15) or should be derivable/self-healing to avoid the empty-set stale-accumulation hazard (Bug 8).
- Confirmation UX for batch wiring (agent setting 6 roles) — one confirm per action is safe but chatty; a single batched confirm is out of scope for v1.
