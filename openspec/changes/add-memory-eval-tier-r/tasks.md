# Tasks: add-memory-eval-tier-r

plan-proposal drove this change. Test tasks are folded from `test-plan.md` (the
manifest; dispositions live there). Write each test first, see it fail, then
implement (TDD).

## 1. Scaffold

- [ ] 1.1 Create `packages/memory-eval` with these settings:
  - `"private": true`, and `engines.node` matching the root `package.json`;
  - deps `packages/kb`, `packages/shared` and `tsx`;
  - bin `memory-eval` as a `.mjs` shim that runs `src/cli.ts` via tsx (design M1).
- [ ] 1.2 Add `packages/memory-eval/vitest.config.ts` with the `NODE_OPTIONS=--experimental-sqlite` test wiring copied from `packages/kb/package.json`, and register the project in the root `vitest.config.ts` `test.projects`.
- [ ] 1.3 Run `pnpm install` (pnpm only). Confirm `npx memory-eval --help` lists the subcommands `cases build`, `run`, `judge`, `report`, `status`.
- [ ] 1.4 Add the stub `pi` test helper `src/__tests__/helpers/stub-pi.mjs`, scripted per test via env: exit code, delay, stdout JSON, and invocation log.
- [ ] 1.5 Scaffold `packages/memory-eval/AGENTS.md` and add the `packages/memory-eval` row to the parent DOX tree.

## 2. Work dir and case builder (design M2, M3)

- [ ] 2.1 Implement the work dir: project-key derivation, `umask 077`, `0700` dirs, `0600` files, and re-chmod of an existing dir.
- [ ] 2.2 Implement the JSONL event model. Link call→result by `toolCallId`, join `content[].text`, and order by embedded timestamp with filename and line tie-breaks.
- [ ] 2.3 Implement error detection, signature masking and truncation, generic and frequent exclusion, the fix window (15 events, inclusive), and `changed` heads.
- [ ] 2.4 Implement the four case types, including the pasted-log rule and the EN+HU recurrence regex.
- [ ] 2.5 Implement query derivation, seeded `mulberry32` sampling, case ids, `contentHash`, the case-set hash, and the input-file fingerprint.
- [ ] 2.6 Write set files. Refuse an existing set without `--force`, and include no name, time or absolute path in them.

## 3. Snapshots and retrievers (design M4)

- [ ] 3.1 Implement stat-stable file-copy snapshots. Copy DB+`-wal` (never `-shm`), run `integrity_check`, allow 5 attempts, then `VACUUM INTO` and `journal_mode=DELETE`. A missing source gives `unavailable` / `absent`.
- [ ] 3.2 Implement the `Retriever` contract and the harness checks: as-of backstop, own-session backstop, hit-schema validation, per-search timeout, top-5 clipped to 260 chars, top-10 refs, and under-fill and violation counters.
- [ ] 3.3 Implement the hermes query normalisation replica and `hermes.session_search.recent`, with as-of and `excludeSessionId` applied in-query before LIMIT.
- [ ] 3.4 Implement `hermes.session_search.bm25` with an FTS window of 5,000, a single retry at 50,000, and under-fill counting.
- [ ] 3.5 Implement `hermes.memory_search` with eligibility `created < date(asOf UTC)`.
- [ ] 3.6 Implement `kb.docs` (`asOf: "none"`) over the kb snapshot via `SqliteFtsStore.openExisting`.
- [ ] 3.7 Implement the `--retriever-module` loader. Validate before any search; exit non-zero naming the path and reason; record the module hash in the manifest.
- [ ] 3.8 Add `scripts/regen-hermes-golden.ts`. Generate `fixtures/hermes-golden/` (a synthetic sessions.db, a query table and the expected ids) against the installed hermes, and commit the fixture.

## 4. Judge (design M5)

