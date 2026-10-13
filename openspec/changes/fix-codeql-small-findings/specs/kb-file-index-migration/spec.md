## MODIFIED Requirements

### Requirement: Structural validation and grounding gate
The migration SHALL validate authored rows structurally and run a grounding check on each authored miss purpose before any write, treating structural failure as blocking and reporting ungrounded identifiers. An identifier is present in the source text when it occurs literally with no identifier character (`A-Z`, `a-z`, `0-9`, `_`, `$`) immediately before or after it, so identifiers containing or starting with `$` are found and an identifier is not found inside a longer one.

#### Scenario: Structural validation enforces one row per file
- **WHEN** authored rows are validated against a plan
- **THEN** it fails on a duplicate row, a missing row, an empty purpose, an unexpected row, or a `hit` purpose that differs from the index purpose

#### Scenario: Grounding rejects hallucinated identifiers
- **WHEN** an authored purpose contains a backticked span with significant (mixed-case or underscore) identifiers
- **THEN** each identifier not present in the file's source text and not in the known-stems allowlist is reported as ungrounded

#### Scenario: Cross-reference identifiers allowed
- **WHEN** a backticked identifier matches another source file's stem in the known-stems set
- **THEN** it is treated as grounded even if absent from the current file

#### Scenario: Dollar-prefixed identifier is grounded
- **WHEN** a purpose cites `` `$StoreKey` `` and the source text contains `const $StoreKey = 1`
- **THEN** the grounding check SHALL report no ungrounded identifiers

#### Scenario: Identifier adjacent to a dollar sign is not grounded
- **WHEN** a purpose cites `` `FooBar` `` and the source text contains only `const $FooBar = 1` and `FooBar$x()`
- **THEN** `FooBar` SHALL be reported ungrounded
