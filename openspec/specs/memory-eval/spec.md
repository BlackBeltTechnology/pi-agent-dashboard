# memory-eval Specification

## Purpose
TBD - created by archiving change add-memory-eval-tier-r. Update Purpose after archive.

## Requirements

### Requirement: Mined data stays local
The memory eval SHALL itself write cases, snapshots, retrieved text, verdicts, call logs and run manifests only under `~/.pi/dashboard/memory-eval/<project-key>/`, where `<project-key>` is the project's pi session directory name. The work dir SHALL have mode `0700` and its files mode `0600`, set at creation and re-applied when they already exist. The eval SHALL NOT open or mutate pi session files beyond reading them, and SHALL NOT open hermes `sessions.db` or the kb index with SQLite at all. It SHALL file-copy each database together with its `-wal` file into the work dir, retry the copy while the source changes during it, integrity-check the copy, `VACUUM INTO` a snapshot, and query only the snapshots. A missing source SHALL mark its dependent adapters `unavailable` and record `absent`, never an error or silent zero. Files written by the `pi` child process the judge spawns are outside this requirement. Reports SHALL be rendered from an aggregate structure that holds only figures and identifiers (counts, rates, intervals, retriever ids and versions, judge model, prompt version, hashes), and SHALL NOT contain any case query, case context or retrieved text.

#### Scenario: Work dir permissions
- **WHEN** `memory-eval cases build` runs for a project with no work dir
- **THEN** the work dir is created with mode `0700`
- **AND** no file is written outside it

#### Scenario: Report carries no case text
- **WHEN** a report is generated from a fixture whose every case query, context and retrieved snippet contains a unique marker token
- **THEN** no marker token appears in the report

#### Scenario: Sources untouched
- **WHEN** a full build, run and judge cycle completes against a fixture copy of the session files, a WAL-mode hermes `sessions.db` with uncheckpointed frames, and a kb index
- **THEN** the session files, both database files and their `-wal`/`-shm` sidecars are byte-identical to before the cycle
- **AND** the hermes snapshot contains the rows that existed only in the WAL

#### Scenario: Absent hermes database
- **WHEN** a run starts and hermes `sessions.db` does not exist
- **THEN** the hermes adapters are reported `unavailable`, are excluded from the union, and the manifest records `absent`

### Requirement: Cases are mined deterministically with stable ids
`memory-eval cases build` SHALL derive `recurring_fault`, `user_flagged`, `explicit_ref` and `negative` cases from the project's session JSONL files, following the design's rules for error signatures, fixes, queries and exclusions. Each case SHALL carry:
- its decision time (the timestamp of its triggering event);
- its query and context, and a content hash over its query, context and gold sessions;
- its gold sessions, where the type defines them.

Sampling SHALL use a seeded `mulberry32` PRNG (default seed 5) over candidates sorted by case id, with configurable quotas. A case id SHALL be the first 12 hex digits of the SHA-256 of its type, session id, timestamp and signature or text. The case set SHALL record a case-set hash over its sorted ids and content hashes, plus an input-file fingerprint over file names and content hashes, and per-type counts. The set file SHALL hold no set name, wall-clock time or absolute path. `cases build` SHALL refuse to overwrite an existing named case set unless `--force` is given.

#### Scenario: Reproducible build
- **WHEN** `cases build` runs twice with the same seed, quotas and session files into two set names
- **THEN** both runs produce byte-identical set files with the same case-set hash

