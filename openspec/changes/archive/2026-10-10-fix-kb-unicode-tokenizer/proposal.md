## Why

kb search is broken for any query with accented letters. The JS query tokenizer in `packages/kb/src/sqlite-store.ts` only knows `[a-z0-9]`, so `közzétételek` becomes `"zz" OR "telek"` and returns a real-estate doc about a *telek*. `árfolyamriasztás`, `Győr`, `működő` and `ügyfélszolgálat` return nothing. The FTS5 index (`porter unicode61`, `remove_diacritics=1`) is correct; only the query side is wrong. Every Hungarian (and German, French, …) kb is affected, e.g. `~/Documents`. Found and reproduced in `packages/kb/HANDOVER-unicode-tokenizer.md`.

The handover's prototype (NFD-strip every combining mark) fixes Hungarian but **regresses** Greek and multi-diacritic Latin (Vietnamese). `unicode61` keeps those accents, so the folded query term misses: measured `"tiếng"` 1 hit raw → 0 hits folded, `"Ελληνικά"` 1 → 0. This change folds exactly as `unicode61` does instead.

## What Changes

- Query and body tokenization uses Unicode letter/number classes (`\p{L}\p{N}`) instead of `[a-z0-9]`.
- Tokens are diacritic-folded by a JS fold that **mirrors `unicode61` `remove_diacritics=1`**, derived from an exhaustive sweep against SQLite. It folds a precomposed ASCII letter + one diacritic, drops nonspacing marks in decomposed text, and applies a small map of case folds `unicode61` performs (`ſ→s`, `ς→σ`, …). Everything else is left as-is (Greek tonos, multi-mark Latin, `ß`, `ø`, `ł`, non-Latin scripts).
- One shared fold + split routine (stopword filter layered on top where applied today) is used by all JS ranking stages: MATCH build, stopword fallback, coverage rerank, PRF, synonym expansion, MMR **and proximity boost**. `proximityDelta()` currently carries its own ASCII regex, which the handover missed.
- An exhaustive differential test runs every Latin/Greek/Cyrillic letter through both SQLite `unicode61` and the JS tokenizer and asserts equality, guarding against drift.
- ASCII **query tokens** are byte-identical to today. Ranking can shift where chunk bodies or headings contain accented letters: fragments like `zz`/`telek` become whole words. That shift is intended. The English golden sets gate it for no regression; the accented-query gain is proven by new integration tests. No index format change, no reindex, no `SCHEMA_VERSION` bump.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `kb-fts5-search-store`: requirement "Query matching, tokenization, and empty results". Tokenization is defined over Unicode letters/digits with `unicode61`-equivalent diacritic folding, instead of ASCII alphanumerics.

## Impact

- Code: `packages/kb/src/sqlite-store.ts` (`tokenize`, `toMatch`, `proximityDelta`, plus a new fold helper). New tests in `packages/kb/src/__tests__/unicode-tokenizer.test.ts`.
- Build artifact: `packages/kb/engine-fingerprint.json` is refreshed by `npm run build`.
- Index / DB: unchanged. Existing `.kb.db` files keep working.
- Ranking: no regression on the golden sets (P@1, MRR, Recall@10, duplicate-slot share) vs. a develop baseline from `packages/kb/eval/run-fixtures.ts --fresh`. Non-ASCII content becomes searchable.
- Rollback: revert the single commit. No data migration.
- Out of scope (follow-ups): the same ASCII split in the opt-in content-coverage signal (`packages/kb/src/verdict.ts` `coverageScore`); Hungarian morphology (`közzétételt` ↔ `közzétételek`) and non-English stopword sets.

## Discipline Skills

- `performance-optimization`: the fold runs per query and per candidate body in the rerank, MMR and proximity stages. Measure the search median/p95 with `packages/kb/eval/measure-search-latency.ts` before/after against the 50 ms median budget.
- `review-code`: non-trivial ranking-path change; review before commit.
- No `security-hardening` trigger: the query string is already untrusted input, the new regexes are linear char classes (no ReDoS), and the MATCH quoting is unchanged (tokens contain only `\p{L}\p{N}`, never `"`).
