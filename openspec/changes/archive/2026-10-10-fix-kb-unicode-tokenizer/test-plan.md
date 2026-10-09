# Test Plan — fix-kb-unicode-tokenizer

Stage: design   Generated: 2026-10-08

Gate resolved: P2 p95 threshold = after ≤ baseline × 1.10. The user was asked and said "go on", so the first option was taken as the default.

Harness exemplars: `packages/kb/src/__tests__/kb.test.ts` (temp-dir corpus + `indexSource` + `SqliteFtsStore.search`), `packages/kb/src/__tests__/retrieval-quality.test.ts` (ranking assertions), `packages/kb/eval/run-fixtures.ts` / `measure-search-latency.ts` (measurement scripts).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Accented word is one term | EP (accented Latin) + decoy | L1 | automated | corpus: `kozzetetel.md` (`# Közzétételek …`), `telek.md` (`A telek 474 m²…`) | `search("közzétételek", {limit:5})` | top hit path `kozzetetel.md`; `telek.md` absent from results |
| E2 | Word starting with accented letter not truncated | BVA (accent at position 0) | L1 | automated | corpus: `riasztas.md` (`# Árfolyamriasztás …`) | `search("árfolyamriasztás")` | top hit `riasztas.md` (was: 0 hits) |
| E3 | Word starting with accented letter not truncated | BVA (double-acute ő/ű, short word) | L1 | automated | corpus: `gyor.md` (`# Győr … működő …`) | `search("Győr")`, `search("működő")` | each top hit `gyor.md` |
| E4 | Accented ≡ unaccented for single-diacritic Latin | EP (3 classes: upper-accented, lower-accented, ASCII) | L1 | automated | corpus `gyor.md` containing `Ügyfélszolgálat` | `search` with `Ügyfélszolgálat`, `ügyfélszolgálat`, `ugyfelszolgalat` | all three return `gyor.md` first |
| E5 | Dotted capital I folds like the index | BVA (case-expansion char U+0130) | L1 | automated | doc `istanbul.md` containing `İstanbul` | `search("İstanbul")`, `search("İSTANBUL")` | top hit `istanbul.md`; `rawTokens("İstanbul")` = `["istanbul"]` |
| E6 | Scripts the index does not fold stay searchable | EP (Greek tonos, multi-mark Latin) | L1 | automated | docs `greek.md` (`Ελληνικά κείμενα`), `viet.md` (`tiếng Việt`) | `search("Ελληνικά")`, `search("tiếng")` | top hits `greek.md` / `viet.md`; `rawTokens("Ελληνικά")` = `["ελληνικά"]` (tonos kept) |
| E7 | Multi-term accented query | EP | L1 | automated | `riasztas.md` + other corpus docs | `search("értesítés árfolyam szint")` | top hit `riasztas.md` |
| E8 | Query tokens agree with index normalization (exhaustive) | differential / oracle | L1 | automated | every `\p{L}\p{N}` code point in 0x80–0x24F, 0x370–0x3FF, 0x400–0x4FF, 0x1E00–0x1EFF, 0x1F00–0x1FFF wrapped `x<c>x` | insert into in-memory `fts5(b, tokenize='unicode61')`, read `fts5vocab(...,'instance')` by offset; compare with `rawTokens()` (≥2 chars) | zero mismatches by code point except allowlisted U+037F |
| E9 | Exception map entries | decision table (one row per map entry) | L1 | automated | `ſong`, `Σίσυφος`, `xµx`, `xϐx`, `xϑx`, `xϕx`, `xϖx`, `xϰx`, `xϱx`, `xϵx`, `xẛx`, `x\u1FBEx` | `rawTokens` vs `unicode61` vocab | equal: `song`, `σίσυφοσ`, `xμx`, `xβx`, … `xιx` (U+03B9) |
| E10 | Decomposed input folds like precomposed | EP (Mn after ASCII / Greek / Cyrillic / non-ASCII Latin base, lone, leading, multi-mark) | L1 | automated | `Ko\u0308zze\u0301tel`, `cafe\u0301`, `xa\u0301\u0302x`, `σι\u0301συφος`, `и\u0306ти`, `xø\u0301x`, `x\u0301x`, `\u0301abc` | `rawTokens` vs `unicode61` vocab | equal: `kozzetel`, `cafe`, `xax`, `σισυφοσ`, `ити`, `xøx`, `xx`, `abc` |
| E11 | Mc / Me marks are separators | EP (mark category) | L1 | automated | `xa\u0903x` (Mc), `xa\u20ddx` (Me) | `rawTokens` vs `unicode61` vocab | both yield `["xa"]` (1-char `x` dropped) |
| E12 | Letters kept as-is (no decomposition / non-ASCII base) | EP | L1 | automated | `straße`, `łódź`, `xæx`, `xǣx`, `xǿx`, `m²` | `rawTokens` | `straße`, `łodz`, `xæx`, `xǣx`, `xǿx`, `m²`; all equal to `unicode61` |
| E13 | ASCII queries tokenize as before | regression / characterization | L1 | automated | `how does pairing work`, `kb_search v2`, `Foo-Bar_baz 42x` | `tokenize()` on develop vs after | `["pairing","work"]`, `["kb","search","v2"]`, `["foo","bar","baz","42x"]`; identical before/after |
| E14 | Stopword-only fallback | BVA (all terms filtered) | L1 | automated | query `how what the` and corpus doc containing `what` | `search(q)` | executes (non-empty MATCH built from raw folded terms), returns the `what` doc |
| E15 | Query with no usable terms | BVA (0 tokens, 1-char tokens, marks only) | L1 | automated | `"é"`, `"\u0301\u0301"`, `"— →"` | `search(q)` | returns `[]` without throwing |
| E16 | Proximity uses shared tokenizer | EP (accented body, ordered adjacent terms) | L1 | automated | two docs, equal BM25 shape: A `… árfolyam riasztás …` (adjacent), B same words 60 tokens apart | `search("árfolyam riasztás", {proximityBoost:true})` | A ranks above B (the old ASCII regex gave both 0 proximity delta) |
| E17 | Ranking stages share tokenization (MMR/coverage) | invariant | L1 | automated | `rawTokens` exported; `tokenize(x)` ⊆ `rawTokens(x)` for corpus strings | call both on E1–E12 inputs | every `tokenize` token ∈ `rawTokens`, and `rawTokens \ tokenize` ⊆ STOP set |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | No search-latency regression (median budget) | threshold | L1 (eval script) | automated | `packages/kb/eval/measure-search-latency.ts --json` over the cached repo fixture index (~22k chunks) | median ≤ 50 ms | one full script run per side |
| P2 | No search-latency regression (tail) | tail-latency A/B | L1 (eval script) | automated | same as P1, develop baseline vs after, same machine, cached index | p95_after ≤ p95_baseline × 1.10; if exceeded, rerun 3× per side and gate on the median of the runs | 3 runs/side on breach |
| P3 | No ranking regression on golden sets | metric gate | L1 (eval script) | automated | `run-fixtures.ts --fresh --json`, all golden sets, row `+ lane quota (D3)` | P@1, MRR, R@10 ≥ baseline; dupShare ≤ baseline | one fresh run per side |

