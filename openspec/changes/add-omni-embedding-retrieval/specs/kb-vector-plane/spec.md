## Purpose

Separate, optional vector store for kb units and media items, built by an explicit embed step so the lexical index and its indexer stay embedding-free, with no new dependency or native addon.

## ADDED Requirements

### Requirement: Vector plane is separate from the lexical index

Vectors SHALL be stored in a database file separate from the kb FTS5 index. Building, updating, deleting, or failing to open the vector plane SHALL NOT modify, lock, or invalidate the lexical index.

#### Scenario: kb index does not embed
- **WHEN** `kb index` runs with `omni.enabled` true
- **THEN** it SHALL NOT contact the embedding service and SHALL NOT write the vector plane

#### Scenario: Vector plane deleted
- **WHEN** the vector plane file is deleted
- **THEN** lexical `kb search` SHALL return identical results to before the deletion

### Requirement: No new dependency or native extension

The vector plane SHALL use only the SQLite binding the kb package already uses, with vectors stored as blobs and nearest-neighbour search performed in process. It SHALL NOT require a native SQLite extension or any new package dependency.

#### Scenario: Plain install
- **WHEN** the kb package is installed with no additional packages
- **THEN** `kb embed` and dense search SHALL be able to store and query vectors given a reachable embedding service

### Requirement: Explicit embed build step

The system SHALL provide an explicit `kb embed` command that embeds kb units into the vector plane, re-embeds only units whose content hash changed since the last run for the same model and unit kind, and removes vectors whose unit no longer exists. It SHALL be the only writer of kb-unit vectors.

#### Scenario: Incremental re-embed
- **WHEN** one markdown file changes and `kb embed` runs again
- **THEN** only vectors of units derived from that file SHALL be recomputed
- **AND** the command SHALL report counts of added, updated, removed and unchanged units

#### Scenario: Orphan removal
- **WHEN** a markdown file is deleted and re-indexed, then `kb embed` runs
- **THEN** its vectors SHALL be removed from the vector plane

#### Scenario: New model seeds fully
- **WHEN** the configured model changes and `kb embed` runs without any content change
- **THEN** every unit SHALL be embedded for the new model

### Requirement: Vectors keyed by model, unit, and full source identity

Each vector SHALL be keyed by model id, embedding-unit kind (`file`, `chunk`, `row`, `fused`, `media`), source root (or media set), source path, and a unit id that is unique within that path for that unit kind. Vectors SHALL carry metadata sufficient to filter by document type, modality, and root before ranking. Vectors of different models SHALL never be compared with each other; vectors of different unit kinds from the same model share one space and MAY be ranked together.

#### Scenario: Same relative path in two roots
- **WHEN** two kb roots each contain `AGENTS.md`
- **THEN** their vectors SHALL be stored and returned as distinct entries, each resolving to its own root

#### Scenario: Several rows in one AGENTS file
- **WHEN** an AGENTS file has many DOX rows and `row` units are embedded
- **THEN** each row SHALL be stored as a distinct vector under that file's path

#### Scenario: Two models coexist
- **WHEN** `kb embed` runs for two models with different dimensions
- **THEN** both SHALL be stored
- **AND** a search configured for one model SHALL only rank vectors of that model

#### Scenario: Filtered lookup
- **WHEN** a dense lookup is restricted to one document type
- **THEN** up to the requested candidate count SHALL be returned from that document type only

### Requirement: Vector persistence behind an interface

The kb search and eval layers SHALL access vectors only through a vector-store interface and SHALL obtain embeddings only through an embedder interface, so that an alternative vector backend or embedding service can be substituted without changing search, eval, parser, chunker, or graph code.

#### Scenario: Substitute embedder in tests
- **WHEN** tests supply an in-memory embedder
- **THEN** `kb embed` and dense search SHALL run without any embedding service
