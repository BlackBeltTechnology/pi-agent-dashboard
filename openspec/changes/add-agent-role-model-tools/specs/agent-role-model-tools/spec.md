## ADDED Requirements

### Requirement: The dashboard SHALL register a `list_roles` agent tool

The dashboard extension SHALL register a `list_roles` tool via `pi.registerTool` at activation. The tool is READ-ONLY and returns, in a single call, everything an in-session agent needs to inspect and wire roles: the bound roles map, the presets list, the active preset, and the assignable model catalogue.

The returned object SHALL contain:

- `roles`: an object mapping role name to its bound model ref, containing ONLY roles with a non-empty assigned model. Unset/empty role slots SHALL be omitted from the tool output (the human Settings UI keeps its empty-slot overlay; the tool does not).
- `presets`: an array of preset names.
- `activePreset`: the active preset name, or `null`.
- `models`: an array of `{ ref, provider, id, reasoning, input, contextWindow, cost }` where `ref` is the exact `"provider/modelId"` literal accepted by `update_roles` `set_role` and parsed by `model:resolve`. The model slice SHALL be sourced from the same `ModelRegistry` access used by `flow:get-available-models` / `GET /api/models` (one source of truth).

The tool SHALL read the role slice through the single `lookupRole`/role-accessor in `role-manager.ts` (no independent file reader).

#### Scenario: list_roles returns bound roles only

- **GIVEN** `providers.json#roles` contains `{ planning: "anthropic/claude-x", coding: "openai/gpt-5", vision: "" }`
- **WHEN** an agent invokes `list_roles`
- **THEN** the result `roles` SHALL deep-equal `{ planning: "anthropic/claude-x", coding: "openai/gpt-5" }`
- **AND** `vision` SHALL be absent from `roles` (empty slot omitted)

#### Scenario: list_roles returns presets, activePreset, and assignable models

- **GIVEN** `rolePresets` contains `cheap` and `premium` and `activePreset` is `cheap`
- **WHEN** an agent invokes `list_roles`
- **THEN** `presets` SHALL contain `"cheap"` and `"premium"`
- **AND** `activePreset` SHALL equal `"cheap"`
- **AND** every entry in `models` SHALL carry a `ref` string of the form `"provider/id"` assignable via `update_roles`

#### Scenario: Custom-provider models appear with an assignable ref

- **GIVEN** a reachable custom provider `mycustom` with model `foo-v2` registered in the registry
- **WHEN** an agent invokes `list_roles`
- **THEN** `models` SHALL include `{ ref: "mycustom/foo-v2", provider: "mycustom", id: "foo-v2", … }`

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
