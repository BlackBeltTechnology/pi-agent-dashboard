## MODIFIED Requirements

### Requirement: Static serving overhead is bounded

For a target whose `cwd` is admitted by direct match, the first serve of an HTML document, including its origin scan, SHALL add at most 150 ms at the 95th percentile over a plain read of the same file, for a 2 MiB document linking 10 same-root stylesheets. The per-request access re-check SHALL add at most 10 ms at the 95th percentile for a target whose `cwd` the shared cwd admission guard admits by direct match (a known folder: session cwd, pinned directory or workspace folder). For a target whose `cwd` is admitted only through its repository's main checkout, the first serve and every re-check include a git derivation and SHALL each be bounded by the admission deadline instead.

#### Scenario: Scan overhead within budget
- **GIVEN** a static target whose `cwd` is a known folder (session cwd, pinned directory or workspace folder), and a 2 MiB HTML document linking 10 same-root stylesheets
- **WHEN** it is first served 50 times under a restricted capability (fresh target each time)
- **THEN** the 95th-percentile added time over a plain read is at most 150 ms

#### Scenario: Gate overhead within budget
- **GIVEN** a static target whose `cwd` is a known folder (session cwd, pinned directory or workspace folder), serving a 20 KB stylesheet
- **WHEN** it is requested 200 times
- **THEN** the 95th-percentile time spent in the access re-check is at most 10 ms

#### Scenario: Derived-worktree target re-check is bounded by the admission deadline
- **GIVEN** a static target whose `cwd` is a sessionless linked worktree of a pinned repository
- **WHEN** an asset is requested
- **THEN** the access re-check SHALL complete within the admission deadline, and an undecidable admission SHALL refuse the asset
