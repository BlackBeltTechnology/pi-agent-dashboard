## ADDED Requirements

### Requirement: Scopes map to separate kb databases
The context manager SHALL register the scopes `docs`, `lessons`, `sessions` and `web`.

- `docs` SHALL be served by the session's kb-extension docs provider over its existing per-cwd store. The context manager SHALL NOT write to that store.
- `lessons` SHALL use its own kb database at `<root>/.pi/dashboard/context_manager/lessons.db`, covering markdown under `<root>/.pi/lessons/` (root `lessons:project`) and `~/.pi/agent/lessons/` (root `lessons:global`), where `<root>` is the git toplevel of the session cwd, or the cwd outside a git repository.
- A scope SHALL count as configured when at least one of its root directories exists.
- The first search of a configured scope in a session SHALL bring its database up to date (create and populate, or an incremental walk).
- A markdown write under a lessons root SHALL schedule a reindex of `lessons.db`, and a `lessons` search SHALL first await any pending or in-flight lessons reindex.
- `sessions` and `web` SHALL have no store in this phase, SHALL never be configured, and SHALL return no hits.

#### Scenario: A lesson appears once
- **WHEN** a lesson file under `<root>/.pi/lessons/` also lies inside a configured docs source (as `.pi` is in this repo)
- **THEN** `context_search` with `scope: ["docs", "lessons"]` returns that file once, tagged `[lessons]`
- **AND** `kb_search` behaves as it does without the context manager

#### Scenario: Lessons indexed on first use
- **WHEN** `~/.pi/agent/lessons/` contains a markdown file and `lessons.db` does not exist
- **THEN** the first `context_search` over `lessons` in the session creates `lessons.db`, indexes the file, and can return it

#### Scenario: A lesson edit is searchable
- **WHEN** the agent writes a markdown file under `<root>/.pi/lessons/` and immediately calls `context_search` over `lessons` for a term only the new content contains
- **THEN** the result includes that file

#### Scenario: Session in a subdirectory
- **WHEN** a session's cwd is `<root>/packages/kb`
- **THEN** `lessons` covers `<root>/.pi/lessons/` and uses `<root>/.pi/dashboard/context_manager/lessons.db`

#### Scenario: Unconfigured scope
- **WHEN** `context_search` is called with `scope: "web"`
- **THEN** it returns the no-match result without error

### Requirement: context_search searches docs by default and fuses named scopes with Reciprocal Rank Fusion
`context_search(query, scope?, limit?, format?, doc_type?)` SHALL:
- search each requested scope (default in this phase: `docs` only);
- apply the scope's abstention floor;
- when more than one scope contributes, fuse the lists with Reciprocal Rank Fusion (`k = 60`), with ties going to `docs` and then to the lower within-scope rank, truncated to `limit` (default 10).

Each result SHALL carry its scope tag. A single scope's results SHALL be that scope's ranking unchanged. `docs` results SHALL be the session's kb-extension docs provider results (the `kb_search` code path, fetched with twice the limit) minus hits under a lessons root, truncated to `limit`. When the session has no docs provider, `docs` SHALL return `(docs unavailable)`, never the abstention text. `format` SHALL accept any string, with unknown values rendering the condensed format. An empty query SHALL return `(no query)` in condensed format and `[]` in json.

#### Scenario: Docs parity with kb_search
- **WHEN** no lesson file exists under a docs source, the docs floor is 0, and every query of `golden.markdown-intent.json` and `golden.source-intent.json` runs through `kb_search` and through `context_search` with `scope: "docs"`
- **THEN** both return the same ordered list of (path, heading) pairs for every query

#### Scenario: Lesson hits do not shorten the docs page
- **WHEN** 3 of the top 10 docs hits lie under a lessons root and at least 10 other docs hits exist
- **THEN** `context_search` with `scope: "docs"` and `limit: 10` returns 10 hits, none under a lessons root

#### Scenario: Docs provider missing
- **WHEN** the session has no kb-extension docs provider
- **THEN** `context_search` returns `(docs unavailable)`

#### Scenario: Default call does not include lessons
- **WHEN** `context_search` is called without `scope` and `lessons.db` holds matching lessons
- **THEN** only `docs` results are returned

#### Scenario: Fusion across named scopes
- **WHEN** `scope` is `["docs", "lessons"]`, `docs` ranks A, B, and `lessons` ranks L1, L2
- **THEN** the order is A, L1, B, L2, each tagged with its scope

