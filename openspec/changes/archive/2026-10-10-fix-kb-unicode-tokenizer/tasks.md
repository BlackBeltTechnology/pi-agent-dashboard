## 1. Baseline (develop, before any code change)

- [x] 1.1 Record the develop baseline: from the repo root run `NODE_OPTIONS=--experimental-sqlite npx tsx packages/kb/eval/run-fixtures.ts --fresh --json` and `NODE_OPTIONS=--experimental-sqlite npx tsx packages/kb/eval/measure-search-latency.ts --json`. Create `openspec/changes/fix-kb-unicode-tokenizer/measurements.md` with both outputs (P@1, MRR, R@10, dupShare per set/row; search median/p95). Verify the file exists with both tables

## 2. Tests first (red on develop)

All tests go in `packages/kb/src/__tests__/unicode-tokenizer.test.ts`. Harness exemplar: `packages/kb/src/__tests__/kb.test.ts` (temp-dir corpus, `indexSource`, `SqliteFtsStore.search`). Export `rawTokens` and `tokenize` from `packages/kb/src/sqlite-store.ts` as `/** @internal */` (stub `rawTokens` = current ASCII behaviour so the file compiles red). Run with `cd packages/kb && NODE_OPTIONS=--experimental-sqlite npx vitest run src/__tests__/unicode-tokenizer.test.ts`.