#### Scenario: Frozen set
- **WHEN** `cases build` runs while the set `baseline` already exists and `--force` is absent
- **THEN** it exits non-zero and leaves the existing set unchanged

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
- **WHEN** a user turn contains "again" and either contains a ```` ``` ```` fence, or has 2 or more lines matching a log or stack shape (`at …(file:line)`, `Error:`, `Traceback`, `[INFO|WARN|ERROR]`, a leading `HH:MM:SS`), or starts with `<skill`
- **THEN** it produces no `user_flagged` case

#### Scenario: No sessions
- **WHEN** `cases build` runs for a project whose session dir is missing or holds no `*.jsonl` files
- **THEN** it exits non-zero naming the dir, and writes no set file

#### Scenario: Explicit reference needs another session
- **WHEN** a user turn says "I have another session <uuid> which contains …" and the UUID is not the turn's own session
- **THEN** an `explicit_ref` case exists with that UUID as its gold session
- **AND** a turn naming only its own session id produces no case

#### Scenario: Query skips cd and env prefixes
- **WHEN** a failing bash command is `cd packages/kb && FOO=1 npx vitest run x`
- **THEN** the query starts with `npx vitest` and contains no path-like token

### Requirement: Retrievers answer strictly as of the decision time
Every retriever adapter SHALL implement `search({ query, asOf, project, cwd, excludeSessionId })` and SHALL declare an `asOf` mode of `strict` or `none`. A `strict` adapter SHALL apply `asOf` and `excludeSessionId` before its result limit, so later or own-session items never take slots in its result. `hermes.session_search.bm25` MAY return fewer results than its limit because of its bounded FTS window, and each such under-fill SHALL be counted; it SHALL NOT return an ineligible item. As a backstop, the harness SHALL drop every hit that has no timestamp or a timestamp at or after `asOf` (compared as epoch milliseconds), and SHALL count each dropped hit as an as-of violation. An adapter declaring `none` SHALL be reported separately as a non-as-of reference, and SHALL be excluded from the union and from every as-of figure. As a backstop, the harness SHALL also drop any hit from the case's own session, and SHALL report the own-session share per session-backed retriever. The run SHALL keep each retriever's top 5 hits, each clipped to 260 characters, for judging, and its top 10 `(ref, sessionId)` pairs, without text, for gold metrics. Both are taken after own-session exclusion.

The package SHALL provide the old-stack adapters `hermes.session_search.recent`, `hermes.session_search.bm25` and `hermes.memory_search` (all `strict`), and `kb.docs` (`none`). It SHALL accept further adapters from a module passed with `--retriever-module`, applying the same as-of enforcement, hit-schema validation and a per-search timeout to them.

#### Scenario: No future leakage
- **WHEN** a case's decision time is T and the store holds a matching message at T and one at T−1 s
- **THEN** only the T−1 s message can be returned

#### Scenario: Future rows do not take slots
- **WHEN** a store holds 20 matching rows after a case's decision time that outrank 10 eligible matching rows
- **THEN** `hermes.session_search.recent` and `hermes.memory_search` return eligible rows only, filling their limit from them
- **AND** `hermes.session_search.bm25` returns eligible rows only
- **AND** every as-of violation count is 0

#### Scenario: Own-session hits removed
- **WHEN** the store holds matching rows from the case's own session and from other sessions
- **THEN** no own-session row is among the kept top 5 or the stored top 10, the kept top 5 are filled from other sessions, and the report's own-session share for that retriever counts the own-session matches

#### Scenario: Missing timestamp dropped
- **WHEN** a `strict` adapter returns a hit with no timestamp
- **THEN** the hit is dropped and the report counts one as-of violation for that retriever

#### Scenario: Same-day memory excluded
- **WHEN** a hermes memory was created on the same UTC date as a case's decision time
- **THEN** `hermes.memory_search` does not return it for that case

#### Scenario: Newest-first replica
- **WHEN** `hermes.session_search.recent` runs on the committed golden query table and its synthetic `sessions.db`
- **THEN** it returns the golden ordered session ids for every query
- **AND** when hermes is installed, the installed `searchSessions` returns the same ids on the same fixture (skipped otherwise)

#### Scenario: BM25 variant query plan
- **WHEN** `hermes.session_search.bm25` runs one query against a `sessions.db` holding 45,000 messages, including a query whose top 5,000 FTS rows leave fewer than 10 eligible rows
- **THEN** each query completes in under 500 ms

#### Scenario: External adapter module
- **WHEN** `run --retriever-module ./x.mjs` names a module default-exporting `[{ id: "context-manager.sessions", version: "1", asOf: "strict", search }]`
- **THEN** the run includes that retriever alongside the selected built-in adapters
- **AND** the manifest records its id, version, module path and module hash

#### Scenario: Invalid external module
- **WHEN** the module passed with `--retriever-module` fails to load, lacks a `Retriever[]` default export, or reuses an already-loaded id
- **THEN** the run exits non-zero before any search, naming the module path and the reason

#### Scenario: External adapter timeout
- **WHEN** an external adapter's search does not resolve within its timeout
- **THEN** that search is recorded as an error with no hits, and the run continues

#### Scenario: kb is a separate reference
- **WHEN** a report includes `kb.docs`
- **THEN** its figures appear in a separate non-as-of section, and the union excludes it

### Requirement: The judge is versioned, cached, consented and fail-safe
The judge SHALL use the prompt `prompts/judge.v1.md` and SHALL issue two kinds of verdict: validity, once per case, and helpfulness, once per case and retriever output. The model SHALL be resolved from `--judge` with `resolveModelRef` from `packages/shared`: a role (default `@review`) is looked up in `~/.pi/agent/providers.json#roles`, or a `provider/id[:thinking]` ref is used directly. Each call SHALL run with the work dir as cwd and the batch prompt on stdin, as:

