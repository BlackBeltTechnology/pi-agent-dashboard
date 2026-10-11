# Test Plan — add-memory-eval-tier-r

Stage: design   Generated: 2026-10-11

HARD gate passed. These clarifications are answered and folded into
`design.md` M3/M4 and the spec:
- the pasted-log rule;
- the inclusive 15-event fix window;
- integrity failure counts as a snapshot attempt;
- an invalid `--retriever-module` exits before any search;
- no sessions: exit non-zero.

Every automated row is L1: a vitest test in `packages/memory-eval/src/__tests__/`.
- The package is an offline CLI, so there is no browser, VM or CI-workflow
  surface.
- Fixtures are synthetic: invented session JSONL, a synthetic WAL-mode hermes
  `sessions.db`, and a synthetic kb index.
- The `pi` judge child is a stub executable on `PATH`, scripted per test.
- TTY state and the timeout are injected.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Cases deterministic: Reproducible build | invariant | L1 | automated | fixture session dir; seed 5; default quotas | `cases build --set a`, then `cases build --set b` | `cases/a.json` and `cases/b.json` byte-identical; same case-set hash; files contain no set name, time or absolute path |
| E2 | Cases deterministic: Frozen set | state-transition (illegal edge) | L1 | automated | existing `cases/baseline.json` | `cases build` with no `--force` | exit ≠ 0; file bytes and mtime unchanged; with `--force` it is rewritten |
| E3 | Cases: Recurring fault | state-transition | L1 | automated | S1: `bash` fails with signature X, then succeeds with a different head 3 events later; S2 (later) fails with X | `cases build` | one `recurring_fault` for S2; `goldSessions` ∋ S1; `decisionTime` = S2's failing result timestamp |
| E4 | Cases: Recurring fault (unchanged approach) | decision table | L1 | automated | S1's fix has the same head as its failure; S2 fails with X | `cases build` | no `recurring_fault` for S2 |
| E5 | Cases: Frequent signatures excluded | BVA | L1 | automated | 100 sessions: signature A in 5, B in 6; 40 sessions: C in 3, D in 4 | `cases build` | A and C eligible; B and D produce no `recurring_fault` and no `negative` |
| E6 | Cases: Generic signatures excluded | EP | L1 | automated | recurring `(no output)`, `ENOENT` and oldText-mismatch errors across sessions with fixes | `cases build` | 0 cases from these signatures |
| E7 | Cases: First-ever failure is a negative | EP | L1 | automated | an eligible signature in exactly 1 session; quota negatives ≥ 1 | `cases build` | one `negative` case, `goldSessions` empty |
| E8 | Cases: user-flagged length | BVA | L1 | automated | user turns containing "again": 399 chars and 400 chars | `cases build` | the 399-char turn yields a `user_flagged` case; the 400-char turn yields none |
| E9 | Cases: Pasted logs and skill prompts are not user-flagged | decision table | L1 | automated | "again" turns: (a) with a ```` ``` ```` fence; (b) 2 lines `at foo (x.ts:1:2)`; (c) 1 such line; (d) starting `<skill`; (e) 2 lines with a leading `12:00:01` | `cases build` | (a), (b), (d) and (e) yield no case; (c) yields a `user_flagged` case |
| E10 | Cases: HU recurrence | EP | L1 | automated | user turn "megint ugyanaz a hiba" (no log shape) | `cases build` | one `user_flagged` case |
| E11 | Cases: Explicit reference needs another session | decision table | L1 | automated | turn "I have another session <uuid-B> which contains the fix" in session A; a second turn naming A's own uuid | `cases build` | one `explicit_ref` with gold = uuid-B; no case for the own-uuid turn |
| E12 | Cases: Query skips cd and env prefixes | EP + BVA | L1 | automated | failing `cd packages/kb && FOO=1 npx vitest run x`; a 250-char user-flagged turn | `cases build` | query starts `npx vitest` with no `/`-containing token; user query length = 200 |
| E13 | Cases: fix window | BVA | L1 | automated | S1 failure followed by a same-tool success with a different head at event +15 (variant 1) or +16 (variant 2); S2 repeats the signature | `cases build` | variant 1 yields a `recurring_fault` for S2; variant 2 yields none |
| E14 | Cases: signature masking | EP | L1 | automated | two errors differing only in path, number, hex id and quoted string; one 120-char error line | build signatures | the first two have equal signatures; signature length ≤ `tool\|` + 70 |
| E15 | Cases: error detection | BVA | L1 | automated | results: `isError:true`; no `isError` + "exited with code 2" in the last 300 chars; "exited with code 0"; "exited with code 1" only before the last 300 chars | parse events | only the first two count as errors |
| E16 | Cases: content hash covers query, context and gold | invariant | L1 | automated | case set; then the same sessions with one query-builder token changed | rebuild | case ids equal; that case's `contentHash` and the case-set hash differ |
| E17 | Cases: event ordering | invariant | L1 | automated | two session files whose filename order differs from their embedded timestamp order | `cases build` | `recurring_fault` direction follows embedded timestamps (earlier timestamp = gold) |
| E18 | Retrievers: No future leakage | BVA | L1 | automated | hermes fixture with matching messages at T and T−1 s; case asOf T | `recent`, `bm25`, `memory_search` | only the T−1 s item returned; violations 0 |
| E19 | Retrievers: Future rows do not take slots | invariant | L1 | automated | 20 matching rows after T that outrank 10 eligible rows | each strict built-in | `recent` and `memory_search` return a full limit of eligible rows; `bm25` returns only eligible rows; violations 0 |
| E20 | Retrievers: Missing timestamp dropped | fault (contract) | L1 | automated | stub strict adapter returns 3 hits: 1 without timestamp, 1 at asOf, 1 earlier | `run` | kept = the earlier hit only; report as-of violations = 2 |
| E21 | Retrievers: Same-day memory excluded | BVA | L1 | automated | asOf `2026-05-28T00:30:00+02:00` (= 2026-05-27Z); memories created 2026-05-27 and 2026-05-26 | `hermes.memory_search` | only the 2026-05-26 memory returned |
| E22 | Retrievers: Own-session hits removed | invariant | L1 | automated | 8 matching rows in the case's own session (newest) and 12 in other sessions | `run` with `recent` | kept top 5 and stored top 10 contain no own-session ref; top 5 is full; own-session share > 0 reported |
| E23 | Retrievers: Newest-first replica (golden) | golden | L1 | automated | committed `fixtures/hermes-golden/` (sessions.db + query table + expected ids) | replica `recent` per query | ordered session ids equal the golden list for every query |
| E24 | Retrievers: Newest-first replica (live) | golden | L1 | automated | same fixture; installed `pi-hermes-memory` | installed `searchSessions` per query | same ids as golden; test skipped when hermes is not resolvable |
| E25 | Retrievers: External adapter module | EP | L1 | automated | `x.mjs` default-exporting `[{id:"context-manager.sessions",version:"1",asOf:"strict",search}]` | `run --retriever-module x.mjs --retrievers hermes.session_search.recent` | `retrieved.json` has both ids; manifest has id, version, path and sha256 of `x.mjs` |
| E26 | Retrievers: kb is a separate reference | invariant | L1 | automated | run including `kb.docs`, helpful only on cases where every as-of retriever failed | `report` | `kb.docs` appears only in the non-as-of section; the union count excludes those cases |
| E27 | Judge: Cache hit | state-transition | L1 | automated | judged run; unchanged inputs | `judge` again | stub `pi` invocation count 0; status reports all items cached |
| E28 | Judge: Changed output is re-judged | state-transition | L1 | automated | judged run; one retriever's top 5 for one case altered | `judge` | exactly 1 helpfulness item sent |
| E29 | Judge: Changed case content is re-judged | state-transition | L1 | automated | judged run; one case's query changed (same id) | `judge` | that case's validity plus all its helpfulness items re-sent; others cached |
| E30 | Judge: Edited prompt or scrub rules re-judge | decision table | L1 | automated | judged run; (a) `judge.v1.md` text edited, version unchanged; (b) a scrub rule added | `judge` | every item re-sent in both variants |
| E31 | Judge: Secret scrub | EP | L1 | automated | context with `Authorization: Bearer abc.def.ghi`, `sk-…`, a JWT, `https://u:p@host`, `--token xyz`, `API_TOKEN=xyz`, OpenSSH private-key block, and a 40-hex commit hash | build batch payload | each secret replaced by `[REDACTED:`; none of the original values present; the 40-hex hash present |
| E32 | Judge: Judge argv | EP | L1 | automated | `--judge @review` with roles `review=openai/gpt-6.1-sol:medium`; `--judge provider/x` | build call | argv exactly `pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools --model openai/gpt-6.1-sol:medium` (resp. `provider/x`); no `@`; cwd = work dir; prompt on stdin |
| E33 | Judge: Unknown role | EP (invalid) | L1 | automated | `--judge @missing`; providers file lacks it | `judge` | exit ≠ 0; stderr names `@missing` and the providers file path; stub `pi` never spawned |
| E34 | Judge: Consent (TTY) | state-transition | L1 | automated | injected TTY = true; no `--yes`; answer "n" then "y" | `judge` | prompt shows provider, model, item count, batch count and the data-classes line; "n" → 0 calls; "y" → calls proceed |
| E35 | Judge: Non-interactive without consent | decision table | L1 | automated | injected TTY = false; (a) no `--yes`; (b) `--yes` | `judge` | (a) exit ≠ 0 with 0 calls; (b) calls proceed |
| E36 | Judge: Dry run | EP | L1 | automated | pending items | `judge --dry-run` | 0 calls; stdout has the plan and one scrubbed sample batch |
| E37 | Reports: Interval on a known fixture | BVA (numeric) | L1 | automated | 19 helpful of 56 valid judged positives | `report` | `19/56` and `22.9%–47.0%` |
| E38 | Reports: Unjudged excluded | EP | L1 | automated | 56 valid positives, 3 helpfulness-unjudged for retriever R | `report` | R's denominator 53; `unjudged: 3` |
| E39 | Reports: Union over the judged intersection | invariant | L1 | automated | A unjudged on cases 1–2; B unjudged on case 3; 56 valid positives | `report` | union n = 53 |
| E40 | Reports: negative denominators | EP | L1 | automated | 30 valid negatives; 2 helpfulness-unjudged; 1 validity-unjudged negative extra | `report` | returned-anything and abstention over 30; judged-helpful over 28; the validity-unjudged one in no rate |
| E41 | Reports: Comparison refuses mismatched sets | EP (invalid) | L1 | automated | runs with case-set hashes h1 ≠ h2 | `report --compare` | exit ≠ 0; stderr contains h1 and h2 |
| E42 | Reports: Comparison refuses a different judge | decision table | L1 | automated | same hash, judges m1 ≠ m2; (a) no flag; (b) `--allow-judge-mismatch` | `report --compare` | (a) exit ≠ 0 naming m1 and m2; (b) exit 0 with a mismatch banner |
| E43 | Reports: Paired comparison | BVA (numeric) | L1 | automated | 10 A-only helpful, 2 B-only, the rest tied | `report --compare` | wins 10, losses 2, p = 0.0386 |
| E44 | Data local: Report carries no case text | invariant | L1 | automated | fixture where every query, context and snippet contains a unique `zqx<12hex>` marker | `report` (single and compare) | 0 markers in any report output |
| E45 | Manifest completeness | invariant | L1 | automated | full fixture run; and a run with hermes absent | `run` | every listed manifest field present and non-empty; absent fields = `absent` |
| E46 | Baseline sanity band (M8) | BVA | L1 | automated | `recent` helpful 10/56 (17.9%), 11/56 (19.6%), 27/56 (48.2%), 28/56 (50.0%) | `report` | 10/56 and 28/56 flagged; 11/56 and 27/56 not |
| E47 | Data local: Work dir permissions | state-transition | L1 | automated | (a) no work dir; (b) existing dir 0755 with a 0644 file; temp HOME | `cases build` | dirs 0700, files 0600; no new file outside the work dir (recursive listing of temp HOME before and after) |
| E48 | Manifest: status | EP | L1 | automated | two runs, one with 2 unjudged | `status` | lists both run ids with case-set hash, judged/unjudged counts and judge-call outcomes |
| E49 | Reports: blackhole and gold | EP | L1 | automated | run with gold sessions known for 4 `recurring_fault` cases, 2 found at ranks 3 and 8 | `report` | `recall` row shows 0% (by construction); gold hit@5 = 1/4, hit@10 = 2/4 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Retrievers: BM25 variant query plan | threshold (timed) | L1 | automated | synthetic `sessions.db`, 45,000 messages; query Q1 (common term, ≥10 eligible in the top 5,000) and Q2 (top 5,000 all future → widening to 50,000) | wall time per query < 500 ms; Q2 under-fill counted when < 10 eligible | 1 warm run per query |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Judge: Provider failure | fault-injection (abort) | L1 | automated | stub `pi` exits 1 with `402 Insufficient Balance` on both attempts | `judge` | batch items `unjudged` with that text; not in `verdicts.jsonl`; a later `judge` with a healthy stub sends them again |
| X2 | Judge: Malformed answer | fault-injection (partial) | L1 | automated | stub returns JSON missing case c3, twice | `judge` | present ids recorded; c3 `unjudged`; the retry payload contains only c3 |
| X3 | Judge: timeout | fault-injection (delay) | L1 | automated | stub sleeps past the injected timeout on both attempts | `judge` | child killed (no orphan process); items `unjudged` with a timeout error |
| X4 | Judge: retry recovers | fault-injection (abort once) | L1 | automated | stub fails attempt 1, answers attempt 2 | `judge` | items judged; `judge-calls.jsonl` has 2 lines (outcome failed, ok) with durationMs, exitCode and payloadSha256 |
| X5 | Snapshot: writer races the copy | fault-injection (concurrent write) | L1 | automated | injected fs: the `-wal` size changes between stats on (a) attempt 1 only; (b) every attempt | `run` | (a) succeeds, manifest attempts = 2; (b) exit ≠ 0 after 5 attempts, naming the DB |
| X6 | Snapshot: integrity failure | fault-injection (corrupt copy) | L1 | automated | injected copy corrupts the DB on attempt 1 only | `run` | succeeds on attempt 2; manifest attempts = 2 |
| X7 | Data local: Sources untouched | invariant + fault (live WAL) | L1 | automated | WAL-mode hermes fixture with uncheckpointed frames held open by a writer handle; kb index; session files | full build, run and judge cycle | source DB, `-wal`, `-shm` and session files byte-identical (sha256 before and after); snapshot contains the WAL-only rows |
| X8 | Data local: Absent hermes database | fault-injection (missing dep) | L1 | automated | no `sessions.db` | `run` + `report` | hermes adapters `unavailable` with no figures, excluded from the union; manifest `absent`; exit 0 |
| X9 | Retrievers: Invalid external module | fault-injection (bad input) | L1 | automated | module (a) throws on import; (b) default-exports an object; (c) reuses id `kb.docs` | `run --retriever-module` | exit ≠ 0 before any `search` call; stderr names the path and the reason |
| X10 | Retrievers: External adapter timeout | fault-injection (delay) | L1 | automated | external `search` never resolves; injected timeout | `run` | that case/retriever recorded as error with 0 hits; the other retrievers' results present; exit 0 |
| X11 | Retrievers: hit-schema validation | fault-injection (bad output) | L1 | automated | external adapter returns `{ref: 1}` and one valid hit | `run` | invalid hit dropped and counted; the valid hit kept |
| X12 | Cases: No sessions | fault-injection (missing dep) | L1 | automated | (a) session dir missing; (b) dir with no `*.jsonl` | `cases build` | exit ≠ 0 naming the dir; no set file |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Data local + M8 baseline | review | — | manual-only | the real baseline `measurements.md` produced from this repo's sessions | operator reads it before commit | [judgment: nothing in it reads like session text, and the sanity-band explanation (if flagged) is adequate; no automatable observable on real data] |

---

## Coverage summary

- Requirements covered: 6/6 (data local, cases, retrievers, judge, reports, manifest), plus M8's sanity band
- Scenarios by class: edge 49 · perf 1 · frontend 0 · error 12 · manual 1
- Scenarios by level: L1 62 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 62 · manual-only 1

## New infra needed

- A new vitest project: `packages/memory-eval/vitest.config.ts`, registered
  in the root `vitest.config.ts` `test.projects`, with the
  `NODE_OPTIONS=--experimental-sqlite` wiring copied from `packages/kb`.
- A stub `pi` executable fixture (`src/__tests__/helpers/stub-pi.mjs`),
  scripted per test via env, and put on `PATH` for the judge tests.
- The synthetic hermes golden fixture (`fixtures/hermes-golden/`), generated
  once by `scripts/regen-hermes-golden.ts` against the installed hermes.
