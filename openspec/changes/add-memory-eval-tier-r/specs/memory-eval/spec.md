## ADDED Requirements

### Requirement: Mined data stays local
The memory eval SHALL write cases, retrieved text, verdicts and run manifests only under `~/.pi/dashboard/memory-eval/<project-key>/`, created with mode `0700`, where `<project-key>` is the project's pi session directory name. It SHALL open pi session files, hermes `sessions.db` and the kb index read-only, and SHALL search a `VACUUM INTO` copy of the kb index kept in the work dir. Reports SHALL contain only aggregate figures and identifiers (counts, rates, intervals, retriever ids and versions, judge model, prompt version, case-set hash), and SHALL NOT contain any case query, case context or retrieved text.

#### Scenario: Work dir permissions
- **WHEN** `memory-eval cases build` runs for a project with no work dir
- **THEN** the work dir is created with mode `0700`
- **AND** no file is written outside it

#### Scenario: Report carries no case text
- **WHEN** a report is generated for a run
- **THEN** no substring of 12 or more characters from any case's query, context, or retrieved text appears in the report

#### Scenario: Sources untouched
- **WHEN** a full build, run and judge cycle completes
- **THEN** the modification times and sizes of the session files, hermes `sessions.db` and the kb index are unchanged

### Requirement: Cases are mined deterministically with stable ids
`memory-eval cases build` SHALL derive `recurring_fault`, `user_flagged`, `explicit_ref` and `negative` cases from the project's session JSONL files, following the design's rules for error signatures, fixes, queries and exclusions. Each case SHALL carry its decision time (the timestamp of its triggering event), its query and context, and, where the type defines them, its gold sessions. Sampling SHALL use a seed (default 5) and configurable quotas. A case id SHALL be the first 12 hex digits of the SHA-256 of its type, session id, timestamp and signature or text. The case set SHALL record a case-set hash over its sorted ids and queries.

#### Scenario: Reproducible build
- **WHEN** `cases build` runs twice with the same seed, quotas and session files
- **THEN** both runs produce byte-identical `cases.json` files with the same case-set hash

#### Scenario: Recurring fault
- **WHEN** session S1 fails with signature X and fixes it with a different command head, and a later session S2 fails with signature X
- **THEN** a `recurring_fault` case exists for S2 with gold sessions containing S1
- **AND** its decision time is the timestamp of S2's failing result

#### Scenario: Generic and frequent signatures excluded
- **WHEN** a signature matches the generic list (e.g. `(no output)`), or occurs in more than `max(3, 5%)` of sessions
- **THEN** it produces no `recurring_fault` and no `negative` case

#### Scenario: First-ever failure is a negative
- **WHEN** an eligible signature occurs in exactly one session
- **THEN** it may be sampled as a `negative` case with no gold sessions

#### Scenario: Pasted logs and skill prompts are not user-flagged
- **WHEN** a user turn contains "again" inside a pasted log (e.g. "try again later" with a stack trace), or starts with `<skill`
- **THEN** it produces no `user_flagged` case

#### Scenario: Explicit reference needs another session
- **WHEN** a user turn says "I have another session <uuid> which contains …" and the UUID is not the turn's own session
- **THEN** an `explicit_ref` case exists with that UUID as its gold session
- **AND** a turn naming only its own session id produces no case

#### Scenario: Query skips cd and env prefixes
- **WHEN** a failing bash command is `cd packages/kb && FOO=1 npx vitest run x`
- **THEN** the query starts with `npx vitest` and contains no path-like token

### Requirement: Retrievers answer strictly as of the decision time
Every retriever adapter SHALL implement `search({ query, asOf, project, cwd })` and SHALL NOT return an item whose timestamp is at or after `asOf`. The run SHALL keep each retriever's top 5 hits, each clipped to 260 characters. The package SHALL provide the old-stack adapters `hermes.session_search.recent`, `hermes.session_search.bm25`, `hermes.memory_search` and `kb.docs`, and SHALL accept further adapters from a module passed with `--retriever-module`.

#### Scenario: No future leakage
- **WHEN** a case's decision time is T and the store holds a matching message at T and one at T−1 s
- **THEN** only the T−1 s message can be returned

#### Scenario: Newest-first replica
- **WHEN** `hermes.session_search.recent` and the installed hermes `searchSessions` run on the same query table and the same `sessions.db` (limit 10, same project)
- **THEN** both return the same ordered session ids for every query
- **AND** the test is skipped when hermes is not installed

#### Scenario: BM25 variant query plan
- **WHEN** `hermes.session_search.bm25` runs one query against a `sessions.db` holding 45,000 messages
- **THEN** it completes in under 500 ms