```
pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools --model <ref>
```

The `--model` value SHALL be a `provider/id[:thinking]` ref, never an `@role`. Before it is sent, case and retrieved text SHALL pass through a best-effort secret scrub, and SHALL be wrapped as delimited data with an instruction to treat it as data.

Verdicts SHALL be appended to `verdicts.jsonl`, keyed by kind, case id, case content hash, output hash (helpfulness only), prompt version, prompt file hash, scrub rule hash and judge model, where the output hash covers the retriever id, its version and its top 5. A verdict with an identical key SHALL be reused without a call.

A non-zero exit, a timeout or unparseable JSON SHALL fail the batch, which SHALL be retried once. A parseable answer missing some ids SHALL keep the present ids and retry only the missing ones once. Items that fail a second time SHALL be recorded as `unjudged` with the error, and SHALL NOT be cached. A validity-unjudged case SHALL be excluded from every denominator. A helpfulness-unjudged item SHALL be excluded from every helpfulness-based denominator.

Before the first remote call of a run, the CLI SHALL print the provider, the model, the number of items and batches, and the data classes sent. It SHALL then:
- require confirmation when run in a TTY without `--yes`;
- exit non-zero without any call when stdin is not a TTY and `--yes` is absent.

`--dry-run` SHALL make no calls. Every call SHALL be logged to the run's `judge-calls.jsonl` with its duration, exit code, outcome and payload hash.

#### Scenario: Judge argv
- **WHEN** the judge builds a model call
- **THEN** the argv is exactly `pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools --model <ref>`, and the cwd is the work dir

#### Scenario: Cache hit
- **WHEN** `judge` runs twice on an unchanged run with the same judge model and prompt version
- **THEN** the second run makes no model call and reports every item as cached

#### Scenario: Changed output is re-judged
- **WHEN** a retriever's top 5 for a case changes between runs
- **THEN** only that (case, retriever) item is judged again

#### Scenario: Changed case content is re-judged
- **WHEN** a case keeps its id but its query changes
- **THEN** its validity verdict and its helpfulness verdicts are judged again

#### Scenario: Edited prompt re-judges
- **WHEN** `prompts/judge.v1.md` is edited without a version bump and `judge` runs again
- **THEN** every item is judged again

#### Scenario: Edited scrub rules re-judge
- **WHEN** a scrub rule is added and `judge` runs again
- **THEN** every item is judged again

#### Scenario: Provider failure
- **WHEN** the judge call exits non-zero twice for a batch (e.g. a billing error)
- **THEN** that batch's items are recorded as `unjudged` with the error text
- **AND** the report counts them separately and excludes them from every rate

#### Scenario: Malformed answer
- **WHEN** the judge returns JSON missing one case id, then does so again on retry
- **THEN** the present ids are recorded and the missing one is `unjudged`

