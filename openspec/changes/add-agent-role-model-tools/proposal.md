## Why

The dashboard owns roles and model resolution (`dashboard-roles-ownership`, `dashboard-model-resolution`), but exposes them only through WebSocket messages driven by the human Settings UI. An agent running *inside* a session is blind: it cannot see which roles exist, what they bind to, or which model refs are assignable, and it cannot wire a role or preset. Separately, the custom-provider PR wired resolution through `model:resolve` correctly, yet resolution still fails in spawned/headless subagent sessions because the registry handle falls back to `pi.modelRegistry` — a property that does not exist on `ExtensionAPI` in pi-coding-agent 0.80 (it lives only on `ExtensionContext`). The fixed default role-name set is also un-removable by construction, blocking user-defined roles.

## What Changes

- Add two agent-facing tools (registered via `pi.registerTool` in the dashboard extension):
  - `list_roles` — read: returns `{ roles (bound-only), presets, activePreset, models }`, where each model carries a ready-to-assign `ref` string. Unset role slots are omitted from the tool output (human UI keeps the empty-slot overlay).
  - `update_roles` — write, action-dispatched (discriminated schema): `set_role { role, ref, preset? }`, `remove_role { role }`, `create_preset { name }`, `load_preset { name }`, `delete_preset { name }`. `set_role` on a new role name creates it (implicit add). Every write requires an `ask_user` confirmation because it mutates the global `~/.pi/agent/providers.json` shared by all sessions.
- Make the role-name set editable: replace the hardcoded `DEFAULT_ROLE_NAMES`-as-const behavior with a user-editable role-name schema. A new role surfaces as an empty slot in every preset (resolution targets stay stable across presets). `remove_role` **purges** the role from every preset (with confirmation).
- **Fix the dead registry handle (the actual "resolution is still an issue")**: `getModelRegistry()` must acquire `ctx.modelRegistry` (captured across the parent session's lifecycle points) and drop the dead `pi.modelRegistry` fallback, so `model:resolve` fills `probe.model` reliably. Resolution runs in the PARENT session (via the harness's `resolveModelFromRef` on a mid-session tool call), so a registry is available — the child is spawned WITH the resolved `Model` and never resolves itself. Also delete the harness's own dead `pi.modelRegistry` fallback and bump its installed build.
- Consolidate resolvers onto `model:resolve`:
  - Extract a single `lookupRole()` accessor; both the resolver and the new tools read/write the role slice through it (no fourth independent reader).
  - `role:resolve-model` becomes a thin one-release deprecated alias delegating to the same resolve path (serves only legacy harness builds that read `probe.resolved`); **BREAKING** at next major (removal). The current harness already emits `model:resolve` and reads `probe.model`, so no emit migration is required.
  - Delete `flow:resolve-model` at next major (already deprecated).

## Capabilities

### New Capabilities
- `agent-role-model-tools`: agent-facing `list_roles` (read) and `update_roles` (write, confirmed) tools for introspecting and wiring roles, presets, and model bindings from inside a session.

### Modified Capabilities
- `dashboard-roles-ownership`: role-name set becomes user-editable (add via implicit `set_role`, purge via `remove_role`); new roles surface as empty slots across all presets; `set_role` gains an optional explicit `preset` target; the role slice is read/written through a single `lookupRole()` accessor.
- `dashboard-model-resolution`: `model:resolve` sets `probe.resolved` before registry lookup (leniency); `getModelRegistry()` acquires `ctx.modelRegistry` and drops the dead `pi.modelRegistry` fallback (fixes spawned-session resolution); `role:resolve-model` demoted to a one-release alias; `flow:resolve-model` slated for removal.

## Impact

- Code: `packages/extension/src/role-manager.ts` (tools, editable schema, `lookupRole()`), `packages/extension/src/provider-register.ts` (registry-handle fix, early `.resolved`, resolver dedup), `packages/roles-plugin/src/RolesSettingsSection.tsx` (empty-slot overlay must survive editable schema).
- Cross-package: `@blackbelt-technology/pi-dashboard-subagents` harness ALREADY emits `model:resolve` and reads `probe.model`; only change is deleting its dead `pi.modelRegistry` fallback + bumping the installed build. The one-release `role:resolve-model` alias serves only legacy harness builds.
- Adjacent: reuses the same `ModelRegistry` access as `agent-model-introspection`'s `GET /api/models`; `list_roles`' model slice should share that registry path (one source of truth). No change to that REST spec's requirements.
- Data: `~/.pi/agent/providers.json` gains a user-editable role-name schema; writes stay atomic tmp+rename, preserve unrelated keys.

## Discipline Skills

- `doubt-driven-review`: resolver consolidation + subagents-harness contract change are cross-boundary and hard to reverse; review before the alias/removal lands.
- `security-hardening`: `update_roles` lets an in-session agent mutate global machine-wide config; confirm the `ask_user` gate and blast-radius are adequate.
- `systematic-debugging`: the dead-registry-handle fix is a bug reproduction (spawned-session resolution failure) — reproduce, then fix.
