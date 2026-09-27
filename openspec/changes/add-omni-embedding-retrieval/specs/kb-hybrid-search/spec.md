## Purpose

Opt-in fusion of lexical (BM25) and dense ranking in the kb engine, reachable via `kb search --hybrid`, bounded by a latency budget and falling back to pure BM25 whenever the dense leg is unavailable.

## ADDED Requirements

### Requirement: Hybrid search is opt-in and default OFF

Hybrid ranking SHALL run only when the merged configuration has `omni.enabled: true`, or for a single CLI call when `kb search --hybrid` is passed (all other hybrid settings then come from the merged configuration and its defaults). A partial `omni` block in project config SHALL merge field-by-field, including nested fusion settings, with the global block and defaults. Without it, search SHALL execute the existing lexical pipeline unchanged and SHALL NOT contact the embedding service or open the vector plane.

#### Scenario: No omni config
- **WHEN** no `omni` block is configured
- **THEN** `kb search` output SHALL be byte-identical to the lexical pipeline's output for the same query

#### Scenario: Partial project config
- **WHEN** global config sets `omni.model` and project config sets only `omni.enabled: true`
- **THEN** hybrid SHALL use the global model and default fusion settings

#### Scenario: Partial nested fusion config
- **WHEN** project config sets only `omni.fusion.k`
- **THEN** the default dense weight SHALL still apply

### Requirement: Rank fusion preserves page guarantees

When hybrid is active, the system SHALL draw a configurable number of candidates from each leg before any source collapsing, fuse them by reciprocal-rank fusion with configurable `k` and dense weight, and SHALL then apply every page step that governs lexical results (exact-content dedup, diversity, source dedup, distinct-source limit, document-type lane rules, optional rerank, and parent-context expansion) to the fused list.

#### Scenario: Distinct sources after fusion
- **WHEN** hybrid returns a page of `limit` N
- **THEN** the page SHALL contain at most N distinct source files, each at most once

#### Scenario: Dense-only hit surfaces
- **WHEN** a relevant chunk shares no terms with the query but ranks top-5 in the dense leg
- **THEN** it SHALL be eligible to appear in the fused page

#### Scenario: Parent context preserved
- **WHEN** a hybrid hit is a subsection
- **THEN** it SHALL carry the same parent context a lexical hit for that chunk carries

#### Scenario: doc_type filter respected
- **WHEN** a document-type filter is passed with hybrid active
- **THEN** the dense lookup SHALL itself be restricted to that document type before fusion

### Requirement: Latency budget and fallback

Query embedding and the nearest-neighbour lookup SHALL be bounded by one configurable timeout. Fusion SHALL run within the search call and SHALL be covered by the search-latency measurement. On timeout, service error, missing weights, unvalidated model, or unavailable vector plane, the search SHALL return the lexical page without error, SHALL count the fallback, and the CLI SHALL report the dense-leg status and fallback reason on stderr. The condensed and JSON result bodies SHALL keep their existing shapes.

#### Scenario: Sidecar down
- **WHEN** hybrid is enabled and the embedding service is not reachable
- **THEN** `kb search` SHALL return the lexical page within the lexical latency plus the timeout
- **AND** stderr SHALL name the fallback reason

#### Scenario: Cold model
- **WHEN** the model is still loading when a query arrives
- **THEN** the search SHALL NOT wait past the timeout

### Requirement: Model-facing tools unchanged

This capability SHALL NOT change the behaviour, schema, or output of any agent tool; hybrid is reachable only through the kb engine and CLI.

#### Scenario: kb_search with omni enabled
- **WHEN** `omni.enabled` is true and the agent calls `kb_search`
- **THEN** its output SHALL be identical to the lexical output for the same query

### Requirement: Evaluation scores the CLI's hybrid routine

The config→search-options mapping SHALL carry the hybrid settings, and evaluation SHALL execute the same hybrid routine the CLI uses, with the same derived options.

#### Scenario: Same routine in eval and CLI
- **WHEN** eval runs the `hybrid` variant with the project config
- **THEN** it SHALL call the same hybrid routine with options equal to those `kb search --hybrid` derives from that config
