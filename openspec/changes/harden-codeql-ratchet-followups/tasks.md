# Tasks

## 1. Baseline binding — tests first

All tests below live in `scripts/__tests__/codeql-local-cli.test.mjs`; harness exemplar: its existing `describe("prune and accept (#E25, #E26)")` block and `scripts/__tests__/fixtures/codeql-harness.mjs` (`seeded`, `run`, `stateDirOf`).

- [x] 1.1 Extend `scripts/__tests__/fixtures/fake-codeql.mjs` with an optional plan field that writes a file during `database analyze` (needed by test-plan #E3); exemplar: its existing `createExit`/`analyzeExit` plan fields.
- [x] 1.2 Test (test-plan #E1): seeded baseline, run reports a new key, entry count raised by hand · `--accept` and `--prune` · each exits 2, stderr says re-run, baseline byte-identical; see add-local-codeql-ratchet's `#E26` test.
- [x] 1.3 Test (test-plan #E2): run, then `baselineHash` deleted from `last-run.json` · `--prune` · proceeds as before, stderr notes the binding was not checked, record now carries `baselineHash`; see add-local-codeql-ratchet's `#E25` test.
- [x] 1.4 Test (test-plan #E3): fake codeql rewrites an entry reason during `database analyze` · run then `--prune` · prune exits 2, baseline equals the mid-run bytes; see add-local-codeql-ratchet's `#E26` test.
- [x] 1.5 Test (test-plan #E4): seeded untriaged entry, run reports a new key · `--triage` then `--accept` · accept exits 0 with a passing verdict; see add-local-codeql-ratchet's `#E27` test.
- [x] 1.6 Test (test-plan #E5): run, entry count raised by hand · `--triage` then `--prune` · prune exits 2, baseline equals the post-triage bytes; see add-local-codeql-ratchet's `#E27` test.
- [x] 1.7 Test (test-plan #E6): run, `baselineHash` deleted, entry hand-edited · `--triage` · `last-run.json` still has no `baselineHash`; see add-local-codeql-ratchet's `#E27` test.
- [x] 1.8 Test (test-plan #E7): run, baseline re-indented 4 spaces with entries reversed · `--prune` · proceeds, no re-run refusal; see add-local-codeql-ratchet's `#E25` test.
- [x] 1.9 Test (test-plan #E8): run, one reason changed only by an inner double space · `--prune` · exits 2; see add-local-codeql-ratchet's `#E26` test.
- [x] 1.10 Test (test-plan #E9): no baseline · `--write-baseline` then `--prune` · record has `baselineHash`, prune exits 0 without the legacy note; see add-local-codeql-ratchet's `#E28` test.
- [x] 1.11 Test (test-plan #E10): run with 2 new keys and 1 stale entry · `--prune`, `--accept`, `--accept` · all succeed, last verdict passes, record hash equals sha256 of the canonical final baseline; extend add-local-codeql-ratchet's `#E25` test.
- [x] 1.12 Test (test-plan #E11): seeded 2-entry baseline · plain run · `last-run.json.baselineHash` equals sha256 of `serializeBaseline` of the parsed baseline; see add-local-codeql-ratchet's `#E6` test.
- [x] 1.13 Test (test-plan #E12): seeded baseline, no `last-run.json` · `--triage` · exit 0, `last-run.json` still absent; see add-local-codeql-ratchet's `#E27` test.
- [x] 1.14 Test (test-plan #X1): run, baseline truncated to invalid JSON · `--prune` · exit 2, stderr "is not valid JSON", baseline and `last-run.json` byte-identical; see add-local-codeql-ratchet's `#X5` test.
- [x] 1.15 Run the new tests and confirm they fail before implementation.

## 2. Baseline binding — implementation

- [x] 2.1 `scripts/codeql-local.mjs`: `analyse` adds `baselineHash` (sha256 of `serializeBaseline(baseline)`) to its `last-run.json` write for non-seed runs; the seed path rewrites the record with the written baseline's hash (design D1).
- [x] 2.2 `requireFreshRun` takes the parsed baseline and refuses (exit 2, "baseline changed since the recorded run; re-run the analysis first") on hash mismatch; a hashless record passes with a stderr note.
- [x] 2.3 `--prune`/`--accept` re-record the hash of the baseline they wrote, atomically, under the lock; `--triage` re-records only when the record's hash equals the pre-triage baseline's hash.
- [x] 2.4 Tests 1.2–1.14 and the existing `scripts/__tests__/codeql-local*.test.mjs` pass.
- [x] 2.5 Update the `scripts/codeql-local.mjs.AGENTS.md` row text (baseline binding, `See change: harden-codeql-ratchet-followups`).

## 3. Local/CI gap

- [x] 3.1 Run design D2 steps 0–2 at one post-switch commit and commit `evidence/local-vs-ci.md`: method, pack shas, per-variation set diffs (a)–(g), and the 29 lost server results from the CI SARIF diff (test-plan: manual-only, #M1).
- [x] 3.2 Use `ask_user` to choose (a) align local with CI or (b) keep it stricter and document. An (a) is re-planned as its own MODIFIED delta / follow-up change. No config change lands here (test-plan: manual-only, #M2).
- [x] 3.3 Via DocScribe, update `docs/code-quality.md`: the snapshot section's `last-run.json` shape and refusal rule, plus the known-limitation section with the measured local/CI relationship and the decision.

## 4. Validate

- [x] 4.1 `openspec validate harden-codeql-ratchet-followups --strict` passes.
- [ ] 4.2 `npm test` green.
