## Why

The roles plugin bridge writes a role list into the `Agent` tool guideline every turn (`@name → provider/model`, sorted, capped at 12). The cap silently drops roles: with 13 configured roles, `@vision` (13th alphabetically) never reaches the model, and nothing tells it roles were cut. The list also only shows assigned refs. It never checks whether the bound model is reachable (registered + credentialed), so the model can be told to use a role whose model cannot run.

`list_roles` already exists. It is the right discovery surface, but it returns the raw `cfg.roles` map: it ignores the `removedRoles` overlay (a removed default can still appear) and does no availability check.

## What Changes

- **Guideline is a pointer, not a list.** The roles bridge bullet no longer enumerates roles. It tells the model: call `list_roles` to discover the available roles, then pass `model: "@<role>"` instead of a literal model id. No cap and no stale list in the prompt. The bullet is still added only when the `Agent` tool is selected and at least one role is assigned (so sessions with no roles get no bullet).
- **`list_roles` returns only usable roles.** It reads the effective schema via `overlayRoles` (honours `removedRoles`), keeps assigned roles only, and checks each bound ref against the session registry (`getRegistry().getAvailable()`):
  - `roles`: `{ name: ref }` for roles whose model is available.
  - `unavailable`: `{ name: { ref, reason } }` with `reason` ∈ `model-not-available` (not registered, or no credential).
  - Registry not hydrated → `registryReady: false`; no availability filter is applied, so every assigned role stays in `roles` (no false negatives) and a `reason` is given.
- `presets` / `activePreset` are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `role-agent-guidance`: guideline points at `list_roles` instead of listing up to 12 roles.
- `agent-role-model-tools`: `list_roles` honours removed roles, filters by registry availability, and adds `unavailable` + `registryReady`.

## Impact

- `packages/roles-plugin/src/bridge/index.ts`: `buildRoleGuideline` emits the pointer text; `MAX_LISTED_ROLES` removed.
- `packages/extension/src/role-model-tools.ts`: `list_roles` uses `overlayRoles` + `deps.getRegistry()`.
- Tests: `packages/roles-plugin` bridge test, `packages/extension/src/__tests__/role-model-tools.test.ts`.
- AGENTS.md rows: `packages/roles-plugin/src/bridge/AGENTS.md`, `packages/extension/src/role-model-tools.ts.AGENTS.md`.
- No protocol, client or server changes.

## Discipline Skills

None apply. This is a read-only tool output change and prompt text change: no auth, untrusted input, secrets, latency budget, new endpoint or irreversible step. `review-code` runs inline before commit as usual.
