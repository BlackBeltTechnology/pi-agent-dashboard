# agent-role-model-tools Specification

## Purpose
TBD - created by archiving change add-agent-role-model-tools. Update Purpose after archive.
## Requirements
### Requirement: The dashboard SHALL register a `list_models` agent tool decoupled from roles

The dashboard extension SHALL register a `list_models` tool via `pi.registerTool` at activation. The tool is READ-ONLY and returns the assignable model catalogue from the IN-PROCESS session registry via the EXACT SAME source the human Model Selector uses: `cachedModelRegistry.getAvailable().map(toModelInfo)` (the path feeding the `models_list` push and `flow:get-available-models`), NOT the dashboard server's `registry-singleton`. This guarantees the tool lists the same models the picker shows — including custom providers registered via `pi.registerProvider()` (which register into the same registry; `getAvailable()` surfaces pi-ai's catalog PLUS custom models) — and that returned `ref`s match what `update_roles` `set_role` persists and `model:resolve` resolves.

Each row SHALL carry the `toModelInfo` projection including the `custom?: boolean` flag (true for models from a `pi.registerProvider()` custom provider), so an agent can distinguish custom-provider models. Because `getAvailable()` is reachability-filtered, a custom provider without resolved credentials is excluded from the default result; the tool MAY accept an `annotated` flag surfacing every known model with `excludedReason` (`no-credential` / `oauth-incompatible`), derived in-process from the registry's `getAll()` minus `getAvailable()` (pi's session `ModelRegistry` exposes no `getAllAnnotated()` — that method exists only on the server's `InternalRegistry`).

The tool SHALL be fully DECOUPLED from the role subsystem: it SHALL NOT read `providers.json#roles` and SHALL succeed even when the role slice is missing or malformed. Each row SHALL be `{ ref, provider, id, custom?, reasoning, input, contextWindow, cost }`, where `ref` is the exact `"provider/modelId"` literal accepted by `update_roles` `set_role` and parsed by `model:resolve`.

The tool result SHALL additionally carry a `registryReady: boolean` discriminator so that an empty `models` array is never ambiguous between "the in-process registry is not yet hydrated" and "the registry is hydrated but exposes no reachable models". `registryReady` SHALL be `false` if and only if the tool's registry accessor (`getRegistry()` / `cachedModelRegistry`) is absent (falsy) at invocation time; otherwise `registryReady` SHALL be `true`. When `registryReady` is `false`, the result SHALL include a non-empty `reason` string explaining the registry is not yet hydrated and that the caller may retry, and `models` SHALL be `[]`. When `registryReady` is `true`, `reason` SHALL be omitted (or `null`) and `models` SHALL be the reachability-filtered catalogue (possibly `[]` when no provider has resolved credentials). The `registryReady` and `reason` fields SHALL be additive and backward-compatible: consumers that read only `models` SHALL be unaffected. The `annotated` mode SHALL obey the identical discriminator — a falsy registry under `annotated: true` SHALL also yield `registryReady: false` with an empty `models` and a `reason`, never a silent empty catalogue.

#### Scenario: list_models returns assignable refs

- **WHEN** an agent invokes `list_models`
- **THEN** every row SHALL carry a `ref` string of the form `"provider/id"` assignable via `update_roles`
- **AND** each row SHALL include available capability metadata (`reasoning`, `input`, `contextWindow`, `cost`) when known

#### Scenario: list_models works when roles are unavailable

- **GIVEN** `providers.json#roles` is missing or contains malformed JSON
- **WHEN** an agent invokes `list_models`
- **THEN** the tool SHALL return the model catalogue normally
- **AND** SHALL NOT throw or depend on the role slice

#### Scenario: Custom registered providers appear with an assignable ref and custom flag

- **GIVEN** a reachable custom provider `mycustom` (registered via `pi.registerProvider()`) with model `foo-v2`, present in `cachedModelRegistry.getAvailable()`
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL include `{ ref: "mycustom/foo-v2", provider: "mycustom", id: "foo-v2", custom: true, … }`
- **AND** the row SHALL match what the human Model Selector shows for that model (same `getAvailable()`+`toModelInfo` source)

#### Scenario: Uncredentialed custom provider surfaces only under annotated mode

- **GIVEN** a custom provider `mycustom` registered but WITHOUT resolved credentials (excluded from `getAvailable()`)
- **WHEN** an agent invokes `list_models` without `annotated`
- **THEN** `mycustom` models SHALL be absent
- **WHEN** an agent invokes `list_models` with `annotated`
- **THEN** `mycustom` models SHALL be present each carrying `excludedReason: "no-credential"`

#### Scenario: Absent registry reports registryReady false with a reason (not a silent empty)