- [ ] 4.1 Write `prompts/judge.v1.md`, covering both validity and helpfulness. Wrap text as data, and use v0's criterion "topical overlap ≠ help".
- [ ] 4.2 Implement the best-effort secret scrub rule table and its `scrubSha256`.
- [ ] 4.3 Implement `--judge` resolution via `parseRoleConfig` + `resolveModelRef`, and build the argv: `-p --no-session --no-extensions --no-skills --no-context-files --no-tools --model <ref>`, with the work dir as cwd and the prompt on stdin.
- [ ] 4.4 Implement batching (10 per batch), JSON schema validation, per-item retry semantics, the harness-enforced 120 s timeout with child kill, and `unjudged` recording (never cached).
- [ ] 4.5 Implement the verdict cache key: kind, caseId, caseContentHash, outputHash, promptVersion, promptSha256, scrubSha256, judgeModel.
- [ ] 4.6 Implement consent: TTY confirm, `--yes`, fail-closed when not a TTY, and `--dry-run` with a scrubbed sample. Also implement the `judge-calls.jsonl` call log.

## 5. Report, manifest, status (design M6, M7)

- [ ] 5.1 Build the typed aggregate model and renderer, with no text-bearing fields. Report Wilson intervals and the union over the judged intersection; negative denominators; median size; gold hit@5/@10; blackhole 0%; a separate non-as-of section; the counters; and the sanity-band flag (34% ± 15).
- [ ] 5.2 Implement `report --compare`: gates on case-set hash and judge (`--allow-judge-mismatch`), and the exact two-sided McNemar test.
- [ ] 5.3 Write the manifest with every M7 field (`absent` sentinels), and the `status` command.

## 6. Tests (folded from test-plan.md)

**`cases.test.ts`**