#### Scenario: Unknown format
- **WHEN** `context_search` is called with `format: "yaml"`
- **THEN** it returns the condensed format without error

#### Scenario: Warm latency
- **WHEN** 100 golden queries run over this repo's warm index with a populated, up-to-date `lessons.db` and `scope: ["docs", "lessons"]`
- **THEN** the p95 `context_search` latency is below 150 ms
- **AND** the cold first-search time for `lessons.db` is reported in `measurements.md` (not budgeted)

### Requirement: context_search abstains only on a per-project calibrated floor
Relevance SHALL be the negated score of a scope's first returned hit (higher is better), either raw or divided by the query-term count. A floor SHALL be stored as `retrieval.floor.<scope> = { value, norm }` with `norm` `raw` or `per-term`. A scope SHALL abstain, contributing no hits, when its first hit's relevance is below its floor. Otherwise its list SHALL be returned unchanged. When every requested scope abstains, `context_search` SHALL return `(no confident match)` in condensed format and `[]` in json. The built-in default for every scope SHALL be `{ value: 0 }`.

A calibration script SHALL report its measurement by default, and SHALL write a `docs` floor into a project's `context_manager.json` only when invoked with `--write` and the measurement passes the ship rule.

Data:
- the golden sets `packages/kb/eval/golden.markdown-intent.json` and `golden.source-intent.json`;
- the committed negative sets `eval/negatives.in-domain.json` and `eval/negatives.off-domain.json`, at least 60 queries each. An in-domain query SHALL be kept only if its key term has no match in the docs kb index, excluding the eval files themselves.

Every set SHALL be split into *select* and *verify* halves by a hash of the query text.

The candidate floor SHALL be the highest with which at most 2 queries per golden set lose their Recall@10 hit on the select halves. It SHALL be written only if, on the verify halves:
- in-domain abstention is at least 50%;
- at most 3 queries per golden set lose their Recall@10 hit;
- P@1 and MRR on `golden.source-intent.json` are within 0.02 of floor 0.

#### Scenario: Unanswerable query
- **WHEN** the project's docs floor is non-zero and the first hit of a query from `negatives.in-domain.json` is below it
- **THEN** the result is `(no confident match)`

#### Scenario: Default floor
- **WHEN** a project has no `retrieval.floor.docs`
- **THEN** `docs` never abstains

#### Scenario: Order untouched
- **WHEN** a scope's first hit is at or above its floor
- **THEN** the scope's hits are returned in exactly the order and number the scope produced

#### Scenario: Calibration record
- **WHEN** the calibration script runs for this repository in report mode
- **THEN** `measurements.md` records the candidate floor and norm, the verify-half counts (with n) of golden queries losing their hit, the P@1/MRR deltas, the abstention per negative set (with n), the index chunk count, and whether the ship rule passed
- **AND** no `context_manager.json` is written

#### Scenario: Write mode respects the ship rule
- **WHEN** the script runs with `--write` and the ship rule fails
- **THEN** no floor is written and the script reports why

### Requirement: context_get fetches a section, a file or its neighbours
`context_get(ref, scope?, section?, neighbors?)` SHALL treat `ref` as a plain path. It SHALL take the scope only from `scope` (`docs` by default, or `lessons`), and SHALL return the chunk from that scope. On a path-only fetch of a multi-section file, it SHALL report the count of further sections rather than silently returning one slice. When `neighbors` is given as a depth, it SHALL return the graph neighbours of the `section` heading node if `section` is given, else of the `ref` file node, up to that depth.

#### Scenario: Multi-section file
- **WHEN** `context_get` is called with only the path of a file that has several sections
- **THEN** the result includes a `(+N more sections` marker

#### Scenario: Windows drive path
- **WHEN** `context_get` is called with `ref: "C:\\repo\\docs\\a.md"`
- **THEN** the ref is resolved in the `docs` scope as a path

#### Scenario: Lesson ref
- **WHEN** `context_get` is called with `scope: "lessons"` and a lesson path
- **THEN** it returns that lesson's content from `lessons.db`

### Requirement: The kb tools stay unchanged in this phase
kb-extension SHALL keep `kb_search`, `kb_get` and `kb_neighbors` registered, active, and unchanged in description, parameters and behaviour, whatever the context manager's state, because pi does not execute calls to inactive tools.

#### Scenario: Old call in an active session
- **WHEN** the context manager is active and the model calls `kb_search`
- **THEN** the call executes and returns the same result as with the context manager disabled
