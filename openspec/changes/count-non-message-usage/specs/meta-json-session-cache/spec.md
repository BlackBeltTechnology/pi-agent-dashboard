## ADDED Requirements

### Requirement: Cached stats carry an extractor version

The per-session sidecar SHALL record the version of the stats extractor that produced its cached totals. On discovery, cached totals whose extractor version is absent or older than the current one SHALL be re-extracted from the session JSONL even when the JSONL is not newer than the cache.

#### Scenario: Pre-upgrade cache is re-extracted
- **WHEN** a sidecar written before non-message usage was counted is loaded
- **THEN** the session's totals SHALL be re-extracted from its JSONL and the sidecar updated with the current extractor version

#### Scenario: Current cache is reused
- **WHEN** a sidecar carries the current extractor version and the JSONL is not newer
- **THEN** its cached totals SHALL be used without re-parsing
