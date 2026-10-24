## MODIFIED Requirements

### Requirement: Server SHALL provide a content-search endpoint

The server SHALL expose `GET /api/grep?cwd=<cwd>&q=<query>&regex=<bool>` returning
ranked content matches `{ path, line, col, snippet }[]`. The endpoint SHALL prefer
`ripgrep` (`rg`) when available (which honours `.gitignore`) and SHALL fall back to a
bounded in-process scan when `rg` is absent. The scan SHALL cap scanned files, bytes
per file, and total matches to bound response size. The in-process scan SHALL run off
the server's main thread and SHALL be terminated after the same timeout the `rg` path
uses (10 s). A timed-out scan SHALL answer HTTP 504 with `{ success: false, error:
"search timed out" }`, so that no query (including a catastrophic regular expression,
or one `rg` rejects and hands to the fallback) can stall the server.

The endpoint SHALL apply the same security gates as `/api/file`: `cwd` SHALL be admitted by
the shared cwd admission guard (`core-cwd-admission`: a known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is a known folder); resolved match paths SHALL remain within `cwd`; traversal attempts
SHALL be rejected.

#### Scenario: ripgrep-backed search returns matches
- **GIVEN** `ripgrep` is installed
- **WHEN** the client issues `GET /api/grep?cwd=/Users/u/proj&q=MAX_VISITS`
- **THEN** the response lists matches with `path`, `line`, and `snippet`
- **AND** `.gitignore`-ignored paths are excluded

#### Scenario: Fallback scan works without ripgrep
- **GIVEN** `ripgrep` is not on `PATH`
- **WHEN** the client issues a content search
- **THEN** the server performs a bounded in-process scan and returns matches
- **AND** the number of matches does not exceed the configured cap

#### Scenario: Path traversal rejected
- **WHEN** the client issues `GET /api/grep?cwd=/Users/u/proj&q=x` and a match would
  resolve outside `cwd`
- **THEN** that match SHALL be excluded and no path outside `cwd` SHALL be returned

#### Scenario: cwd not a known session is rejected
- **WHEN** the client issues `GET /api/grep` with a `cwd` that is not admitted (not a known folder, nor a subdirectory or linked worktree whose main checkout is a known folder)
- **THEN** the server responds with an error and performs no scan

#### Scenario: Search in a worktree of a pinned repository
- **WHEN** the client issues `GET /api/grep` with a `cwd` that is a sessionless linked worktree of a pinned repository
- **THEN** the server SHALL scan and return matches contained in that worktree

#### Scenario: Pathological regex in the fallback scan cannot stall the server
- **GIVEN** `ripgrep` is not on `PATH` and a file under `cwd` holds a long run of `a`
- **WHEN** the client issues `GET /api/grep?q=(a%2B)%2B%24&regex=true` and, while it runs, another request to the server
- **THEN** the other request SHALL be answered while the scan runs
- **AND** the search SHALL answer HTTP 504 with `{ success: false, error: "search timed out" }` no later than the timeout
