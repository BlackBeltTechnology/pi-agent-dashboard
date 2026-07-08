## 1. Registry-handle bugfix (Option A)

- [ ] 1.1 Write a failing test reproducing the resolution failure: when `modelRegistryRef` is unpopulated and the handler falls back to the (non-existent) `pi.modelRegistry`, `probe.model` is never filled and `probe.error` fires for a known model.
- [ ] 1.2 Remove the dead `(piRef as any)?.modelRegistry` fallback in `getModelRegistry()` (provider-register.ts); source the registry only from `ctx.modelRegistry`-captured `modelRegistryRef`.
- [ ] 1.3 Ensure `modelRegistryRef` is reliably captured from `ctx.modelRegistry` across the parent session's lifecycle points (`session_start`, `model_select`) so `probe.model` fills for parent-side resolution (the harness's `resolveModelFromRef` runs mid-parent-session).
- [ ] 1.4 Confirm `model:resolve` fills `probe.model` (primary output) for `@role` and literal refs; on a registry miss set `probe.error` and leave `probe.model` unset. (No early-`probe.resolved` leniency — the harness reads `probe.model`.)
- [ ] 1.5 Update `dashboard-model-resolution` tests: dead-fallback gone, `probe.model` fills for known model, registry miss sets `probe.error`. Verify `npm test` for the extension package.

## 2. Single `lookupRole()` accessor

- [ ] 2.1 Add a single role-slice accessor in `role-manager.ts` (e.g. `lookupRole(ref): { literal?: string; reason?: string }`) that strips a leading `@`, re-reads disk, and returns the mapped literal or a structured not-configured reason.
- [ ] 2.2 Route `model:resolve` (`@role` path) through `lookupRole()`; remove the duplicate `getModelRole()`/inline read where redundant.
- [ ] 2.3 Route the `role:resolve-model` handler through `lookupRole()`; preserve its `probe.resolved`/`probe.available`/`probe.reason` contract; annotate `// DEPRECATED → model:resolve`, removed next major.
- [ ] 2.4 Tests: `lookupRole()` unit coverage (bare/`@`/unset/cross-session-edit); both resolvers still pass their existing scenarios via the shared accessor.

## 3. Editable role-name schema

- [ ] 3.1 Decide + implement the persisted schema shape for user-added/removed role names (resolve design Open Question: `roleNames` and/or `removedRoles`), preserving unrelated `providers.json` keys via atomic tmp+rename.
- [ ] 3.2 Update the read-time overlay so it keys off the effective schema (defaults ∪ added − removed) instead of the hardcoded const; a removed default is NOT re-injected.
- [ ] 3.3 Implement purge-on-remove: remove a role from the schema, the active roles map, and every preset in one atomic write.
- [ ] 3.4 Update `RolesSettingsSection.tsx` so the never-empty overlay + setup banner track the effective schema (added roles appear as empty slots in every preset; removed defaults disappear).
- [ ] 3.5 Tests: overlay with adds/removes; purge clears all presets; `RolesSettingsSection` renders effective schema; unrelated keys preserved.

## 4. `list_models` + `list_roles` tools (read, decoupled)

- [ ] 4.1 Register `list_models` via `pi.registerTool`; source models from the IN-PROCESS session registry (`cachedModelRegistry.getAvailable()` + reuse `toModelInfo`), NOT the server `registry-singleton`. Emit a ready-to-assign `ref` per model + capability metadata.
- [ ] 4.2 Make `list_models` fully roles-independent: it MUST NOT read `providers.json#roles` and MUST succeed when the role slice is missing/malformed.
- [ ] 4.3 (Optional, per Open Question) support `annotated` mode on `list_models` surfacing `excludedReason` for reachable-filtered models.
- [ ] 4.4 Register `list_roles` via `pi.registerTool`; return `{ roles(bound-only), presets, activePreset }` (NO models key); filter unset roles (empty-slot omission for the tool only; UI overlay unchanged); tolerate missing/malformed role slice → empty result.
- [ ] 4.5 Tests: `list_models` refs assignable + works with roles absent + custom-provider ref present; `list_roles` bound-only + presets/activePreset + no `models` key + tolerates malformed slice.

## 5. `update_roles` tool (write, confirmed, dispatched)

- [ ] 5.1 Register `update_roles` via `pi.registerTool` with a discriminated `action` schema (`set_role`/`remove_role`/`create_preset`/`load_preset`/`delete_preset`).
- [ ] 5.2 Gate every mutating action behind `ask_user` confirmation; on decline return `{ success: false }` and do NOT write.
- [ ] 5.3 `set_role { role, ref, preset? }`: implicit-create on new name; `preset` targets a named preset without loading it; omitted → active map (mirror into active preset per existing behavior).
- [ ] 5.4 Wire `remove_role`/`create_preset`/`load_preset`/`delete_preset` through the shared accessor + atomic write; return `{ success, error? }`.
- [ ] 5.5 Tests: confirm-gate (accept/decline), implicit create, preset-target write, purge on remove, unrelated-key preservation.

## 6. Subagents harness cleanup + consolidation close-out

- [ ] 6.1 Delete the dead `pi.modelRegistry` fallback in `@blackbelt-technology/pi-dashboard-subagents` (`extensions/agent.ts` `getModelRegistry`); it already emits `model:resolve` and reads `probe.model`, so no emit migration is needed. Bump + reinstall the harness build.
- [ ] 6.2 Verify end-to-end: a subagent with `model: "@role"` (built-in AND custom-provider) spawns and resolves via `model:resolve` → `probe.model` in the parent session.
- [ ] 6.3 Keep `role:resolve-model` alias registered this release (legacy harness builds); add a code comment + changelog note scheduling its removal (and `flow:resolve-model`'s) at next major.
- [ ] 6.4 Follow-up (Option B, deferred insurance): thread the resolved `Model`+`auth` object through the spawn so the child needs no registry — file as a separate change; not required to fix this bug.

## 7. Gates

- [ ] 7.1 `npm run quality:changed` clean (Biome + tsc + tests).
- [ ] 7.2 Run `eng-disciplines` checkpoints: `systematic-debugging` (task 1 repro), `security-hardening` (task 5 confirm-gate/blast-radius), `doubt-driven-review` (before the alias/harness contract lands).
- [ ] 7.3 Code-review gate on the diff before commit.