### Frontend-quirk

None. The change has no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | MATCH quoting safe for new token class | fault (hostile input) | L1 | automated | query `"ü\" OR x* NEAR(` with quotes, operators, lone surrogate `\uD800` | `search(q)` | no throw / no FTS5 syntax error; tokens contain only `\p{L}\p{N}` |
| X2 | Fold cost bounded on pathological input | fault (large input) | L1 (timed) | automated | 1 MB string of `a\u0301` repeated | `rawTokens(s)` | completes < 200 ms; result `["aaaa…"]` (linear, no ReDoS) |
| X3 | Existing DB keeps working (no reindex) | state (pre-built index) | L1 | automated | `.kb.db` built by develop code (fixture built in-test with the current index path; `SCHEMA_VERSION` unchanged) | open + `search("közzétételek")` with new code | no schema-mismatch error; top hit `kozzetetel.md` |

## Coverage summary

- Requirements covered: 1/1 MODIFIED requirement (all 12 scenarios) + proposal invariants (no reindex, latency, ranking, ASCII identity)
- Scenarios by class: edge 17 · perf 3 · frontend 0 · error 3
- Scenarios by level: L1 23 · L2 0 · L3 0
- Scenarios by disposition: automated 23 · manual-only 0

## New infra needed

none. All scenarios reuse vitest under `packages/kb/src/__tests__/` and the existing `packages/kb/eval/` scripts.
