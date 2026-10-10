## ADDED Requirements

### Requirement: Generic CRUD aliases
The CRUD alias index SHALL derive aliases only from the entity name, its plural, `table X` / `collection X` phrases and the last segment of dotted identifiers in the entity's Persistence text.

#### Scenario: Dotted identifier
- **WHEN** an entity's Persistence names `cfg.tables.stock_rows`
- **THEN** `stock_rows` is one of its aliases

### Requirement: Object source encoding
`objects-from-db` SHALL decode its source by UTF-16 BOM, else UTF-8, else the job's `encoding`.

#### Scenario: Job encoding
- **WHEN** the job sets `encoding: "windows-1250"` and the source is not valid UTF-8
- **THEN** the source is decoded as windows-1250