- **GIVEN** the in-process registry accessor is falsy (the session's `cachedModelRegistry` has not been captured from `ctx.modelRegistry` yet — the spawn-before-discovery window)
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL be `{ models: [], registryReady: false, reason: <non-empty string> }`
- **AND** the `reason` SHALL indicate the registry is not yet hydrated and the caller may retry
- **AND** the tool SHALL NOT throw

#### Scenario: Hydrated-but-empty registry reports registryReady true

- **GIVEN** the registry accessor returns a registry whose `getAvailable()` is `[]` (no provider has resolved credentials)
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL be `{ models: [], registryReady: true }`
- **AND** `reason` SHALL be omitted or `null`
- **AND** the empty result SHALL be reported as a true "no reachable models" answer, distinguishable from the absent-registry case

#### Scenario: Populated registry is unchanged and reports registryReady true

- **GIVEN** the registry accessor returns a registry whose `getAvailable()` yields one or more models
- **WHEN** an agent invokes `list_models`
- **THEN** the result SHALL carry `registryReady: true` and the full `models` array with the pre-existing row shape
- **AND** a consumer reading only `models` SHALL observe no behavioral change

#### Scenario: Annotated mode obeys the same discriminator on an absent registry

- **GIVEN** the in-process registry accessor is falsy
- **WHEN** an agent invokes `list_models` with `annotated: true`
- **THEN** the result SHALL be `{ models: [], registryReady: false, reason: <non-empty string> }`
- **AND** SHALL NOT return a silent empty catalogue as if every known model were unknown

### Requirement: The dashboard SHALL register a `list_roles` agent tool

The dashboard extension SHALL register a `list_roles` tool via `pi.registerTool` at activation. The tool is READ-ONLY and returns the role configuration only — NO models slice (model listing is the separate `list_models` tool).

The returned object SHALL contain:

- `roles`: an object mapping role name to its bound model ref, containing ONLY roles with a non-empty assigned model. Unset/empty role slots SHALL be omitted from the tool output (the human Settings UI keeps its empty-slot overlay; the tool does not).
- `presets`: an array of preset names.
- `activePreset`: the active preset name, or `null`.

The tool SHALL read the role slice through the shared role-config reader in `role-manager.ts` (`loadRoleConfig`, the same accessor family as `lookupRole`; no independent file reader), and SHALL tolerate a missing/malformed role slice by returning `{ roles: {}, presets: [], activePreset: null }`.

#### Scenario: list_roles returns bound roles only

- **GIVEN** `providers.json#roles` contains `{ planning: "anthropic/claude-x", coding: "openai/gpt-5", vision: "" }`
- **WHEN** an agent invokes `list_roles`
- **THEN** the result `roles` SHALL deep-equal `{ planning: "anthropic/claude-x", coding: "openai/gpt-5" }`
- **AND** `vision` SHALL be absent from `roles` (empty slot omitted)
- **AND** the result SHALL NOT contain a `models` key

#### Scenario: list_roles returns presets and activePreset

- **GIVEN** `rolePresets` contains `cheap` and `premium` and `activePreset` is `cheap`
- **WHEN** an agent invokes `list_roles`
- **THEN** `presets` SHALL contain `"cheap"` and `"premium"`
- **AND** `activePreset` SHALL equal `"cheap"`

### Requirement: The dashboard SHALL register an `update_roles` agent tool with confirmed, dispatched writes

The dashboard extension SHALL register an `update_roles` tool via `pi.registerTool` at activation. The tool uses a discriminated `action` schema and mutates the global `~/.pi/agent/providers.json` through the shared role-accessor and the existing atomic tmp+rename write path. Every mutating invocation SHALL require an `ask_user` confirmation before writing, because the file is shared by all sessions and processes on the machine.

Actions:

- `set_role { role, ref, preset? }` — bind `ref` to `role`. When `preset` is omitted, write into the active roles map (and mirror into the active preset if one is active, preserving current behavior). When `preset` is given, write into that named preset's roles map. If `role` does not exist, it SHALL be created (implicit add).
- `remove_role { role }` — remove `role` from the role-name schema AND purge its binding from the active roles map and from every preset.
- `create_preset { name }` — capture the current roles map as a new named preset.
- `load_preset { name }` — replace the active roles map with the named preset (wholesale) and set it active.
- `delete_preset { name }` — remove the named preset; clear `activePreset` if it referenced it.

Each invocation SHALL return a result object carrying at least `{ success: boolean }` and, on failure, a human-readable `error`.

#### Scenario: set_role creates a new role on first assignment

- **GIVEN** `roles` has no `review` key
- **WHEN** an agent invokes `update_roles { action: "set_role", role: "review", ref: "anthropic/claude-x" }` and the user confirms
- **THEN** `success` SHALL be `true`
- **AND** `providers.json#roles.review` SHALL equal `"anthropic/claude-x"`
- **AND** `review` SHALL now be part of the role-name schema

#### Scenario: set_role targets a named preset without loading it

- **GIVEN** a preset `premium` exists and is NOT the active preset
- **WHEN** an agent invokes `update_roles { action: "set_role", role: "coding", ref: "openai/gpt-5", preset: "premium" }` and the user confirms
- **THEN** `premium.roles.coding` SHALL equal `"openai/gpt-5"`
- **AND** the active roles map SHALL be unchanged

#### Scenario: Every mutating action requires confirmation

- **WHEN** an agent invokes any `update_roles` action
- **THEN** the tool SHALL request an `ask_user` confirmation before writing
- **AND** if the user declines, `success` SHALL be `false`
- **AND** `providers.json` SHALL NOT be written

#### Scenario: remove_role purges the role from every preset

- **GIVEN** role `vision` is bound in the active map and in presets `cheap` and `premium`
- **WHEN** an agent invokes `update_roles { action: "remove_role", role: "vision" }` and the user confirms
- **THEN** `vision` SHALL be absent from the role-name schema, the active roles map, and both presets
- **AND** the write SHALL be atomic (tmp+rename) preserving unrelated keys

#### Scenario: Writes preserve unrelated top-level keys

- **GIVEN** `providers.json` contains `providers` and `autonomousMode`
- **WHEN** any confirmed `update_roles` write runs
- **THEN** `providers` and `autonomousMode` SHALL be preserved bit-for-bit

