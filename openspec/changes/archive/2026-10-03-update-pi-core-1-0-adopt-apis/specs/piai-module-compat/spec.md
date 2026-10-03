## ADDED Requirements

### Requirement: The dashboard SHALL run against the factory pi-ai module generation only

The dashboard SHALL run against the factory pi-ai module generation only (`createModels` / `createProvider`), which is the only generation at or above the `1.0.0` floor. It SHALL validate the full set of factory members and SHALL present a single internal module surface to its consumers. The legacy global-registry generation is no longer supported and SHALL NOT be passed through.

#### Scenario: Factory module is adapted

- **WHEN** the resolved module exposes the factory API markers
- **THEN** the dashboard SHALL build a built-in model collection from that module
- **AND** provider enumeration, model enumeration, and single-model lookup SHALL answer from that collection

#### Scenario: Legacy module is rejected

- **WHEN** the resolved module exposes the legacy global-registry API and not the factory markers
- **THEN** registry construction SHALL fail with a reason naming the module as an unsupported legacy pi-ai below the floor
- **AND** the module SHALL NOT be used as-is

#### Scenario: Partial module is rejected rather than misclassified

- **WHEN** the resolved module exposes some but not all factory members
- **THEN** classification SHALL fail with a reason naming the missing members

#### Scenario: Unrecognized module fails loudly

- **WHEN** the resolved module is not a complete factory module
- **THEN** registry construction SHALL fail with a diagnosable reason
- **AND** `GET /api/models` SHALL respond `503` with code `MODEL_PROXY_RUNTIME_MISSING`
- **AND** `GET /api/health` SHALL report the model proxy as degraded with that reason

### Requirement: Derived factory-runtime subpaths SHALL be validated, never assumed

Where the dashboard loads a pi-ai entry point other than the resolved main module, it SHALL derive that path only from a recognized resolved-module layout and SHALL verify the target loads before relying on it.

#### Scenario: Unexpected resolved layout is reported

- **WHEN** the resolved module path does not match the expected runtime layout
- **THEN** subpath derivation SHALL fail with an error containing the resolved path
- **AND** the failure SHALL NOT be silently treated as a missing optional capability

## REMOVED Requirements

### Requirement: The dashboard SHALL run against either pi-ai module generation

**Reason**: The legacy global-registry pi-ai generation is below the 1.0.0 floor.

**Migration**: Replaced by "The dashboard SHALL run against the factory pi-ai module generation only"; a legacy module is rejected with a diagnosable reason.

### Requirement: Derived runtime subpaths SHALL be validated, never assumed

**Reason**: Its legacy-layout scenario is unreachable once the legacy generation is rejected.

**Migration**: See "Derived factory-runtime subpaths SHALL be validated, never assumed".
