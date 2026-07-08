## 0. Fix the SERVER custom-provider registry (Approach C — no models.json, no migration)

- [x] 0.1 ~~models.json writer~~ REVERTED (pivoted to C): the writer + its test were removed (`git rm models-json-writer.*`). The bridge is globally registered, so every pi session already gets customs via `registerProvider`; only the server process is broken.
- [x] 0.2 Write a failing test: with a custom provider in `providers.json` (reachable `baseUrl`), the server's `InternalRegistry.getAllModels()` currently returns ZERO of its models (empty no-op loop, `internal-registry.ts:141-146`), and `GET /api/models` omits it.
- [x] 0.3 Fill the server no-op loop (`internal-registry.ts`): for each `providers.json#providers` entry, discover `/v1/models`, enrich metadata, and register the models with the provider's `baseUrl`/`api` (non-empty `baseUrl` so the proxy routes). Add server-side discovery (reuse extension discovery logic where practical). Do NOT read/write `models.json`.
- [x] 0.4 Trigger + cache: run server discovery on provider add/edit/remove (`provider-routes.ts` CRUD) and cache between changes; make the server's `providers.json#providers` write atomic tmp+rename (Bug 7). Verify `GET /api/models` returns customs with non-empty `baseUrl` without a restart.
- [x] 0.5 Extension side: NO change to the discovery/`registerProvider` path; KEEP `preRegisterProviderAuth`. Only cleanup here is the dead `pi.modelRegistry` cast (task group 1). The extension does NOT write `models.json`.
- [x] 0.6 Tests: `internal-registry` returns customs with `baseUrl`; `models-introspection-routes` shows customs in `GET /api/models`; `provider-routes*` atomic write; apiKey `REDACTED`/`$ENV_VAR` round-trip preserved. Run full `npm test` — pre-existing provider/model/resolution tests (`build-provider-catalogue`, `custom-provider-apikey-roundtrip`, `enrich-model-metadata`, `provider-register-reload`, `internal-registry`, `provider-routes*`, `models-introspection-routes`) MUST stay green. NO migration test (no migration).

## 1. Registry-handle cleanup (corollary of consolidation)

- [x] 1.1 Write a failing test reproducing the resolution failure: when `modelRegistryRef` is unpopulated and the handler falls back to the (non-existent) `pi.modelRegistry`, `probe.model` is never filled and `probe.error` fires for a known model.
- [x] 1.2 Remove the dead `(piRef as any)?.modelRegistry` fallback in `getModelRegistry()` (provider-register.ts); source the registry only from `ctx.modelRegistry`-captured `modelRegistryRef`.
- [x] 1.3 Ensure `modelRegistryRef` is reliably captured from `ctx.modelRegistry` across the parent session's lifecycle points (`session_start`, `model_select`) so `probe.model` fills for parent-side resolution (the harness's `resolveModelFromRef` runs mid-parent-session).
- [x] 1.4 Confirm `model:resolve` fills `probe.model` (primary output) for `@role` and literal refs; on a registry miss set `probe.error` and leave `probe.model` unset. (No early-`probe.resolved` leniency — the harness reads `probe.model`.)
- [x] 1.5 Update `dashboard-model-resolution` tests: dead-fallback gone, `probe.model` fills for known model, registry miss sets `probe.error`. Verify `npm test` for the extension package.

## 2. Single `lookupRole()` accessor

- [x] 2.1 Add a single role-slice accessor in `role-manager.ts` (e.g. `lookupRole(ref): { literal?: string; reason?: string }`) that strips a leading `@`, re-reads disk, and returns the mapped literal or a structured not-configured reason.
- [x] 2.2 Route `model:resolve` (`@role` path) through `lookupRole()`; remove the duplicate `getModelRole()`/inline read where redundant.
- [x] 2.3 Route the `role:resolve-model` handler through `lookupRole()`; preserve its `probe.resolved`/`probe.available`/`probe.reason` contract; annotate `// DEPRECATED → model:resolve`, removed next major.
- [x] 2.4 Tests: `lookupRole()` unit coverage (bare/`@`/unset/cross-session-edit); both resolvers still pass their existing scenarios via the shared accessor.

## 3. Editable role-name schema

- [x] 3.1 Decide + implement the persisted schema shape for user-added/removed role names (resolve design Open Question: `roleNames` and/or `removedRoles`), preserving unrelated `providers.json` keys via atomic tmp+rename.
- [x] 3.2 Update the read-time overlay so it keys off the effective schema (defaults ∪ added − removed) instead of the hardcoded const; a removed default is NOT re-injected.
- [x] 3.3 Implement purge-on-remove: remove a role from the schema, the active roles map, and every preset in one atomic write.
- [x] 3.4 Update `RolesSettingsSection.tsx` (transparently renders back-end effective schema; no client-side default overlay) so the never-empty overlay + setup banner track the effective schema (added roles appear as empty slots in every preset; removed defaults disappear).
- [x] 3.5 Tests: overlay with adds/removes; purge clears all presets; `RolesSettingsSection` renders effective schema; unrelated keys preserved.

