## Why

Model choices are scattered: blackhole, grammar, automation, the status bar and the openspec run dialog each pin a concrete `provider/id`. Switching the whole fleet to a cheaper or stronger profile means editing every one of them by hand — even though the roles plugin already centralizes `@role → model` mapping and presets in `~/.pi/agent/providers.json`. Only automation can store an `@role` today, via a private toggle with a hard-coded role list, and third-party configs (e.g. `pi-blackhole-config.json`) cannot hold an `@role` at all because their owner reads a literal model.

## What Changes

- **Role-aware model refs everywhere.** One value grammar for every model field: `provider/id[:level]` (direct) OR `@role[:level]` (follows the role). Stored as a single string; existing direct values stay valid unchanged.
- **Role tab in the shared picker.** `ui:model-selector` gains an opt-in `allowRoles` prop: a Model | Role switch listing built-in + custom roles with their current resolution (`@fast → anthropic/claude-haiku-4-5 · low`). The Role tab renders only when the roles plugin is installed (`GET /api/roles` reachable); otherwise the picker is byte-identical to today.
- **Resolve-at-use consumers (Kind A).** Plugins whose own server reads the value (automation, grammar) store `@role` verbatim and resolve it at use time through one shared resolver. automation drops its private role toggle, hard-coded `DEFAULT_ROLE_KEYS` and private `providers.json` reader.
- **Generic role-binding projection (Kind B).** New roles-plugin server service `roles.bindings`. A plugin whose target config is owned by a third-party program registers a *projector* (declared fields + `read`/`write` callbacks). The service keeps a central binding store, watches `providers.json`, and on any role/preset change (UI, agent `update_roles` tool, or hand edit) re-resolves each bound field and asks the projector to write the concrete `{provider, id, thinkingLevel}`. Bindings carry a status: `ok` / `detached` (target edited externally) / `dangling` (role unassigned — last value kept, never blanked). Full re-projection on server boot.
- **Blackhole as first projector.** Every blackhole model slot (main, observer/reflector/dropper and their fallback chains) can bind to a role; `pi-blackhole-config.json` keeps receiving concrete `ModelRef`s.
- **One-shot resolve for session pickers (Kind C).** StatusBar / CommandInput and the openspec run dialog offer the Role tab; picking `@coding` resolves once and sends `set_model(resolved)`. The running session does NOT follow later preset changes; the trigger shows "via @coding".
- **"Used by" overview.** The Model roles settings page lists, per role, every binding and Kind A reference that follows it.
- **Primitive contract change.** The `ui:model-selector` contract note "role props are NOT part of this contract" is reversed for the opt-in `allowRoles` path. Not breaking: absent `allowRoles` keeps current behavior.

## Capabilities

### New Capabilities
- `role-model-bindings`: value grammar for role-aware model refs, the shared resolver, the `roles.bindings` server service (projector registration, binding store, `providers.json` watcher, boot re-projection, binding status), and the per-role "used by" overview.

### Modified Capabilities
- `model-selector`: picker primitive gains opt-in Role tab (`allowRoles`), roles-plugin-presence gating, one-shot role resolve for StatusBar/CommandInput.
- `automation-run-lifecycle`: `@role` resolution goes through the shared resolver (preset overlay + level suffix preserved).
- `automation-content-view`: editor selects roles via the primitive's Role tab with the live role list instead of a separate hard-coded role dropdown.
- `plugin-ui-primitive-registry`: `ui:model-selector` contract gains `allowRoles`; the "no role props" clause narrows to "no role management".
- `grammar-settings-plugin`: grammar model may be `@role[:level]`, resolved server-side per check.
- `grammar-check-service`: the single LLM backend uses the role-resolved provider/model when `llm` is a role ref; new typed `model_role_unassigned` error.
- `blackhole-plugin-settings`: every model slot (base + fallback chains) may bind to a role; the plugin registers a projector so `pi-blackhole-config.json` keeps concrete `ModelRef`s that follow the role.

## Impact

- **Code**: `packages/shared/src/role-schema.ts` (+ new node-only resolver module), `packages/shared/src/dashboard-plugin/ui-primitives.ts`, `packages/client/src/components/settings/ModelSelector.tsx`, `packages/client/src/lib/plugins/shell-primitives.tsx`, `packages/client/src/components/shell/StatusBar.tsx`, `packages/client/src/components/chat/CommandInput.tsx`, `packages/client/src/components/openspec/useOpenSpecRunConfigRow.tsx`, `packages/roles-plugin/src/server/*` (new service + watcher + store), `packages/roles-plugin/src/RolesSettingsSection.tsx` (used-by panel), `packages/automation-plugin/src/{client,server}/*`, `packages/grammar-plugin/src/{GrammarSettings.tsx,server/*}`, `packages/blackhole-plugin/src/{client,server}/*`.
- **Persistence**: new `~/.pi/dashboard/role-bindings.json` (dashboard-owned). `providers.json` stays read-only for the projection engine. Third-party target files are written only through their owning plugin's projector.
- **APIs**: additive `UiModelSelectorProps.allowRoles`; new in-process service `roles.bindings` (server plugin seam); no new HTTP route accepts a file path.
- **Compatibility / migration**: additive. No automatic conversion of existing concrete values. Without the roles plugin: Role tab hidden and projection/used-by inert; existing Kind A `@role` values keep resolving against `providers.json` (assignments are owned by the always-loaded extension), so uninstalling the plugin never breaks a saved config.
- **Rollback**: delete `role-bindings.json` and revert; target files retain their last projected concrete values (fail-safe).

## Discipline Skills

- `security-hardening` — the projection engine writes third-party config files from a watched input; projector registration and field allow-listing are a trust boundary.
- `doubt-driven-review` — reverses a recorded primitive-contract decision and introduces a public plugin service API (`roles.bindings`) other plugins will depend on.
- `observability-instrumentation` — new background watcher + projection job needs logged outcomes and visible binding status.
- `review-code` — non-trivial multi-package change before commit.
