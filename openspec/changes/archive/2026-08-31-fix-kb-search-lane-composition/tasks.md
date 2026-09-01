## 1. Verify the instrument (blocked on `fix-kb-eval-measurement-integrity`)

- [x] 1.1 Confirm `fix-kb-eval-measurement-integrity` has landed: `packages/kb/dist` is newer than `packages/kb/src`, and `kb eval` threads the same search options `packages/kb-extension/src/extension.ts` passes (incl. the shared `searchOptsFromConfig` helper).
- [x] 1.2 Run `tsx packages/kb/eval/run-fixtures.ts --fresh` and record current source-intent and markdown-intent numbers as the pre-change baseline in `openspec/changes/fix-kb-search-lane-composition/measurements.md` (the committed fixture has 104 items; the proposal's n=97 numbers are a mining-time snapshot).
- [x] 1.4 (added during apply — task-1.3 stop condition fired) `packages/kb/eval/run-fixtures.ts` never passed `roots` to `evaluate`, so the D4 reachability rule dropped every path-bearing expect (source-intent n=0/104, markdown-intent n=12/108). Pass the repo `RootRef` and fail loudly on a zero-scored fixture, then re-run 1.2.
- [x] 1.3 Confirm the recorded baseline reproduces the proposal's shape (source-intent P@1 ≪ Recall@10); if it does not, stop and re-open the diagnosis before touching ranking code.

## 2. Lead-slot rule in `interleaveLanes` (design D1/D2/D3)

- [x] 2.1 Add `laneLeadMargin: number` to `RankingConfig` in `packages/kb/src/config.ts` (default `0` = off), validated in `validateConfig` as finite and within `[0,1]`, mirroring `laneQuota`; document the `laneQuota: 0` / explicit-`doc_type` inertness on the config comment.
- [x] 2.2 Add `laneLeadMargin?: number` to `SearchOpts` in `packages/kb/src/types.ts`.
- [x] 2.3 Config-validation boundary test (test-plan #E3): `-0.1`, `1.1`, non-number rejected with the laneQuota-style error; `0` and `1` accepted — copy harness glue from the existing laneQuota validator test in `packages/kb/src/__tests__/`.
- [x] 2.4 Failing test (test-plan #E4): `laneLeadMargin: 0` ⇒ interleaving identical to the pre-change baseline (path order, scores, count) on a seeded corpus fixture — see sibling `packages/kb/src/__tests__/retrieval-quality.test.ts` for store+fixture glue.
- [x] 2.5 Failing tests (test-plan #E5, #E10): a competitive `agents` candidate takes slot 1 at margin `0.2` and appears exactly once under source dedup (#E5); after a lead pick at `laneQuota: 0.5`, slot 2 comes from the main lane (`2/2 = 1 > 0.5`) (#E10).
- [x] 2.6 Failing tests (test-plan #E6, #E11): a non-competitive `agents` candidate leaves the page identical to margin `0` (#E6); margin `1.0` leads unconditionally (documented degenerate endpoint) (#E11).
- [x] 2.7 Failing test (test-plan #E9): with `diversity.enabled` + `coverageRerank: true` and a corpus case where the coverage re-sort moves the main head, the slot-1 decision still matches the raw BM25(+proximity) best-score comparison.
- [x] 2.8 Implement the lead-slot rule in `interleaveLanes` (`packages/kb/src/sqlite-store.ts`): active only when `margin > 0`; at `out.length === 0` take from the reserved lane when `r0.score - m0.score <= margin * Math.abs(m0.score)` on raw BM25(+proximity) scores — captured before `coverageRerank` re-sorts the lane (MMR reorders only, no capture needed); the lead pick increments `taken` and populates `seen` like any reserved take; slots 2..N keep the existing running-share rule.
- [x] 2.9 Thread `laneLeadMargin` from config into `store.search` in both `packages/kb-extension/src/extension.ts` and `packages/kb/src/cli.ts`.
- [x] 2.10 Test (test-plan #E7): explicit `doc_type` with margin `0` vs `0.5` yields identical hit lists — `laneShare === 0` means `interleaveLanes` never runs, so the lead rule cannot override the caller's restriction.
- [x] 2.11 Test (test-plan #E8): `laneQuota: 0` with margin `0` vs `0.5` yields identical hit lists — the knob is inert without a reserved lane.

## 3. Discoverability of `doc_type` (design D4)

- [x] 3.1 Give the `doc_type` parameter a `description` in `packages/kb-extension/src/extension.ts` naming the lane trade-off in both directions, without recommending one value unconditionally.
- [x] 3.2 Add a `promptGuidelines` entry stating: file/symbol lookup → `doc_type: "agents"`; conceptual / how-does-X → leave unset.
- [x] 3.3 Schema test (test-plan #E1): the registered `doc_type` description is non-empty, names both lanes (`agents` AND an unset/default-lane hint), and contains no unconditional recommendation.
- [x] 3.4 Guideline test (test-plan #E2): a `promptGuidelines` entry carries both halves — file/symbol → `agents`, conceptual → unset.
- [x] 3.5 Reconcile the wording with the existing `doc_type` rule in root `AGENTS.md` (commit `48d6b35a1`) so schema and doctrine agree.
- [x] 3.6 (test-plan: manual-only #M2) After rebuild + `npm run reload`, verify the deployed tool schema carries the new description; if not, find the second registration path that shipped a `doc_type` hint absent from repo source.

## 4. Record-type marks in output (design D5)

- [x] 4.1 In `packages/kb/src/render.ts`, push `[agents]` / `[source-md]` into the existing `marks` array and emit nothing for `doc`.
- [x] 4.2 Render tests (test-plan #E12): marks present on `agents`/`source-md` hits, absent for `doc`, compose with `(+N dup)` / `(+N more sections)`, and appear in the CLI single-line form — update the exact-string expectations in `packages/kb/src/__tests__/render.test.ts` (shared renderer ⇒ CLI output changes too).
- [x] 4.3 Update the `kb_search` tool description's mark inventory to include the record-type mark.

## 5. Measure and choose the default (design D6)

- [x] 5.1 Extend the `--sweep` mode of `packages/kb/eval/run-fixtures.ts` with a `laneLeadMargin` axis (grid `{0.1, 0.2, 0.3, 0.5}`; degenerate `1.0` excluded) on a base that mirrors the extension's option object (reuse the shared `searchOptsFromConfig` helper from `fix-kb-eval-measurement-integrity` so `rootPriority`/`expandParent` are not dropped), plus an explicit `coverageRerank`/prf-on spot-check row; report source-intent and markdown-intent metrics side by side per row.
- [x] 5.2 Sweep-row test (test-plan #E13): the report builder emits BOTH fixture metric groups for every margin row; a row missing one is a harness error, never a silent cell (extract the row builder if needed for an in-process assert).
- [x] 5.3 Run the sweep and write the full paired table to `measurements.md`; no row may report a single fixture. Note the harness's residual `rootPriority: {}` drift there.
- [x] 5.4 (test-plan: manual-only #M1) Choose the shipped default against the D6 bar: source-intent P@1 gain ≥ +0.03 with markdown-intent ΔP@1 ≥ −0.01, preferring the smallest clearing margin (union-bound ceiling ≈ +0.27; +0.19 is the always-fire approximation). Record the rationale; if none clears the bar, ship `0` and say why.
- [x] 5.5 Set the chosen value as the `laneLeadMargin` default in `packages/kb/src/config.ts` and re-run the fixtures at the shipped default to confirm the recorded numbers.

## 6. Verify and document

- [x] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm no regressions in `packages/kb` or `packages/kb-extension`.
- [x] 6.2 Rebuild `packages/kb/dist` so the bin and the extension stay on the same engine.
- [x] 6.3 Update `packages/kb/src/AGENTS.md` (config + sqlite-store + types + render rows) and `packages/kb-extension/src/AGENTS.md` with the new knob, mark, and `See change:` pointer.
- [x] 6.4 If the shipped default changes the trade-off, update the root `AGENTS.md` `doc_type` rule via a DocScribe-style caveman-style edit and cite the new measured numbers.
- [x] 6.5 Run `openspec validate --changes fix-kb-search-lane-composition` and confirm every spec scenario is covered by a test or a recorded measurement.
