## Purpose

Defines how the dashboard consumes the pi-ai runtime across incompatible module generations, so the server's model registry, upstream streaming, and OAuth credential refresh keep working whether the resolved pi-ai exposes the legacy global-registry API or the newer factory API.

## ADDED Requirements

### Requirement: The dashboard SHALL run against either pi-ai module generation

The dashboard SHALL classify the resolved pi-ai module by validating the full set of members each generation requires, and SHALL present a single internal module surface to its consumers. Neither generation SHALL require a change to the model registry's composition logic, the proxy route handlers, or the introspection route.

#### Scenario: Legacy module passes through

- **WHEN** the resolved module exposes every member of the legacy global-registry API
- **THEN** the module SHALL be used as-is
- **AND** catalogue and streaming behavior SHALL be identical to the behavior before this change

#### Scenario: Factory module is adapted

- **WHEN** the resolved module exposes the factory API markers and no legacy members
- **THEN** the dashboard SHALL build a built-in model collection from that module
- **AND** provider enumeration, model enumeration, and single-model lookup SHALL answer from that collection

#### Scenario: Partial module is rejected rather than misclassified

- **WHEN** the resolved module exposes some but not all members of a generation
- **THEN** classification SHALL fail with a reason naming the missing members
- **AND** the module SHALL NOT be treated as either generation

#### Scenario: Unrecognized module fails loudly

- **WHEN** the resolved module matches neither generation
- **THEN** registry construction SHALL fail with a diagnosable reason
- **AND** `GET /api/models` SHALL respond `503` with code `MODEL_PROXY_RUNTIME_MISSING`
- **AND** `GET /api/health` SHALL report the model proxy as degraded with that reason

### Requirement: Derived runtime subpaths SHALL be validated, never assumed

Where the dashboard loads a pi-ai entry point other than the resolved main module, it SHALL derive that path only from a recognized resolved-module layout and SHALL verify the target loads before relying on it.

#### Scenario: Unexpected resolved layout is reported

- **WHEN** the resolved module path does not match the expected runtime layout
- **THEN** subpath derivation SHALL fail with an error containing the resolved path
- **AND** the failure SHALL NOT be silently treated as a missing optional capability

#### Scenario: Legacy layout is not probed for factory-only paths

- **WHEN** the resolved module is the legacy generation
- **THEN** the dashboard SHALL NOT require factory-only subpaths to exist

### Requirement: Streaming SHALL preserve the transcript while credentials stay caller-resolved

Upstream streaming SHALL deliver the caller's system prompt and tool definitions to the provider request under either generation. The caller-supplied `apiKey` and headers SHALL be the credentials used upstream, and SHALL take precedence over any credential the runtime resolves for itself.

#### Scenario: System prompt and tools reach the provider request

- **WHEN** a completion is streamed through the compat surface with a context that carries a system prompt and tool definitions **in the keys the runtime's transcript normalization reads**
- **THEN** both SHALL be present in the request sent upstream
- **AND** this SHALL hold identically for both module generations

#### Scenario: Caller context keys are not reinterpreted

- **WHEN** a caller supplies its system prompt under a key the runtime's normalization does not read
- **THEN** the compat surface SHALL NOT silently remap that key
- **AND** the resulting behavior SHALL be unchanged from the behavior before this change

#### Scenario: Caller credentials win

- **WHEN** a completion is streamed with a dashboard-resolved `apiKey` and headers
- **THEN** those values SHALL be the ones sent upstream
- **AND** a credential stored inside the pi-ai runtime SHALL NOT replace them

#### Scenario: OAuth-only providers stream with caller credentials

- **WHEN** a completion is requested for a model whose provider offers no api-key auth method
- **THEN** the request SHALL still be dispatched using the caller-resolved credentials
- **AND** it SHALL NOT fail on the runtime reporting the provider as unconfigured

#### Scenario: Custom-provider model streams through the same path

- **WHEN** a completion is requested for a model belonging to a custom provider
- **THEN** it SHALL be dispatched through the same streaming path as a built-in model
- **AND** the caller-resolved credentials SHALL apply unchanged

#### Scenario: Undispatchable model is reported without leaking credentials

- **WHEN** a completion is requested for a model the runtime cannot dispatch
- **THEN** the request SHALL fail with an error identifying the model and its api
- **AND** no credential material SHALL appear in that error

#### Scenario: Stream stays async-iterable

- **WHEN** any completion is streamed through the compat surface
- **THEN** the returned value SHALL be async-iterable over the runtime's stream events
- **AND** existing consumers SHALL require no change to consume it

### Requirement: OAuth capability SHALL be probed and degrade diagnosably

The dashboard SHALL determine whether the resolved runtime provides a usable OAuth implementation before invoking one, and SHALL treat an entry point that exists but exports nothing usable as absent.

#### Scenario: Relocated OAuth implementation is found

- **WHEN** the runtime provides its OAuth implementation at a location other than the legacy entry point
- **THEN** the dashboard SHALL locate and use it
- **AND** OAuth-credentialed models SHALL refresh as before

#### Scenario: Type-only OAuth stub counts as unavailable

- **WHEN** the runtime's legacy OAuth entry point loads successfully but exports no usable functions
- **THEN** the dashboard SHALL treat OAuth as unavailable rather than invoking it
- **AND** no `TypeError` SHALL be raised from the credential path

#### Scenario: Degradation is partial and observable

- **WHEN** no usable OAuth implementation can be located
- **THEN** api-key-credentialed models SHALL continue to work
- **AND** an OAuth-credentialed model SHALL fail with a diagnosable reason naming the missing capability
- **AND** `GET /api/health` SHALL report that the OAuth capability is unavailable
