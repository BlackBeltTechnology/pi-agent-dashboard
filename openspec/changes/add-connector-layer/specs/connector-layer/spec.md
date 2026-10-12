# connector-layer — delta

## ADDED Requirements

### Requirement: Managed credential store
The connector layer SHALL take third-party credentials from the credential vault (`credential-vault`): a connector's `credential_id` SHALL be the id of a vault account of kind `key`. The connector layer SHALL NOT keep its own secret file. List operations SHALL return the account id, provider and label and SHALL NOT return secret material. The value SHALL be read server-side only, at invocation time, and SHALL NOT be returned by any connector tool, façade or REST response.

For this change the connector layer SHALL support vault `key` accounts. OAuth connector credentials SHALL follow the vault's OAuth accounts in a later phase without a breaking change to connector definitions.

#### Scenario: API-key credential comes from the vault
- **WHEN** a user adds an API-key credential in Settings → Vault and picks it for a connector
- **THEN** the connector's `credential_id` SHALL be that vault account id and no connector-specific secret file SHALL be written
- **AND** a subsequent `list` SHALL return the account id and metadata but no secret material

#### Scenario: Revoked credential cannot be used
- **WHEN** the vault account a connector references is revoked
- **THEN** `get` for that id SHALL fail
- **AND** any connector depending on it SHALL become non-invocable

#### Scenario: Non-key account does not resolve
- **WHEN** a connector references a vault account of a kind other than `key`
- **THEN** the credential SHALL NOT resolve and the connector SHALL be non-invocable

### Requirement: Connector registry with pluggable kind
A connector SHALL be defined as `{ id, kind, descriptor, credentialId }` where `kind` discriminates the invocation backend. The registry SHALL support kinds `http` and `openapi` in this change, and the type SHALL reserve `graphql` so a later phase can add it without a breaking migration. For `openapi` connectors the registry SHALL load operations from OpenAPI specifications and expose, per operation, an id, a summary, and a parameter JSON-schema; adding an OpenAPI provider SHALL require supplying its spec and a credential mapping, NOT hand-written connector code. The registry SHALL support a per-spec overrides mechanism to patch, hide, or correct operations from imperfect specs. Google APIs SHALL be supported in a later phase by converting Discovery Documents into `openapi`-kind connectors at ingest, reusing the `openapi` invocation path.

#### Scenario: Kind dispatch
- **WHEN** a connector of kind `openapi` and a connector of kind `http` are both invoked
- **THEN** the Invoker SHALL route each to its backend
- **AND** the gateway tool and REST surface SHALL behave identically regardless of kind

#### Scenario: Operation loaded from spec
- **WHEN** a seed OpenAPI spec is registered
- **THEN** its operations SHALL be discoverable with id, summary, and parameter schema

#### Scenario: Overrides hide an operation
- **WHEN** a spec's overrides file marks an operation hidden
- **THEN** that operation SHALL NOT appear in search results or be invocable

### Requirement: Single invocation core
All connector invocations — from the gateway tool, the REST API, and any future façade — SHALL pass through one Invoker that resolves the operation, reads and decrypts the credential, injects authentication in the location declared by the operation descriptor, executes the HTTP request, and returns a normalized result. Provider errors SHALL be surfaced as structured errors carrying status and provider message without leaking secrets.

#### Scenario: Auth injected correctly
- **WHEN** the Invoker executes a connector whose descriptor places auth in an `Authorization` header
- **THEN** the outbound request SHALL carry the resolved credential in that header
- **AND** the credential SHALL NOT appear in any log line or returned payload

#### Scenario: Missing credential
- **WHEN** a connector is invoked but its credential is absent or revoked
- **THEN** the Invoker SHALL return a typed error
- **AND** SHALL NOT perform the outbound HTTP request

### Requirement: Token-aware gateway tool
The LLM-facing seam SHALL expose exactly three tools — `search_connectors`, `get_connector_schema`, and `call_connector` — regardless of how many connectors the catalog contains. Per-operation tools SHALL NOT be registered. `search_connectors` SHALL return only enabled connectors. This invariant SHALL hold so that per-turn tool-schema context cost remains constant as the catalog grows.

#### Scenario: Constant tool count
- **WHEN** the catalog contains 3 connectors AND when it contains 50 connectors
- **THEN** the gateway SHALL register exactly 3 tool schemas in both cases

#### Scenario: Discover then invoke
- **WHEN** an agent calls `search_connectors("slack post")`, then `get_connector_schema` for a returned id, then `call_connector` with valid params
- **THEN** the message SHALL be sent via the Invoker
- **AND** the agent's context SHALL never have contained schemas for connectors it did not request

#### Scenario: Disabled connectors are invisible
- **WHEN** a connector is disabled in settings
- **THEN** `search_connectors` SHALL NOT return it
- **AND** `call_connector` for its id SHALL fail

### Requirement: REST invocation seam
The connector layer SHALL expose `GET /api/connectors`, `GET /api/connectors/:id/schema`, and `POST /api/connectors/:id/invoke`, all delegating to the same Invoker as the gateway tool. List and schema endpoints SHALL NOT emit secret material. Invocation endpoints SHALL require the dashboard's existing authorization guard.

#### Scenario: Programmatic invoke matches agent invoke
- **WHEN** the same connector is invoked with the same params via `POST /api/connectors/:id/invoke` and via `call_connector`
- **THEN** both SHALL execute through the one Invoker and produce equivalent results

#### Scenario: List endpoint omits secrets
- **WHEN** `GET /api/connectors` is called
- **THEN** the response SHALL contain enabled connector ids and metadata only, never credential secrets
