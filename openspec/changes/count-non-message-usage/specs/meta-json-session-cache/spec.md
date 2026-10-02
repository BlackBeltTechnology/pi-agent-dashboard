## ADDED Requirements

### Requirement: Cached stats carry an extractor version

The per-session sidecar SHALL record the version of the stats extractor that produced its cached totals. On discovery of a non-archived session, cached totals whose extractor version is absent or older than the current one SHALL be re-extracted from the session JSONL even when the JSONL is not newer than the cache. Archived sessions SHALL keep the existing rule that discovery does not open their JSONL; they are corrected at their first discovery or hydration after unarchive.

#### Scenario: Pre-upgrade cache is re-extracted
- **WHEN** a non-archived sidecar written before non-message usage was counted is loaded
- **THEN** the session's totals SHALL be re-extracted from its JSONL and the sidecar updated with the current extractor version

#### Scenario: Current cache is reused
- **WHEN** a sidecar carries the current extractor version and the JSONL is not newer
- **THEN** its cached totals SHALL be used without re-parsing

#### Scenario: Archived sidecar is not opened
- **WHEN** an archived sidecar without an extractor version is discovered
- **THEN** its JSONL SHALL NOT be opened

#### Scenario: Version survives a routine save
- **WHEN** a session whose sidecar carries the current extractor version is saved through the full-overwrite path
- **THEN** the rewritten sidecar SHALL still carry that extractor version

## MODIFIED Requirements

### Requirement: Persisted contextWindow is authoritative on stale-cache re-extract
The system SHALL preserve the previously persisted `contextWindow` in `.meta.json` whenever a re-extraction — triggered by a stale cache (JSONL newer than `cachedAt`) or by an absent or older stats extractor version — would otherwise overwrite it with a value derived from `.jsonl` parsing or model-id inference. The persisted value MAY only be replaced when the active model changes (the previously persisted value no longer applies) or when no value was previously persisted.

Rationale: pi's persisted `.jsonl` contains no `turn_end` or `contextUsage` entries, so any value `extractSessionStats` returns for `contextWindow` is necessarily an `inferContextWindow(modelId)` heuristic that pins Claude to `200_000` and ignores 1M variants. The persisted `meta.contextWindow` came from a live `turn_end` event carrying the LLM's reported value and is the only reliable source.

#### Scenario: Stale cache re-extract preserves persisted contextWindow when model unchanged
- **GIVEN** a `.meta.json` with `model: "anthropic/claude-sonnet-4-20250514"` and `contextWindow: 1_000_000`
- **AND** the `.jsonl` mtime is newer than `meta.cachedAt` (forcing re-extract)
- **AND** `extractSessionStats` returns the same model with an inferred `contextWindow: 200_000`
- **WHEN** the scanner merges stats into meta
- **THEN** the resulting `contextWindow` SHALL be `1_000_000`
- **AND** the persisted `.meta.json` SHALL still report `contextWindow: 1_000_000`

#### Scenario: Version-triggered re-extract preserves persisted contextWindow
- **GIVEN** a `.meta.json` with no stats extractor version, `model: "anthropic/claude-sonnet-4-20250514"` and `contextWindow: 1_000_000`
- **AND** the `.jsonl` is not newer than `meta.cachedAt`
- **WHEN** the scanner re-extracts and merges stats into meta
- **THEN** the resulting `contextWindow` SHALL be `1_000_000`

#### Scenario: Stale cache re-extract adopts inferred contextWindow when model changes
- **GIVEN** a `.meta.json` with `model: "openai/gpt-4o"` and `contextWindow: 128_000`
- **AND** the `.jsonl` mtime is newer than `meta.cachedAt`
- **AND** `extractSessionStats` returns a different model `"anthropic/claude-sonnet-4-20250514"` with `contextWindow: 200_000`
- **WHEN** the scanner merges stats into meta
- **THEN** the resulting `model` SHALL be `"anthropic/claude-sonnet-4-20250514"`
- **AND** the resulting `contextWindow` SHALL be `200_000`

#### Scenario: First-extract path infers contextWindow when no meta exists
- **GIVEN** a `.jsonl` file with no corresponding `.meta.json`
- **WHEN** the scanner falls back to `.jsonl` parsing and writes a fresh `.meta.json`
- **THEN** `contextWindow` SHALL be the value returned by `extractSessionStats` (which is `inferContextWindow(model)`)