- [x] 2.1 Accented word vs ASCII-fragment decoy (test-plan #E1): corpus `kozzetetel.md` (`# Közzétételek`) + `telek.md` · `search("közzétételek")` · top hit `kozzetetel.md`, `telek.md` absent. Verify red on develop
- [x] 2.2 Leading accented letter (test-plan #E2): `riasztas.md` (`# Árfolyamriasztás`) · `search("árfolyamriasztás")` · top hit `riasztas.md`. Verify red on develop
- [x] 2.3 Double-acute letters (test-plan #E3): `gyor.md` (`Győr … működő`) · `search("Győr")`, `search("működő")` · top hit `gyor.md` for both. Verify red on develop
- [x] 2.4 Accented ≡ unaccented (test-plan #E4): `gyor.md` with `Ügyfélszolgálat` · search `Ügyfélszolgálat` / `ügyfélszolgálat` / `ugyfelszolgalat` · all return `gyor.md` first. Verify red on develop
- [x] 2.5 Dotted capital I (test-plan #E5): `istanbul.md` with `İstanbul` · `search("İstanbul")`, `search("İSTANBUL")` · top hit `istanbul.md`; `rawTokens("İstanbul")` = `["istanbul"]`. Verify red on develop
- [x] 2.6 Unfolded scripts stay searchable (test-plan #E6): `greek.md` (`Ελληνικά κείμενα`), `viet.md` (`tiếng Việt`) · `search("Ελληνικά")`, `search("tiếng")` · top hits `greek.md` / `viet.md`; `rawTokens("Ελληνικά")` = `["ελληνικά"]`. Verify red on develop
- [x] 2.7 Multi-term accented query (test-plan #E7): `riasztas.md` + decoys · `search("értesítés árfolyam szint")` · top hit `riasztas.md`. Verify red on develop
- [x] 2.8 Exhaustive differential vs `unicode61` (test-plan #E8): every `\p{L}\p{N}` code point in 0x80–0x24F, 0x370–0x3FF, 0x400–0x4FF, 0x1E00–0x1EFF, 0x1F00–0x1FFF as `x<c>x` · in-memory `fts5(b, tokenize='unicode61')` + `fts5vocab(…,'instance')` ordered by offset vs `rawTokens()` (≥2 chars) · zero mismatches by code point except U+037F. Verify red on develop
- [x] 2.9 Exception map (test-plan #E9): `ſong`, `Σίσυφος`, `xµx`, `xϐx`, `xϑx`, `xϕx`, `xϖx`, `xϰx`, `xϱx`, `xϵx`, `xẛx`, `x\u1FBEx` · `rawTokens` vs `unicode61` vocab · equal by code point. Verify red on develop
- [x] 2.10 Decomposed input (test-plan #E10): `Ko\u0308zze\u0301tel`, `cafe\u0301`, `xa\u0301\u0302x`, `σι\u0301συφος`, `и\u0306ти`, `xø\u0301x`, `x\u0301x`, `\u0301abc` · `rawTokens` vs `unicode61` vocab · `kozzetel`, `cafe`, `xax`, `σισυφοσ`, `ити`, `xøx`, `xx`, `abc`. Verify red on develop
- [x] 2.11 Mc/Me separators (test-plan #E11): `xa\u0903x`, `xa\u20ddx` · `rawTokens` vs `unicode61` vocab · both `["xa"]`. Verify passes after implementation (may already pass on develop)
- [x] 2.12 Kept-as-is letters (test-plan #E12): `straße`, `łódź`, `xæx`, `xǣx`, `xǿx`, `m²` · `rawTokens` · `straße`, `łodz`, `xæx`, `xǣx`, `xǿx`, `m²`, equal to `unicode61`. Verify red on develop
- [x] 2.13 ASCII characterization (test-plan #E13): `how does pairing work`, `kb_search v2`, `Foo-Bar_baz 42x` · `tokenize()` · `["pairing","work"]`, `["kb","search","v2"]`, `["foo","bar","baz","42x"]`. Verify green both on develop and after the change
- [x] 2.14 Stopword-only fallback (test-plan #E14): query `how what the` + doc containing `what` · `search(q)` · non-empty result containing that doc. Verify green before and after
- [x] 2.15 No usable terms (test-plan #E15): `"é"`, `"\u0301\u0301"`, `"— →"` · `search(q)` · returns `[]`, no throw. Verify green after
- [x] 2.16 Proximity on accented body (test-plan #E16): doc A `árfolyam riasztás` adjacent, doc B same words 60 tokens apart, otherwise equal · `search("árfolyam riasztás", {proximityBoost:true})` · A ranks above B. Harness exemplar for proximity options: `packages/kb/src/__tests__/retrieval-quality.test.ts`. Verify red on develop
- [x] 2.17 Shared-tokenizer invariant (test-plan #E17): inputs of 2.1–2.12 · `tokenize(x)` vs `rawTokens(x)` · every `tokenize` token ∈ `rawTokens`, difference ⊆ STOP. Verify green after
- [x] 2.18 Hostile MATCH input (test-plan #X1): `ü" OR x* NEAR(` and lone `\uD800` · `search(q)` · no throw, no FTS5 syntax error. Verify green after
- [x] 2.19 Pathological fold input (test-plan #X2): 1 MB of `a\u0301` · `rawTokens(s)` · completes < 200 ms, one token of `a`s. Verify green after
- [x] 2.20 Existing index, no reindex (test-plan #X3): build `.kb.db` in-test via the unchanged index path, reopen with a new `SqliteFtsStore` · `search("közzétételek")` · no schema-mismatch error, top hit `kozzetetel.md`. Verify green after

## 3. Implementation

- [x] 3.1 Implement the fold per design D1 (exception map incl. `U+1FBE→ι`, drop every `\p{Mn}` wherever it occurs, Mc/Me stay separators, single-mark ASCII-base fold, lowercase last, ASCII fast path, non-ASCII-only `replace`) and the shared `rawTokens()` per D2 in `packages/kb/src/sqlite-store.ts`. Verify 2.8–2.12 go green
- [x] 3.2 Route `tokenize()`, the `toMatch()` fallback and `proximityDelta()` through `rawTokens()`, keeping today's filtered/unfiltered split. Verify `grep -n "a-z0-9\]{2,}" packages/kb/src/sqlite-store.ts` returns nothing and that all of section 2 is green
- [x] 3.3 If 2.8 shows a divergence not listed in D1, add it to the exception map with a 2.9 row (or, if out of scope, extend the allowlist with a comment and amend design D1 and the spec scenario). Verify 2.8 passes

## 4. Regression and performance

- [x] 4.1 Full package suite: `cd packages/kb && NODE_OPTIONS=--experimental-sqlite npx vitest run`. Verify 0 failures
- [x] 4.2 Ranking gate (test-plan #P3): re-run `run-fixtures.ts --fresh --json` (same command as 1.1) and append the results to `measurements.md` · row `+ lane quota (D3)` (matches the shipped config in `packages/kb/src/config.ts`; the PRF row's `= shipped default` label is stale) · every golden set: P@1, MRR, R@10 ≥ baseline and dupShare ≤ baseline. Other-row changes get a one-line explanation. Harness exemplar: `packages/kb/eval/run-fixtures.ts`
- [x] 4.3 Median latency gate (test-plan #P1): re-run `measure-search-latency.ts --json` (same command as 1.1, cached index) and append it to `measurements.md` · median ≤ 50 ms. Harness exemplar: `packages/kb/eval/measure-search-latency.ts`. Accepted by user: budget missed on develop too (environmental); Δ attributable +1.7%, see measurements.md
- [x] 4.4 Tail latency gate (test-plan #P2): compare the 4.3 run with the 1.1 baseline · p95_after ≤ p95_baseline × 1.10. On breach, rerun 3× per side ("before" = `git stash` the `src/` change; reuse the cached index) and gate on the median of the runs. Record all runs in `measurements.md`

## 5. Closeout

- [x] 5.1 `cd packages/kb && npm run build`, then commit the refreshed `engine-fingerprint.json`. Verify `node scripts/check-kb-dist-fresh.mjs` passes from the repo root
- [x] 5.2 Update the `sqlite-store.ts` row and add a `__tests__/unicode-tokenizer.test.ts` row in `packages/kb/src/AGENTS.md` (`See change: fix-kb-unicode-tokenizer`). Verify `grep -n "fix-kb-unicode-tokenizer" packages/kb/src/AGENTS.md` gives ≥ 2 hits
- [x] 5.3 Add a `### Fixed` bullet under `## [Unreleased]` in the root `CHANGELOG.md`: "kb search: queries with accented letters (Hungarian, German, French, …) no longer split into ASCII fragments; Greek and Vietnamese accents are preserved like the index". Verify `grep -n "accented letters" CHANGELOG.md`
- [x] 5.4 Delete `packages/kb/HANDOVER-unicode-tokenizer.md` and its row in `packages/kb/AGENTS.md`. Verify with `git status` that the handover is gone and `grep -c HANDOVER packages/kb/AGENTS.md` is 0
