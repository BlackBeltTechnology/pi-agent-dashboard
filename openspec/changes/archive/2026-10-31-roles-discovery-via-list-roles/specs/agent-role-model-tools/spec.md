## MODIFIED Requirements

### Requirement: The dashboard SHALL register a `list_roles` agent tool

The dashboard extension SHALL register a `list_roles` tool via `pi.registerTool` at activation. The tool is READ-ONLY and returns the role configuration only — NO models slice (model listing is the separate `list_models` tool). It is the discovery surface the role guideline points agents at, so it SHALL report only roles an agent can actually use.

The returned object SHALL contain:

- `roles`: an object mapping role name to its bound model ref, containing ONLY roles that (a) are on the effective role schema (`overlayRoles`: a name in `removedRoles` is excluded even when still assigned), (b) have a non-empty assigned model, and (c) when the session registry is hydrated, whose model (ref without thinking level, as `provider/id`) is in `getRegistry().getAvailable()`.
- `unavailable`: an object mapping role name to `{ ref, reason }` for roles meeting (a) and (b) but failing (c); `reason` SHALL be `"model-not-available"`. Empty object when none.
- `registryReady`: `true` when the registry is hydrated; `false` otherwise, in which case check (c) is skipped (every role meeting (a)+(b) is in `roles`) and a `reason` string is included.
- `presets`: an array of preset names.
- `activePreset`: the active preset name, or `null`.

The tool SHALL read the role slice through the shared role-config reader in `role-manager.ts` (`loadRoleConfig`; no independent file reader), and SHALL tolerate a missing/malformed role slice by returning `{ roles: {}, unavailable: {}, presets: [], activePreset: null }` plus `registryReady`.

#### Scenario: list_roles returns bound roles only
- **GIVEN** `providers.json#roles` contains `{ planning: "anthropic/claude-x", coding: "openai/gpt-5", vision: "" }` and both models are available
- **WHEN** an agent invokes `list_roles`
- **THEN** the result `roles` SHALL deep-equal `{ planning: "anthropic/claude-x", coding: "openai/gpt-5" }`
- **AND** `vision` SHALL be absent from `roles` and from `unavailable`
- **AND** the result SHALL NOT contain a `models` key

#### Scenario: Removed role is not listed even if still assigned
- **GIVEN** `roles` contains `vision: "anthropic/claude-x"` and `removedRoles` contains `"vision"`
- **WHEN** an agent invokes `list_roles`
- **THEN** `vision` SHALL be absent from `roles` and from `unavailable`

#### Scenario: Role bound to an unavailable model
- **GIVEN** `roles` contains `fast: "anthropic/claude-x:low"` and `review: "local/missing-model"`, and the registry's available models include `anthropic/claude-x` but not `local/missing-model`
- **WHEN** an agent invokes `list_roles`
- **THEN** `roles` SHALL deep-equal `{ fast: "anthropic/claude-x:low" }`
- **AND** `unavailable.review` SHALL deep-equal `{ ref: "local/missing-model", reason: "model-not-available" }`
- **AND** `registryReady` SHALL be `true`

#### Scenario: Registry not hydrated
- **GIVEN** `getRegistry()` returns a falsy value and `roles` contains `fast: "anthropic/claude-x"`
- **WHEN** an agent invokes `list_roles`
- **THEN** `roles` SHALL contain `fast`, `registryReady` SHALL be `false`, and a `reason` SHALL be present

#### Scenario: list_roles returns presets and activePreset
- **GIVEN** `rolePresets` contains `cheap` and `premium` and `activePreset` is `cheap`
- **WHEN** an agent invokes `list_roles`
- **THEN** `presets` SHALL contain `"cheap"` and `"premium"`
- **AND** `activePreset` SHALL equal `"cheap"`
