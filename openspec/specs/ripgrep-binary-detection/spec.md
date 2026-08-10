# ripgrep-binary-detection Specification

## Purpose

Detect whether the `ripgrep` (`rg`) binary is available on the host once and cache the result, so that consumers (such as the `GET /api/grep` route) can prefer a native `rg` search when it is present. This spec covers only the detection and caching API; how consumers use the result is out of scope.

## Requirements

### Requirement: One-time cached detection of the `rg` binary

The system SHALL resolve the absolute path of the `rg` binary on first call and reuse the cached result for every subsequent call without repeating the PATH lookup. The lookup is performed via a `ToolResolver` constructed with `{ processExecPath: process.execPath }`. The `whichFn` used to perform the lookup is an injectable parameter that defaults to the resolver's `which` method for tests.

#### Scenario: First detection resolves and caches the path

- **WHEN** `detectRipgrep()` is called for the first time
- **THEN** the system SHALL look up the binary named `rg` via `whichFn` (defaulting to the `ToolResolver`'s `which`)
- **AND** it SHALL cache the resolved absolute path (or `null` when absent)
- **AND** it SHALL return that cached value

#### Scenario: Subsequent detection reuses the cache

- **WHEN** `detectRipgrep()` is called after the first call
- **THEN** the system SHALL return the previously cached value
- **AND** it SHALL NOT perform another PATH lookup

#### Scenario: `rg` absent from PATH

- **WHEN** the `whichFn` lookup for `rg` finds no binary
- **THEN** the cached detection result SHALL be `null`
- **AND** a subsequent call SHALL return the cached `null` without performing another lookup

#### Scenario: Cache uses an undefined sentinel

- **WHEN** `detectRipgrep()` checks whether a cached value exists
- **THEN** it SHALL short-circuit only when the cache is not `undefined`
- **AND** a cached `null` result SHALL short-circuit without re-performing the lookup

#### Scenario: Cache reset for tests

- **WHEN** `resetRipgrepCache()` is called
- **THEN** the cache SHALL be set back to `undefined`
- **AND** the next `detectRipgrep()` call SHALL perform a fresh lookup rather than returning a prior cached value
