## Why

The dashboard owns roles and model resolution (`dashboard-roles-ownership`, `dashboard-model-resolution`), but exposes them only through WebSocket messages driven by the human Settings UI. An agent running *inside* a session is blind: it cannot see which roles exist, what they bind to, or which model refs are assignable, and it cannot wire a role or preset.

Underneath the tools sits a model-handling defect, but it is narrower than it first appears. The dashboard's bridge extension is registered in pi's GLOBAL settings (`~/.pi/agent/settings.json packages[]`), so EVERY pi run — interactive, flows, subagents, even a standalone `pi` CLI — loads it and gets custom providers via `pi.registerProvider()` (pi's intended extension path) after a live `/v1/models` fetch of `providers.json#providers`. The ONE consumer that is NOT a pi session, and therefore never runs the extension, is the dashboard SERVER process: its bespoke `InternalRegistry` reads `providers.json#providers` but its custom-provider loop is an empty no-op (it defers to a `models.json` that is empty), so `GET /api/models` and the model-proxy show ZERO custom models. Additionally the resolver code grew a `modelRegistryRef` cache plus a dead `pi.modelRegistry` fallback (a property absent from `ExtensionAPI` in 0.80). The fixed default role-name set is also un-removable by construction, blocking user-defined roles.

This change consolidates the custom-provider registry the pi-idiomatic way: the server discovers `/v1/models` and registers custom providers into its own `InternalRegistry` from `providers.json` (the dashboard's store, unchanged), so the server matches every pi session. It does NOT write pi's user-owned `models.json` — that was based on the false premise that some pi consumer lacks the bridge; none does. Then it layers the agent tools + editable roles on top.

## What Changes

- Add three agent-facing tools (registered via `pi.registerTool` in the dashboard extension), roles and models DECOUPLED so model listing works even when roles are absent/unconfigured/malformed:
  - `list_models` — read: returns `[{ ref, provider, id, reasoning, input, contextWindow, cost }]` from the in-process session registry, where `ref` is the exact `"provider/modelId"` literal assignable via `update_roles`. Independent of the role slice; SHALL succeed even if `providers.json#roles` is missing or malformed.
  - `list_roles` — read: returns `{ roles (bound-only), presets, activePreset }`. NO models slice. Unset role slots are omitted from the tool output (human UI keeps the empty-slot overlay).
  - `update_roles` — write, action-dispatched (discriminated schema): `set_role { role, ref, preset? }`, `remove_role { role }`, `create_preset { name }`, `load_preset { name }`, `delete_preset { name }`. `set_role` on a new role name creates it (implicit add). Every write requires an `ask_user` confirmation because it mutates the global `~/.pi/agent/providers.json` shared by all sessions.
- Make the role-name set editable: replace the hardcoded `DEFAULT_ROLE_NAMES`-as-const behavior with a user-editable role-name schema. A new role surfaces as an empty slot in every preset (resolution targets stay stable across presets). `remove_role` **purges** the role from every preset (with confirmation).
- **Fix the server's custom-provider registry (the real gap):**
  - The dashboard SERVER discovers `/v1/models` for each `providers.json#providers` entry, enriches metadata, and registers them into its `InternalRegistry` (fix the empty no-op loop in `internal-registry.ts`), so `GET /api/models` and the model-proxy surface custom models with a non-empty `baseUrl` — matching what every pi session already shows.
  - Discovery is triggered on provider add/edit/remove (the server already owns that CRUD via `provider-routes.ts`) and cached; the server's provider-config write becomes atomic (tmp+rename).
  - NO `models.json` write, NO migration, NO `managedProviders` bookkeeping: `providers.json` stays the dashboard's custom-provider store, and pi sessions keep getting customs via the globally-registered bridge's `registerProvider` (unchanged), with `preRegisterProviderAuth` still closing the newly-added-provider spawn window.
- **Fix the dead registry handle** (small corollary): `getModelRegistry()` acquires `ctx.modelRegistry` and drops the dead `pi.modelRegistry` cast (provably a no-op on `ExtensionAPI` 0.80); remove the `modelRegistryRef` dead-fallback juggling and the harness's own dead `pi.modelRegistry` fallback.
- Consolidate resolvers onto `model:resolve`:
  - Extract a single `lookupRole()` accessor; both the resolver and the new tools read/write the role slice through it (no fourth independent reader).
  - `role:resolve-model` becomes a thin one-release deprecated alias delegating to the same resolve path (serves only legacy harness builds that read `probe.resolved`); **BREAKING** at next major (removal). The current harness already emits `model:resolve` and reads `probe.model`, so no emit migration is required.
- **BREAKING — drop the legacy `flow:` prefix (dashboard-owned, zero external emitters):**
  - Rename the five role events `flow:role-*` → `roles:*` (`roles:get-all`, `roles:set`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`). All emitters are in-repo (`bridge.ts`) and all handlers in-repo (`role-manager.ts`); pi-flows has zero role code, so this is a clean atomic rename with NO compatibility alias. The one-release-shim rationale in the base spec is obsolete (the shim window expired and pi-flows no longer emits these).
  - Delete `flow:resolve-model` NOW (not next major): it is a deprecated alias with a `model:resolve` replacement and zero in-repo emitters.

## Capabilities

### New Capabilities
- `agent-role-model-tools`: three decoupled agent-facing tools — `list_models` (read, roles-independent), `list_roles` (read, roles/presets only), and `update_roles` (write, confirmed) — for introspecting the model catalogue and wiring roles/presets from inside a session.
- `custom-provider-model-registry`: the dashboard SERVER discovers + registers custom providers from `providers.json` into its `InternalRegistry` (in-memory), so `GET /api/models` / model-proxy match every pi session. No `models.json` write; `providers.json` stays the store.

### Modified Capabilities
- `dashboard-roles-ownership`: role-name set becomes user-editable (add via implicit `set_role`, purge via `remove_role`); new roles surface as empty slots across all presets; `set_role` gains an optional explicit `preset` target; the role slice is read/written through a single `lookupRole()` accessor; **the five role events are renamed `flow:role-*` → `roles:*` (atomic, no alias)**.
- `dashboard-model-resolution`: `getModelRegistry()` acquires `ctx.modelRegistry` and drops the dead `pi.modelRegistry` fallback; the server registry gains custom providers (via server-side discovery) so it matches sessions; `role:resolve-model` demoted to a one-release alias; **`flow:resolve-model` deleted now**.

## Impact

- Code: `packages/extension/src/role-manager.ts` (tools, editable schema, `lookupRole()`, `roles:*` handler rename), `packages/extension/src/provider-register.ts` (registry-handle fix, resolver dedup, delete `flow:resolve-model`), `packages/extension/src/bridge.ts` (~11 `flow:role-*` emit sites → `roles:*`), `packages/roles-plugin/src/RolesSettingsSection.tsx` (empty-slot overlay must survive editable schema), `packages/client/src/App.tsx` (comment ref).
- Cross-package: `@blackbelt-technology/pi-dashboard-subagents` harness ALREADY emits `model:resolve` and reads `probe.model`; only change is deleting its dead `pi.modelRegistry` fallback + bumping the installed build. The one-release `role:resolve-model` alias serves only legacy harness builds.
- Consolidation code: `packages/server/src/model-proxy/internal-registry.ts` + `registry-singleton.ts` (discover `/v1/models` + register custom providers from `providers.json` into the server registry; fix the no-op loop), `packages/server/src/routes/provider-routes.ts` (trigger discovery on CRUD; atomic write), `packages/extension/src/provider-register.ts` (drop the dead `pi.modelRegistry` cast + `modelRegistryRef` dead-fallback only — discovery/registration path otherwise unchanged).
- Behavior change (intended): `agent-model-introspection`'s `GET /api/models` NOW returns custom-provider models (previously zero — server no-op loop). Its spec requirements are unchanged; verify `models-introspection-routes` tests reflect customs present.
- Data: NO change to which file stores what. `~/.pi/agent/providers.json` remains the dashboard's custom-provider store (+ roles/presets + editable role-name schema). `~/.pi/agent/models.json` is NOT written by the dashboard (stays pi user-authored). No migration.

## Discipline Skills

- `doubt-driven-review`: resolver consolidation + subagents-harness contract change are cross-boundary and hard to reverse; review before the alias/removal lands.
- `security-hardening`: `update_roles` lets an in-session agent mutate global machine-wide config; confirm the `ask_user` gate and blast-radius are adequate.
- `systematic-debugging`: the dead-registry-handle fix is a bug reproduction (spawned-session resolution failure) — reproduce, then fix.
- `code-simplification`: consolidation fills the server no-op loop and removes `modelRegistryRef` dead-fallback juggling + dead `pi.modelRegistry` casts — a deliberate complexity-reduction pass with existing tests as the safety net.