- [ ] E1 — Cases deterministic: Reproducible build: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: fixture session dir; seed 5; default quotas · `cases build --set a`, then `cases build --set b` · `cases/a.json` and `cases/b.json` byte-identical; same case-set hash; files contain no set name, time or absolute path (test-plan #E1)
- [ ] E2 — Cases deterministic: Frozen set: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: existing `cases/baseline.json` · `cases build` with no `--force` · exit ≠ 0; file bytes and mtime unchanged; with `--force` it is rewritten (test-plan #E2)
- [ ] E3 — Cases: Recurring fault: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: S1: `bash` fails with signature X, then succeeds with a different head 3 events later; S2 (later) fails with X · `cases build` · one `recurring_fault` for S2; `goldSessions` ∋ S1; `decisionTime` = S2's failing result timestamp (test-plan #E3)
- [ ] E4 — Cases: Recurring fault (unchanged approach): in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: S1's fix has the same head as its failure; S2 fails with X · `cases build` · no `recurring_fault` for S2 (test-plan #E4)
- [ ] E5 — Cases: Frequent signatures excluded: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: 100 sessions: signature A in 5, B in 6; 40 sessions: C in 3, D in 4 · `cases build` · A and C eligible; B and D produce no `recurring_fault` and no `negative` (test-plan #E5)
- [ ] E6 — Cases: Generic signatures excluded: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: recurring `(no output)`, `ENOENT` and oldText-mismatch errors across sessions with fixes · `cases build` · 0 cases from these signatures (test-plan #E6)
- [ ] E7 — Cases: First-ever failure is a negative: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: an eligible signature in exactly 1 session; quota negatives ≥ 1 · `cases build` · one `negative` case, `goldSessions` empty (test-plan #E7)
- [ ] E8 — Cases: user-flagged length: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: user turns containing "again": 399 chars and 400 chars · `cases build` · the 399-char turn yields a `user_flagged` case; the 400-char turn yields none (test-plan #E8)
- [ ] E9 — Cases: Pasted logs and skill prompts are not user-flagged: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: "again" turns: (a) with a ```` ``` ```` fence; (b) 2 lines `at foo (x.ts:1:2)`; (c) 1 such line; (d) starting `<skill`; (e) 2 lines with a leading `12:00:01` · `cases build` · (a), (b), (d) and (e) yield no case; (c) yields a `user_flagged` case (test-plan #E9)
- [ ] E10 — Cases: HU recurrence: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: user turn "megint ugyanaz a hiba" (no log shape) · `cases build` · one `user_flagged` case (test-plan #E10)
- [ ] E11 — Cases: Explicit reference needs another session: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: turn "I have another session <uuid-B> which contains the fix" in session A; a second turn naming A's own uuid · `cases build` · one `explicit_ref` with gold = uuid-B; no case for the own-uuid turn (test-plan #E11)
- [ ] E12 — Cases: Query skips cd and env prefixes: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: failing `cd packages/kb && FOO=1 npx vitest run x`; a 250-char user-flagged turn · `cases build` · query starts `npx vitest` with no `/`-containing token; user query length = 200 (test-plan #E12)
- [ ] E13 — Cases: fix window: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: S1 failure followed by a same-tool success with a different head at event +15 (variant 1) or +16 (variant 2); S2 repeats the signature · `cases build` · variant 1 yields a `recurring_fault` for S2; variant 2 yields none (test-plan #E13)
- [ ] E14 — Cases: signature masking: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: two errors differing only in path, number, hex id and quoted string; one 120-char error line · build signatures · the first two have equal signatures; signature length ≤ `tool|` + 70 (test-plan #E14)
- [ ] E15 — Cases: error detection: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: results: `isError:true`; no `isError` + "exited with code 2" in the last 300 chars; "exited with code 0"; "exited with code 1" only before the last 300 chars · parse events · only the first two count as errors (test-plan #E15)
- [ ] E16 — Cases: content hash covers query, context and gold: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: case set; then the same sessions with one query-builder token changed · rebuild · case ids equal; that case's `contentHash` and the case-set hash differ (test-plan #E16)
- [ ] E17 — Cases: event ordering: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: two session files whose filename order differs from their embedded timestamp order · `cases build` · `recurring_fault` direction follows embedded timestamps (earlier timestamp = gold) (test-plan #E17)
- [ ] X12 — Cases: No sessions: in `packages/memory-eval/src/__tests__/cases.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: (a) session dir missing; (b) dir with no `*.jsonl` · `cases build` · exit ≠ 0 naming the dir; no set file (test-plan #X12)

**`hermes-replica.test.ts`**

- [ ] E23 — Retrievers: Newest-first replica (golden): in `packages/memory-eval/src/__tests__/hermes-replica.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: committed `fixtures/hermes-golden/` (sessions.db + query table + expected ids) · replica `recent` per query · ordered session ids equal the golden list for every query (test-plan #E23)
- [ ] E24 — Retrievers: Newest-first replica (live): in `packages/memory-eval/src/__tests__/hermes-replica.test.ts` (harness exemplar: `packages/kb/src/__tests__/eval-golden.test.ts`). Triple: same fixture; installed `pi-hermes-memory` · installed `searchSessions` per query · same ids as golden; test skipped when hermes is not resolvable (test-plan #E24)

**`retrievers.test.ts`**

- [ ] E18 — Retrievers: No future leakage: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: hermes fixture with matching messages at T and T−1 s; case asOf T · `recent`, `bm25`, `memory_search` · only the T−1 s item returned; violations 0 (test-plan #E18)
- [ ] E19 — Retrievers: Future rows do not take slots: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: 20 matching rows after T that outrank 10 eligible rows · each strict built-in · `recent` and `memory_search` return a full limit of eligible rows; `bm25` returns only eligible rows; violations 0 (test-plan #E19)
- [ ] E20 — Retrievers: Missing timestamp dropped: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: stub strict adapter returns 3 hits: 1 without timestamp, 1 at asOf, 1 earlier · `run` · kept = the earlier hit only; report as-of violations = 2 (test-plan #E20)
- [ ] E21 — Retrievers: Same-day memory excluded: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: asOf `2026-05-28T00:30:00+02:00` (= 2026-05-27Z); memories created 2026-05-27 and 2026-05-26 · `hermes.memory_search` · only the 2026-05-26 memory returned (test-plan #E21)
- [ ] E22 — Retrievers: Own-session hits removed: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: 8 matching rows in the case's own session (newest) and 12 in other sessions · `run` with `recent` · kept top 5 and stored top 10 contain no own-session ref; top 5 is full; own-session share > 0 reported (test-plan #E22)
- [ ] E25 — Retrievers: External adapter module: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: `x.mjs` default-exporting `[{id:"context-manager.sessions",version:"1",asOf:"strict",search}]` · `run --retriever-module x.mjs --retrievers hermes.session_search.recent` · `retrieved.json` has both ids; manifest has id, version, path and sha256 of `x.mjs` (test-plan #E25)
- [ ] E26 — Retrievers: kb is a separate reference: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: run including `kb.docs`, helpful only on cases where every as-of retriever failed · `report` · `kb.docs` appears only in the non-as-of section; the union count excludes those cases (test-plan #E26)
- [ ] X9 — Retrievers: Invalid external module: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: module (a) throws on import; (b) default-exports an object; (c) reuses id `kb.docs` · `run --retriever-module` · exit ≠ 0 before any `search` call; stderr names the path and the reason (test-plan #X9)
- [ ] X10 — Retrievers: External adapter timeout: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: external `search` never resolves; injected timeout · `run` · that case/retriever recorded as error with 0 hits; the other retrievers' results present; exit 0 (test-plan #X10)
- [ ] X11 — Retrievers: hit-schema validation: in `packages/memory-eval/src/__tests__/retrievers.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: external adapter returns `{ref: 1}` and one valid hit · `run` · invalid hit dropped and counted; the valid hit kept (test-plan #X11)

**`retrievers-perf.test.ts`**

- [ ] P1 — Retrievers: BM25 variant query plan: in `packages/memory-eval/src/__tests__/retrievers-perf.test.ts` (harness exemplar: `packages/kb/src/__tests__/retrieval-quality.test.ts`). Triple: synthetic `sessions.db`, 45,000 messages; query Q1 (common term, ≥10 eligible in the top 5,000) and Q2 (top 5,000 all future → widening to 50,000) · run each query timed · wall time per query < 500 ms; Q2 under-fill counted when < 10 eligible (test-plan #P1)

**`snapshot.test.ts`**

- [ ] X5 — Snapshot: writer races the copy: in `packages/memory-eval/src/__tests__/snapshot.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: injected fs: the `-wal` size changes between stats on (a) attempt 1 only; (b) every attempt · `run` · (a) succeeds, manifest attempts = 2; (b) exit ≠ 0 after 5 attempts, naming the DB (test-plan #X5)
- [ ] X6 — Snapshot: integrity failure: in `packages/memory-eval/src/__tests__/snapshot.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: injected copy corrupts the DB on attempt 1 only · `run` · succeeds on attempt 2; manifest attempts = 2 (test-plan #X6)
- [ ] X7 — Data local: Sources untouched: in `packages/memory-eval/src/__tests__/snapshot.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: WAL-mode hermes fixture with uncheckpointed frames held open by a writer handle; kb index; session files · full build, run and judge cycle · source DB, `-wal`, `-shm` and session files byte-identical (sha256 before and after); snapshot contains the WAL-only rows (test-plan #X7)
- [ ] X8 — Data local: Absent hermes database: in `packages/memory-eval/src/__tests__/snapshot.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: no `sessions.db` · `run` + `report` · hermes adapters `unavailable` with no figures, excluded from the union; manifest `absent`; exit 0 (test-plan #X8)

**`workdir.test.ts`**

- [ ] E47 — Data local: Work dir permissions: in `packages/memory-eval/src/__tests__/workdir.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: (a) no work dir; (b) existing dir 0755 with a 0644 file; temp HOME · `cases build` · dirs 0700, files 0600; no new file outside the work dir (recursive listing of temp HOME before and after) (test-plan #E47)

**`judge.test.ts`**

- [ ] E27 — Judge: Cache hit: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: judged run; unchanged inputs · `judge` again · stub `pi` invocation count 0; status reports all items cached (test-plan #E27)
- [ ] E28 — Judge: Changed output is re-judged: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: judged run; one retriever's top 5 for one case altered · `judge` · exactly 1 helpfulness item sent (test-plan #E28)
- [ ] E29 — Judge: Changed case content is re-judged: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: judged run; one case's query changed (same id) · `judge` · that case's validity plus all its helpfulness items re-sent; others cached (test-plan #E29)
- [ ] E30 — Judge: Edited prompt or scrub rules re-judge: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: judged run; (a) `judge.v1.md` text edited, version unchanged; (b) a scrub rule added · `judge` · every item re-sent in both variants (test-plan #E30)
- [ ] E31 — Judge: Secret scrub: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: context with `Authorization: Bearer abc.def.ghi`, `sk-…`, a JWT, `https://u:p@host`, `--token xyz`, `API_TOKEN=xyz`, OpenSSH private-key block, and a 40-hex commit hash · build batch payload · each secret replaced by `[REDACTED:`; none of the original values present; the 40-hex hash present (test-plan #E31)
- [ ] E32 — Judge: Judge argv: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/dashboard-plugin-runtime/src/__tests__/plugin-spawn-scope-mapper.test.ts`). Triple: `--judge @review` with roles `review=openai/gpt-6.1-sol:medium`; `--judge provider/x` · build call · argv exactly `pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools --model openai/gpt-6.1-sol:medium` (resp. `provider/x`); no `@`; cwd = work dir; prompt on stdin (test-plan #E32)
- [ ] E33 — Judge: Unknown role: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/__tests__/role-schema.test.ts`). Triple: `--judge @missing`; providers file lacks it · `judge` · exit ≠ 0; stderr names `@missing` and the providers file path; stub `pi` never spawned (test-plan #E33)
- [ ] E34 — Judge: Consent (TTY): in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: injected TTY = true; no `--yes`; answer "n" then "y" · `judge` · prompt shows provider, model, item count, batch count and the data-classes line; "n" → 0 calls; "y" → calls proceed (test-plan #E34)
- [ ] E35 — Judge: Non-interactive without consent: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: injected TTY = false; (a) no `--yes`; (b) `--yes` · `judge` · (a) exit ≠ 0 with 0 calls; (b) calls proceed (test-plan #E35)
- [ ] E36 — Judge: Dry run: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: pending items · `judge --dry-run` · 0 calls; stdout has the plan and one scrubbed sample batch (test-plan #E36)
- [ ] X1 — Judge: Provider failure: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: stub `pi` exits 1 with `402 Insufficient Balance` on both attempts · `judge` · batch items `unjudged` with that text; not in `verdicts.jsonl`; a later `judge` with a healthy stub sends them again (test-plan #X1)
- [ ] X2 — Judge: Malformed answer: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: stub returns JSON missing case c3, twice · `judge` · present ids recorded; c3 `unjudged`; the retry payload contains only c3 (test-plan #X2)
- [ ] X3 — Judge: timeout: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: stub sleeps past the injected timeout on both attempts · `judge` · child killed (no orphan process); items `unjudged` with a timeout error (test-plan #X3)
- [ ] X4 — Judge: retry recovers: in `packages/memory-eval/src/__tests__/judge.test.ts` (harness exemplar: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`). Triple: stub fails attempt 1, answers attempt 2 · `judge` · items judged; `judge-calls.jsonl` has 2 lines (outcome failed, ok) with durationMs, exitCode and payloadSha256 (test-plan #X4)

**`report.test.ts`**

- [ ] E37 — Reports: Interval on a known fixture: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: 19 helpful of 56 valid judged positives · `report` · `19/56` and `22.9%–47.0%` (test-plan #E37)
- [ ] E38 — Reports: Unjudged excluded: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: 56 valid positives, 3 helpfulness-unjudged for retriever R · `report` · R's denominator 53; `unjudged: 3` (test-plan #E38)
- [ ] E39 — Reports: Union over the judged intersection: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: A unjudged on cases 1–2; B unjudged on case 3; 56 valid positives · `report` · union n = 53 (test-plan #E39)
- [ ] E40 — Reports: negative denominators: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: 30 valid negatives; 2 helpfulness-unjudged; 1 validity-unjudged negative extra · `report` · returned-anything and abstention over 30; judged-helpful over 28; the validity-unjudged one in no rate (test-plan #E40)
- [ ] E41 — Reports: Comparison refuses mismatched sets: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: runs with case-set hashes h1 ≠ h2 · `report --compare` · exit ≠ 0; stderr contains h1 and h2 (test-plan #E41)
- [ ] E42 — Reports: Comparison refuses a different judge: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: same hash, judges m1 ≠ m2; (a) no flag; (b) `--allow-judge-mismatch` · `report --compare` · (a) exit ≠ 0 naming m1 and m2; (b) exit 0 with a mismatch banner (test-plan #E42)
- [ ] E43 — Reports: Paired comparison: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: 10 A-only helpful, 2 B-only, the rest tied · `report --compare` · wins 10, losses 2, p = 0.0386 (test-plan #E43)
- [ ] E44 — Data local: Report carries no case text: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: fixture where every query, context and snippet contains a unique `zqx<12hex>` marker · `report` (single and compare) · 0 markers in any report output (test-plan #E44)
- [ ] E46 — Baseline sanity band (M8): in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: `recent` helpful 10/56 (17.9%), 11/56 (19.6%), 27/56 (48.2%), 28/56 (50.0%) · `report` · 10/56 and 28/56 flagged; 11/56 and 27/56 not (test-plan #E46)
- [ ] E49 — Reports: blackhole and gold: in `packages/memory-eval/src/__tests__/report.test.ts` (harness exemplar: `packages/kb/src/__tests__/render.test.ts`). Triple: run with gold sessions known for 4 `recurring_fault` cases, 2 found at ranks 3 and 8 · `report` · `recall` row shows 0% (by construction); gold hit@5 = 1/4, hit@10 = 2/4 (test-plan #E49)

**`manifest.test.ts`**

- [ ] E45 — Manifest completeness: in `packages/memory-eval/src/__tests__/manifest.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: full fixture run; and a run with hermes absent · `run` · every listed manifest field present and non-empty; absent fields = `absent` (test-plan #E45)
- [ ] E48 — Manifest: status: in `packages/memory-eval/src/__tests__/manifest.test.ts` (harness exemplar: `packages/kb/src/__tests__/open-existing.test.ts`). Triple: two runs, one with 2 unjudged · `status` · lists both run ids with case-set hash, judged/unjudged counts and judge-call outcomes (test-plan #E48)

## 7. Baseline (design M8)

- [ ] 7.1 Run `memory-eval cases build --set baseline` for this repo with default quotas, then `run` with the four old-stack adapters.
- [ ] 7.2 Run `judge --judge @propose-review-1` after the consent step, so the operator confirms the provider.
- [ ] 7.3 Write `report` to `openspec/changes/add-memory-eval-tier-r/measurements.md`, with the case-set hash, per-type counts, the judge ref and, if flagged, the sanity-band explanation.
- [ ] 7.4 Update §19 of `docs/research/unified-context-manager-exploration.md` with the new reference figures, via DocScribe (caveman style).

## 8. Manual verification

- [ ] 8.1 Read the real baseline `measurements.md` before commit. Confirm nothing in it reads like session text, and that the sanity-band explanation (if flagged) is adequate. (test-plan: manual-only, test-plan #M1)

## 9. Close-out

- [ ] 9.1 Run `review-code` on the diff. Then run `npm run quality:changed` and the full `npm test`, piped to `/tmp/pi-test.log`.
- [ ] 9.2 Update the `packages/memory-eval/AGENTS.md` rows for every new file (`See change: add-memory-eval-tier-r`).
