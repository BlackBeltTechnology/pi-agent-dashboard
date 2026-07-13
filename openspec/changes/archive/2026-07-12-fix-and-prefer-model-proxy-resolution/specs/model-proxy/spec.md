## ADDED Requirements

### Requirement: Model ID resolution

The proxy SHALL resolve a requested model to a registry entry using first-slash parsing, alias expansion, and a preferred-model fallback. Every id advertised by `GET /v1/models` MUST resolve on `POST /v1/chat/completions` and `POST /v1/messages`.

Resolution order for a request to `/v1/chat/completions` or `/v1/messages`:

1. Determine the requested label: the request's `model`, else the first *available* entry of `modelProxy.preferredModels`, else `modelProxy.defaultModel`. If none yields a label, respond `400` (`model is required`).
2. Expand aliases: if the label exactly matches a key in `modelProxy.modelAliases`, replace it with the mapped fully-qualified id.
3. Parse the label on the **first** `/` only: provider = substring before the first `/`, model id = the entire remainder (which MAY itself contain `/`). A label with no `/` has no provider.
4. Resolve: `registry.find(provider, id)` (exact match on `provider` AND `id`).
5. Fallback: if step 4 misses OR the label had no provider, walk `modelProxy.preferredModels` in order and use the first entry that is available in the registry.
6. If still unresolved, respond `404` (`Model not found: <label>`).

The registry SHALL expose at most one entry per fully-qualified `provider/id`. When the same `provider/id` exists in more than one source, the entry from the highest-precedence source wins, precedence being: built-in providers, then discovered custom providers, then `models.json`.

#### Scenario: Multi-slash model id resolves

- **GIVEN** the registry exposes a custom model `provider: "openrouter"`, `id: "anthropic/claude-3.5-sonnet"`
- **AND** `GET /v1/models` advertises id `openrouter/anthropic/claude-3.5-sonnet`
- **WHEN** a client POSTs `/v1/chat/completions` with `model: "openrouter/anthropic/claude-3.5-sonnet"`
- **THEN** the proxy SHALL parse provider `openrouter` and model id `anthropic/claude-3.5-sonnet`
- **AND** resolve the model and stream a response (not `404`)

#### Scenario: Round-trip invariant holds

- **GIVEN** any id `X` present in the `GET /v1/models` response
- **WHEN** a client POSTs `/v1/chat/completions` with `model: X`
- **THEN** the proxy SHALL resolve `X` to a registry entry (never `404 Model not found`)

#### Scenario: Alias expands to a preferred provider path

- **GIVEN** `modelProxy.modelAliases` maps `"claude"` to `"anthropic/claude-3.5-sonnet"`
- **AND** `anthropic/claude-3.5-sonnet` is available in the registry
- **WHEN** a client POSTs `/v1/chat/completions` with `model: "claude"`
- **THEN** the proxy SHALL resolve to `anthropic/claude-3.5-sonnet`

#### Scenario: Preferred model used when request omits model

- **GIVEN** `modelProxy.preferredModels` is `["anthropic/claude-3.5-sonnet", "openai/gpt-4o"]`
- **AND** `anthropic/claude-3.5-sonnet` is unavailable but `openai/gpt-4o` is available
- **WHEN** a client POSTs `/v1/chat/completions` without a `model` field
- **THEN** the proxy SHALL use `openai/gpt-4o` (first available in the ordered list)

#### Scenario: preferredModels supersedes defaultModel

- **GIVEN** both `modelProxy.preferredModels` (non-empty, first entry available) and `modelProxy.defaultModel` are set
- **WHEN** a client POSTs `/v1/chat/completions` without a `model` field
- **THEN** the proxy SHALL use the first available `preferredModels` entry, not `defaultModel`

#### Scenario: Deterministic source precedence on collision

- **GIVEN** the identical fully-qualified id `p/m` is produced by both a built-in provider and `models.json`
- **WHEN** `GET /v1/models` is requested
- **THEN** the response SHALL contain exactly one entry for `p/m`
- **AND** `registry.find("p", "m")` SHALL return the built-in entry (highest precedence)

#### Scenario: Unresolved model still 404s

- **GIVEN** no registry entry matches the requested label and no `preferredModels` entry is available
- **WHEN** a client POSTs `/v1/chat/completions` with `model: "ghost/none"`
- **THEN** the proxy SHALL respond `404` with message `Model not found: ghost/none`

## MODIFIED Requirements

### Requirement: Settings UI persists model proxy configuration

The dashboard Settings panel SHALL persist changes to `modelProxy` configuration (enabled, defaultModel, preferredModels, modelAliases, secondPort, maxConcurrentStreams, perKeyConcurrentStreams, logRequests) to `~/.pi/dashboard/config.json` via `PUT /api/config` when the user clicks Save. The persistence SHALL follow the same diff-and-merge pattern used by other config sections (tunnel, memoryLimits, openspec, editor, auth). `parseModelProxyConfig` SHALL validate `preferredModels` as an array of non-empty strings (dropping non-string entries) and `modelAliases` as a string→string map (dropping entries whose key or value is not a non-empty string).

#### Scenario: Model proxy enabled toggle persisted

- **GIVEN** the Settings panel is open on the Providers tab
- **AND** `modelProxy.enabled` is currently `true`
- **WHEN** the user toggles the API Proxy switch to off and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy: { enabled: false, ... }`
- **AND** `~/.pi/dashboard/config.json` SHALL be updated with `modelProxy.enabled: false`
- **AND** subsequent page reloads SHALL reflect the disabled state

#### Scenario: Model proxy default model persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user types `anthropic/claude-3-5-sonnet` into the Default Model field and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy` with `defaultModel: "anthropic/claude-3-5-sonnet"`
- **AND** subsequent `/v1/chat/completions` requests that omit `model` SHALL use `anthropic/claude-3-5-sonnet` when no `preferredModels` entry is available

#### Scenario: Preferred models persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user enters an ordered list `anthropic/claude-3.5-sonnet`, `openai/gpt-4o` into the Preferred Models field and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy.preferredModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"]`
- **AND** the saved config SHALL preserve list order

#### Scenario: Model aliases persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user adds an alias `claude` → `anthropic/claude-3.5-sonnet` and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy.modelAliases` with `{ "claude": "anthropic/claude-3.5-sonnet" }`

#### Scenario: Model proxy second port persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user enters `9876` in the Second Port field, moves focus away (blur), and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy` with `secondPort: 9876`
- **AND** after a server restart, the proxy SHALL listen on port 9876 in addition to the primary port

#### Scenario: Model proxy sub-object merged atomically

- **GIVEN** `modelProxy` has existing config on disk (`enabled: true, secondPort: 9876`)
- **WHEN** the user changes only `defaultModel` and clicks Save
- **THEN** the saved config SHALL retain `enabled: true` and `secondPort: 9876`
- **AND** the saved config SHALL include the new `defaultModel`
- **AND** no other `modelProxy` fields are lost

#### Scenario: Model proxy changes trigger "No changes to save" correctly

- **GIVEN** the user has made no changes to any field including model proxy
- **WHEN** the user clicks Save
- **THEN** the UI SHALL display "No changes to save"
- **AND** no `PUT /api/config` request is sent

#### Scenario: Model proxy changes included alongside other config changes

- **GIVEN** the user changes `defaultModel` in both the General tab and the API Proxy section
- **WHEN** the user clicks Save
- **THEN** a single `PUT /api/config` request SHALL be sent
- **AND** the request body SHALL include both `defaultModel` (top-level string) and `modelProxy` (sub-object)