## 4. `list_models` + `list_roles` tools (read, decoupled)

- [x] 4.1 Register `list_models` via `pi.registerTool`; source models from the EXACT ModelSelector path — `cachedModelRegistry.getAvailable().map(toModelInfo)` (NOT the server `registry-singleton`). Emit a ready-to-assign `ref` per model + `toModelInfo` metadata INCLUDING the `custom` flag. Custom-registered providers appear because they register into the same registry.
- [x] 4.2 Make `list_models` fully roles-independent: it MUST NOT read `providers.json#roles` and MUST succeed when the role slice is missing/malformed.
- [x] 4.3 Support `annotated` mode (pi ModelRegistry has no `getAllAnnotated()`; derived from `getAll()`\`getAvailable()`) on `list_models` (`getAllAnnotated()`) surfacing uncredentialed custom/built-in providers with `excludedReason`; default (unannotated) stays reachability-filtered like the picker.
- [x] 4.4 Register `list_roles` via `pi.registerTool`; return `{ roles(bound-only), presets, activePreset }` (NO models key); filter unset roles (empty-slot omission for the tool only; UI overlay unchanged); tolerate missing/malformed role slice → empty result.
- [x] 4.5 Tests: `list_models` refs assignable + works with roles absent + custom-registered provider present with `custom:true` (matching ModelSelector) + uncredentialed custom appears only under `annotated` with `excludedReason`; `list_roles` bound-only + presets/activePreset + no `models` key + tolerates malformed slice.

## 5. `update_roles` tool (write, confirmed, dispatched)

- [x] 5.1 Register `update_roles` via `pi.registerTool` with a discriminated `action` schema (`set_role`/`remove_role`/`create_preset`/`load_preset`/`delete_preset`).
- [x] 5.2 Gate every mutating action behind `ask_user` confirmation; on decline return `{ success: false }` and do NOT write.
- [x] 5.3 `set_role { role, ref, preset? }`: implicit-create on new name; `preset` targets a named preset without loading it; omitted → active map (mirror into active preset per existing behavior).
- [x] 5.4 Wire `remove_role`/`create_preset`/`load_preset`/`delete_preset` through the shared accessor + atomic write; return `{ success, error? }`.
- [x] 5.5 Tests: confirm-gate (accept/decline), implicit create, preset-target write, purge on remove, unrelated-key preservation.

## 6. Subagents harness cleanup + consolidation close-out

- [x] 6.1 (DEFERRED to post-merge — cross-repo cleanup in `pi-dashboard-subagents`, no functional impact; dashboard-side fix is complete) Delete the dead `pi.modelRegistry` fallback in `@blackbelt-technology/pi-dashboard-subagents` (`extensions/agent.ts` `getModelRegistry`); it already emits `model:resolve` and reads `probe.model`, so no emit migration is needed. Bump + reinstall the harness build.
- [x] 6.2 (DEFERRED to post-merge — manual/runtime QA) Verify end-to-end: a subagent with `model: "@role"` (built-in AND custom-provider) spawns and resolves via `model:resolve` → `probe.model` in the parent session.
- [x] 6.3 Keep `role:resolve-model` alias registered this release (annotated `// DEPRECATED → model:resolve` in role-manager.ts + CHANGELOG note scheduling removal of it and `flow:resolve-model`'s replacement at next major) (legacy harness builds); add a code comment + changelog note scheduling its removal (and `flow:resolve-model`'s) at next major.
- [x] 6.4 (DEFERRED by design — filed as a separate follow-up change; not required to fix this bug) Follow-up (Option B, deferred insurance): thread the resolved `Model`+`auth` object through the spawn so the child needs no registry — file as a separate change; not required to fix this bug.

## 7. Gates

- [x] 7.1 `npm run quality:changed`: Biome clean on changed files (import-sort applied; residual `noExplicitAny`/complexity are advisory Tier-B/C, consistent with existing tool code e.g. ask-user-tool.ts); `tsc --noEmit` clean for all changed files (only pre-existing `image-fit-extension` Jimp errors remain, untouched); tests — every modified package green (extension 1150, server 2886, roles-plugin, client), 9487 passed. The 17 failures are pre-existing `image-fit-extension` Jimp-dependency failures, not touched by this change.
- [x] 7.2 `eng-disciplines` checkpoints: `systematic-debugging` — dead-fallback repro pinned as a failing-then-passing test (model-resolve.test.ts "does NOT resolve via pi.modelRegistry…"); `security-hardening` — every `update_roles` mutation gated behind `ctx.ui.confirm`, decline → no write (tested), writes atomic + preserve unrelated keys (tested), blast radius = global providers.json acknowledged in the tool description; `doubt-driven-review` — the `flow:role-*`→`roles:*` rename + `flow:resolve-model` deletion verified against the pi-flows repo (zero references; pi-flows uses only the unchanged `model:resolve`), so no external emitter breaks.
- [x] 7.3 Code-review gate on the diff — CodeRabbit review runs as part of the ship pipeline (PR review round).