#### Scenario: Secret scrub
- **WHEN** a case's context contains `Authorization: Bearer abc.def.ghi`, an `sk-` key, a JWT, `https://u:p@host`, `--token xyz` or `API_TOKEN=xyz`
- **THEN** the batch payload sent to the model contains `[REDACTED:` in each place, and contains none of the original values
- **AND** a 40-hex commit hash in the same context is not redacted

#### Scenario: Consent
- **WHEN** `judge` runs in a TTY without `--yes`
- **THEN** it prints the provider, model, item and batch counts and the data classes, and makes no call until the user confirms

#### Scenario: Non-interactive without consent
- **WHEN** `judge` runs with stdin not a TTY and without `--yes`
- **THEN** it exits non-zero before any model call

#### Scenario: Dry run
- **WHEN** `judge --dry-run` runs
- **THEN** it prints the plan and makes no model call

#### Scenario: Unknown role
- **WHEN** `--judge @missing` names no configured role
- **THEN** the command exits non-zero, naming the role and the providers file, before any call

### Requirement: Reports measure helpfulness, false injection and abstention
A report for a run SHALL give, per retriever and per case type:
- helpful@5 on valid, judged positives as k/n with a Wilson 95% interval;
- the union "any as-of old-stack retriever helpful", computed over the cases judged for every constituent retriever, with that intersection n shown;
- on valid negatives, the returned-anything and abstention rates over all valid negatives, and the judged-helpful rate over the judged valid negatives;
- the median kept size in characters;
- gold-session hit@5 and hit@10 for `recurring_fault` and `explicit_ref`;
- the counts of invalid items, unjudged items, as-of violations, under-fills and own-session hits;
- `unavailable` adapters listed with no figures;
- blackhole `recall` listed as 0% by construction (current-session only);
- `asOf: none` adapters in a separate section.

`report --compare <runA> <runB>` SHALL refuse runs with different case-set hashes. It SHALL also refuse runs with a different judge model or prompt version, unless `--allow-judge-mismatch` is given, in which case it SHALL print a mismatch banner. Otherwise it SHALL report, over cases valid and judged in both runs, the paired wins, losses and ties per retriever pair with an exact two-sided McNemar p-value.

#### Scenario: Interval on a known fixture
- **WHEN** a retriever is judged helpful on 19 of 56 valid positives
- **THEN** the report shows `19/56` with a Wilson 95% interval of 22.9%–47.0% (rounded to 0.1)

#### Scenario: Unjudged excluded
- **WHEN** 3 of 56 valid positives are `unjudged` for a retriever
- **THEN** its denominator is 53 and the report shows `unjudged: 3`

#### Scenario: Union over the judged intersection
- **WHEN** retriever A has 2 unjudged positives and retriever B has 1 different unjudged positive, out of 56 valid positives
- **THEN** the union is computed over 53 cases and the report shows n = 53

#### Scenario: Comparison refuses mismatched sets
- **WHEN** `report --compare` is given two runs whose case-set hashes differ
- **THEN** it exits non-zero naming both hashes

#### Scenario: Comparison refuses a different judge
- **WHEN** `report --compare` is given two runs with the same case-set hash but different judge models, and `--allow-judge-mismatch` is absent
- **THEN** it exits non-zero naming both judge models

#### Scenario: Paired comparison
- **WHEN** two runs over the same case set have 10 cases helpful only in A, 2 helpful only in B, and the rest tied
- **THEN** the comparison shows wins 10, losses 2, and the exact two-sided McNemar p-value 0.0386 (rounded to 4 places)

### Requirement: Every run is reproducible from its manifest
Each run SHALL write a manifest recording:
- the case-set name and hash, the seed, the quotas and the input-file fingerprint;
- the retriever ids, versions, as-of modes, and module paths and hashes;
- the judge role, the resolved model ref, the prompt version and the validity-set hash;
- the pi version and the hermes package version (or `absent`);
- the snapshot fingerprints (row counts and max timestamp per table, or `absent`), the kb chunk count and the run date.

`memory-eval status` SHALL list runs with their case-set hash, judged and unjudged counts, and judge-call outcomes.

#### Scenario: Manifest completeness
- **WHEN** a run completes
- **THEN** its manifest contains every field listed above, with none empty
