## MODIFIED Requirements

### Requirement: Model availability mirrors dashboard's effective catalog

`GET /v1/models` SHALL return exactly the models that `ModelRegistry.getAvailable()` exposes — i.e., models with configured authentication after composing built-in providers, `~/.pi/agent/providers.json` custom providers, `~/.pi/agent/models.json` custom models, and OAuth state from `~/.pi/agent/auth.json`.

The one exception is a request authenticated with a session proxy key owned by vault delivery. Such a request SHALL see only the models of that key's binding that the binding's credential can route (see `model-proxy-credential-routing`, "Credential-kind aware model filtering"). Every other request SHALL see the set above, unchanged.

#### Scenario: New OAuth login appears within one request

- **GIVEN** the proxy is running and the user has not logged into Anthropic
- **AND** `GET /v1/models` does not list any `anthropic/*` model
- **WHEN** the user completes the Anthropic OAuth flow via the dashboard's `/api/provider-auth/...` endpoint
- **THEN** the next `GET /v1/models` request lists at least one `anthropic/*` model
- **AND** no server restart is required

#### Scenario: Custom provider edit reflects immediately

- **GIVEN** the proxy is running
- **WHEN** the user `PUT`s a new custom provider via `/api/providers`
- **AND** the write succeeds
- **THEN** the next `GET /v1/models` request lists the new provider's models

#### Scenario: Models without credentials hidden

- **GIVEN** `~/.pi/agent/models.json` contains a model entry whose provider has no auth configured
- **WHEN** `GET /v1/models` is called
- **THEN** that model is NOT in the response
- **AND** `getAvailable()` semantics are preserved end-to-end

#### Scenario: Manual refresh endpoint

- **WHEN** the user POSTs `/api/model-proxy/refresh` with a valid JWT
- **THEN** the registry is force-refreshed
- **AND** the next `/v1/models` request reflects any on-disk changes the eager-trigger machinery missed

#### Scenario: Owned session key sees only its binding

- **GIVEN** a session proxy key owned by vault delivery for binding `anthropic-work`
- **WHEN** `GET /v1/models` is called with that key
- **THEN** the response lists `anthropic-work/*` models only
- **AND** a request with an unowned key lists exactly `getAvailable()`, with no `anthropic-work/*` model

### Requirement: Model ID resolution

The proxy SHALL resolve a requested model to a registry entry using first-slash parsing, alias expansion, and a preferred-model fallback. Every id advertised by `GET /v1/models` MUST resolve on `POST /v1/chat/completions` and `POST /v1/messages`.

For a request authenticated with a session proxy key owned by vault delivery, resolution SHALL be confined to that key's binding: a label with no `/` SHALL resolve as `<binding>/<label>`; a label whose provider part differs from the binding SHALL be rejected with `403` and code `BINDING_MISMATCH`; aliases, `preferredModels` and `defaultModel` SHALL NOT be applied; an unresolved label SHALL respond `404`.

Resolution order for every other request to `/v1/chat/completions` or `/v1/messages`:

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

#### Scenario: Owned key resolves a bare model id within its binding

- **GIVEN** a session proxy key owned by vault delivery for binding `anthropic-work`
- **WHEN** a client POSTs `/v1/messages` with `model: "claude-sonnet-4-5"`
- **THEN** the proxy SHALL resolve `anthropic-work/claude-sonnet-4-5`
- **AND** SHALL NOT consult `preferredModels` or `defaultModel`

#### Scenario: Owned key cannot address another provider

- **GIVEN** a session proxy key owned by vault delivery for binding `anthropic-work`
- **WHEN** a client POSTs `/v1/chat/completions` with `model: "openai/gpt-4o"`
- **THEN** the proxy SHALL respond `403` with code `BINDING_MISMATCH`