#### Scenario: External adapter module
- **WHEN** `run --retriever-module ./x.mjs` names a module default-exporting `[{ id: "context-manager.sessions", version: "1", search }]`
- **THEN** the run includes that retriever alongside the selected built-in adapters

#### Scenario: kb leakage labelled
- **WHEN** a report includes `kb.docs`
- **THEN** the report marks its figures as an upper bound, because the indexed docs may postdate the cases

### Requirement: The judge is versioned, cached, consented and fail-safe
The judge SHALL use the prompt `prompts/judge.v1.md` and SHALL issue two kinds of verdict: validity, once per case, and helpfulness, once per case and retriever output. The model SHALL be resolved from `--judge`: a role (default `@review`) is looked up in `~/.pi/agent/providers.json#roles`, or a `provider/id` is used directly. Each call SHALL run `pi -p --no-session --no-extensions --no-skills --no-context-files --model <provider/id>`.

Case and retrieved text SHALL be passed as delimited data with an instruction to treat it as data. Verdicts SHALL be appended to `verdicts.jsonl`, keyed by kind, case id, output hash (for helpfulness), prompt version and judge model, and a verdict with an identical key SHALL be reused without a call.

A non-zero exit, a timeout, malformed JSON or missing ids SHALL be retried once; after a second failure the affected items SHALL be recorded as `unjudged` with the error, and SHALL be excluded from every denominator.

Before the first remote call of a run, the CLI SHALL print the provider, the model, and the number of items and batches, and SHALL require confirmation unless `--yes` is given. `--dry-run` SHALL make no calls.

#### Scenario: Cache hit
- **WHEN** `judge` runs twice on an unchanged run with the same judge model and prompt version
- **THEN** the second run makes no model call and reports every item as cached

#### Scenario: Changed output is re-judged
- **WHEN** a retriever's top 5 for a case changes between runs
- **THEN** only that (case, retriever) item is judged again

#### Scenario: Provider failure
- **WHEN** the judge call exits non-zero twice for a batch (e.g. `402 Insufficient Balance`)
- **THEN** that batch's items are recorded as `unjudged` with the error text
- **AND** the report counts them separately and excludes them from every rate

#### Scenario: Malformed answer
- **WHEN** the judge returns JSON missing one case id, then does so again on retry
- **THEN** the present ids are recorded and the missing one is `unjudged`

#### Scenario: Consent
- **WHEN** `judge` runs in a TTY without `--yes`
- **THEN** it prints the provider, model, item and batch counts, and makes no call until the user confirms

#### Scenario: Dry run
- **WHEN** `judge --dry-run` runs
- **THEN** it prints the plan and makes no model call

#### Scenario: Unknown role
- **WHEN** `--judge @missing` names no configured role
- **THEN** the command exits non-zero, naming the role and the providers file, before any call

### Requirement: Reports measure helpfulness, false injection and abstention
A report for a run SHALL give, per retriever and per case type:
- helpful@5 on valid, judged positives as k/n with a Wilson 95% interval;
- the union "any old-stack retriever helpful";
- on valid negatives, the returned-anything, judged-helpful and abstention rates;
- the median kept size in characters;
- gold-session hit@5 and hit@10 for `recurring_fault` and `explicit_ref`;
- the counts of invalid and unjudged items;
- blackhole `recall` listed as 0% by construction (current-session only).

`report --compare <runA> <runB>` SHALL refuse runs with different case-set hashes, and otherwise SHALL report, over cases valid and judged in both runs, the paired wins, losses and ties per retriever pair with an exact McNemar p-value.

#### Scenario: Interval on a known fixture
- **WHEN** a retriever is judged helpful on 19 of 56 valid positives
- **THEN** the report shows `19/56` with a Wilson 95% interval of 22.9%–47.0% (rounded to 0.1)

#### Scenario: Unjudged excluded
- **WHEN** 3 of 56 valid positives are `unjudged` for a retriever
- **THEN** its denominator is 53 and the report shows `unjudged: 3`

#### Scenario: Comparison refuses mismatched sets
- **WHEN** `report --compare` is given two runs whose case-set hashes differ
- **THEN** it exits non-zero naming both hashes

#### Scenario: Paired comparison
- **WHEN** two runs over the same case set have 10 cases helpful only in A, 2 helpful only in B, and the rest tied
- **THEN** the comparison shows wins 10, losses 2, and the exact McNemar p-value 0.0386 (rounded to 4 places)

### Requirement: Every run is reproducible from its manifest
Each run SHALL write a manifest recording the case-set hash, seed and quotas, the retriever ids, versions and module paths, the judge model, role and prompt version, the pi version, the kb chunk count, the hermes table row counts and the run date. `memory-eval status` SHALL list runs with their case-set hash and judged or unjudged counts.

#### Scenario: Manifest completeness
- **WHEN** a run completes
- **THEN** its manifest contains every field listed above, with none empty
