## ADDED Requirements

### Requirement: Property-filtered search
The store SHALL accept optional structured filters and restrict full-text results
to files whose stored properties satisfy every filter. Filter values SHALL be
bound as SQL parameters. When no filters are supplied, results MUST be identical
to the unfiltered query.

#### Scenario: Exact / IN filter intersects full-text hits
- **WHEN** the caller supplies an `eq` or `in` filter on a facet key
- **THEN** only hits whose file has a matching normalized property `value` are
  returned, intersected with the full-text matches by `(root, path)`

#### Scenario: Range filter on a typed key
- **WHEN** the caller supplies a `gte`/`lte` filter on a key declared numeric or
  date
- **THEN** only hits whose file has a `value_num`/`value_date` satisfying the bound
  are returned

#### Scenario: Parameter binding
- **WHEN** a filter value contains SQL metacharacters
- **THEN** it is passed as a bound parameter and cannot alter the executed SQL

#### Scenario: Absent filters are a no-op
- **WHEN** no filters are supplied
- **THEN** the executed query, ranking, and returned hits equal the pre-change
  behavior

### Requirement: Facet aggregation
The store SHALL return, on request, a map of value→count per requested facet key,
where each count is the number of distinct files carrying that value over the
current (optionally filtered) result set.

#### Scenario: Counts per value are distinct-file counts
- **WHEN** the caller requests facets for one or more configured keys
- **THEN** for each key a `value → count` map is returned, reflecting any active
  filters
- **AND** a value repeated within a single file contributes 1 to its count, not N

### Requirement: Schema version gate
The store SHALL record a schema version via `PRAGMA user_version` together with a
facet-configuration hash, and SHALL force a full reindex when either differs from
the current values, then stamp the current values. Existing `chunks`, `nodes`, and
`edges` tables SHALL be unaffected by this change.

#### Scenario: Stale version forces reindex
- **WHEN** the stored `user_version` is older than the current schema version, or
  the stored facet-config hash differs
- **THEN** a full reindex is performed to populate the properties store and
  synthetic meta chunks, and the current version and config hash are stamped

#### Scenario: Up-to-date store skips forced reindex
- **WHEN** the stored version and facet-config hash both match
- **THEN** no forced reindex is triggered by this gate
