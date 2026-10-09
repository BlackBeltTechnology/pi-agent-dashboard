## Context

See proposal.md (Why). Facts on `9f592fb35`:

- The FTS5 table and `temp.kb_stem` use `tokenize='porter unicode61'` (`packages/kb/src/sqlite-store.ts:23`, `:317`). `remove_diacritics` defaults to 1 (verified behaviorally).
- The ASCII regex `/[a-z0-9]{2,}/` appears 3×: the `toMatch()` fallback (`sqlite-store.ts:85`), `tokenize()` (`:695`) and `proximityDelta()` (`:775`).
- `tokenize()` callers: `toMatch` (`:84`), `search()` qterms (`:416`), `coverageRerank` (`:634`), `prfTerms` (`:658`), `expandQuery` (`:715`), `mmr` (`:800`).
- `stems()` (`sqlite-store.ts:305-337`) maps raw tokens to indexed porter stems **through SQLite's own tokenizer**, and MATCH phrase terms are re-tokenized by FTS5. So stemming is applied symmetrically inside SQLite, and the JS tokens never need to equal porter output.

**Load-bearing assumption (stated so no future caller breaks it):** JS tokens are pre-stemming, `unicode61`-normalized forms. Anything that looks them up in the FTS vocab MUST go through `stems()` (or a MATCH), never use them as raw vocab keys.

## Goals / Non-Goals

**Goals:**
- JS tokens equal `unicode61` (pre-stemming) tokens for Latin, Greek and Cyrillic, with an exhaustive test guarding that.
- ASCII **query tokens** stay byte-identical to today.
- One shared fold + split routine for every stage.

**Non-Goals:**
- Stemming non-English languages; non-English stopwords.
- Changing the index tokenizer or schema.
- Exact parity for scripts/letters added to Unicode after SQLite's `unicode61` tables (see Risks).
- The opt-in content-coverage signal in `packages/kb/src/verdict.ts:393` (`coverageScore`: `split(/[^a-z0-9_]+/)` + raw `includes` over subject bytes) has the same ASCII fragmentation. It is default-off, non-ranking, and works on raw file bytes rather than chunks, so fixing it needs byte-side folding. Follow-up, out of scope here.

## Decisions

### D1. Fold = mirror `unicode61` `remove_diacritics=1`, derived empirically

Rule, applied per code point with **no NFC/NFD pre-normalization of the whole string**, then lowercase:

1. Explicit exception map (case/compat folds `unicode61` performs that `toLowerCase` does not): `ſ→s`, `ẛ→s`, `ς→σ`, `µ→μ`, `ϐ→β`, `ϑ→θ`, `ϕ→φ`, `ϖ→π`, `ϰ→κ`, `ϱ→ρ`, `ϵ→ε`, `\u1FBE→ι` (U+03B9; GREEK PROSGEGRAMMENI has a singleton NFD that `unicode61` applies, verified).
2. Every nonspacing mark (`\p{Mn}`) is dropped, wherever it occurs (after an ASCII, Greek or Cyrillic base, lone, or leading). This handles decomposed input as `unicode61` does: `Ko\u0308zze\u0301` → `kozze`, `σι\u0301συφος` → `σισυφοσ`, `и\u0306ти` → `ити`, `ø\u0301` → `ø`. Spacing (`Mc`) and enclosing (`Me`) marks are **not** token characters, so they act as separators (`xa\u0903x` → `xa`,`x`), again matching `unicode61` (verified).
3. A precomposed code point whose NFD is exactly **one ASCII letter + one combining mark** folds to that ASCII letter (`ő→o`, `İ→I`, `Ü→U`).
4. Everything else is kept unchanged: `ß`, `ø`, `ł`, `æ`, `ǣ`, `ǿ`, Greek tonos (`ά`), multi-mark Latin (`ế`), non-Latin scripts.
5. Lowercase **after** folding. Folding first makes `İ` fold via rule 3 before `toLowerCase` can expand it into `i`+U+0307.

Implementation shape: an ASCII fast path (`/^[\x00-\x7f]*$/` → `toLowerCase()` only); otherwise a single `replace(/[^\x00-\x7f]/gu, …)` callback applying rules 1–3 per non-ASCII code point (rule 2 = return `""` for `\p{Mn}`).

Evidence (SQLite 3.51.3, throwaway sweep against an in-memory `unicode61` table):
- All 134,105 `\p{L}\p{N}` code points 0x80–0x2FFFF: naive NFD-strip-all ≠ `unicode61` broadly (Greek tonos, `ế`). NFC + Latin-base rule: 1563 divergences. NFC breaks Devanagari nukta letters and CJK compatibility ideographs (composition exclusions), and `unicode61` does not fold onto non-ASCII bases (`ǣ`, `ǿ`, `ǯ`).
- Rules 1–5 (rule 2 then scoped to marks after an ASCII letter; generalized to all `Mn` after cycle-2 review, re-verified on the decomposed cases listed in rule 2) over 0x80–0x24F, 0x370–0x3FF, 0x400–0x4FF, 0x1E00–0x1EFF, 0x1F00–0x1FFF plus targeted words: **2 divergences out of 1271**: `Ϳ` (U+037F, a newer capital that `unicode61` does not lowercase) and U+1FBE (`unicode61` maps it to U+03B9; it looks identical, so verify by code point). U+1FBE is resolved by the rule-1 exception map; U+037F is the only allowlisted code point in the D3 test. (Figures are from Node 24's ICU; the in-block letter count can differ by ICU version, which is why D3 derives the set at runtime instead of hard-coding it.)

Alternatives:
- *NFD-strip-all (handover):* rejected. It regresses Greek and Vietnamese: `"tiếng"` 1→0 hits, `"Ελληνικά"` 1→0.
- *Widen the regex, no fold:* MATCH works, but JS stages would treat `közzétételek` and `kozzetetelek` as different tokens.
- *Ask SQLite to tokenize every string:* exact, but adds a SQL round-trip per candidate body on the hot path (rerank/MMR/proximity). D3 gives the same token-level guarantee at test time. (Pre-existing and unchanged: `hasStem`'s prefix arm in coverage rerank compares unstemmed JS tokens heuristically.)
- *Index `remove_diacritics=2`:* needs a schema bump and a reindex. Rejected on that ground alone.

### D2. One fold + split routine, stopword filter layered on top

A private `rawTokens(s)` = `fold(s).match(/[\p{L}\p{N}]{2,}/gu)`. `tokenize()` = `rawTokens()` + the STOP filter (unchanged). Callers that are unfiltered today stay unfiltered: the `toMatch()` stopword fallback and the `proximityDelta()` body positions. This preserves the current filtered/unfiltered split (query proximity terms stay stopword-filtered via `tokenize()`, as the Proximity requirement says). `\p{N}` is kept because `unicode61` treats `²` as a token character (`m²` → `m²` on both sides, verified).

### D3. Exhaustive differential test against the real tokenizer

The test inserts `x<c>x` for every `\p{L}\p{N}` code point in the Latin (0x80–0x24F, 0x1E00–0x1EFF), Greek (0x370–0x3FF, 0x1F00–0x1FFF) and Cyrillic (0x400–0x4FF) blocks into an in-memory `fts5(b, tokenize='unicode61')`. It reads terms back via `fts5vocab(…, 'instance')` ordered by offset and asserts equality with `rawTokens()`, except for an explicit allowlist (`U+037F` only). Comparison is by code point, not visual form. It also covers targeted words: `İstanbul`, `İSTANBUL`, `Σίσυφος`, `ſong`, `tiếng`, `Ελληνικά`, `straße`, and decomposed/mark cases `Ko\u0308zze\u0301tel`, `cafe\u0301`, `xa\u0301\u0302x`, `σι\u0301συφος`, `и\u0306ти`, `xø\u0301x`, `x\u0301x`, `\u0301abc`, `xa\u0903x` (Mc), `xa\u20ddx` (Me). The single-code-point sweep alone cannot catch mark handling, so these sequences are the mark-class coverage.

Exported for tests as `/** @internal */`: `rawTokens` (the D3 subject) and `tokenize` (the ASCII-unchanged rows).

The oracle is **plain** `unicode61` on purpose: JS tokens are pre-stemming, and porter runs inside SQLite on both sides (see Context). A new divergence fails the test. Fix it in the exception map with the allowlist unchanged, or, if it is out of scope, extend the allowlist with a comment.

## Risks / Trade-offs

- [ASCII query, accented corpus: ranking can shift] → Query tokens are identical, but body token sets/positions change where bodies **or headings** contain accented *letters* (coverage rerank, PRF and MMR tokenize `headingPath` too). Previously `közzétételek` contributed `zz`,`telek`; now it contributes `kozzetetelek`. Punctuation such as em-dashes and arrows is a separator before and after, so it is unaffected. This is intended (fragments were noise). It is gated by the 3.2 no-regression comparison, not by byte-identity.
- [Golden sets are English, so 3.2 cannot see the intended gain] → Accepted. 3.2 only guards against regression; the accented-query gain is proven by the 1.2 integration tests.
- [`\p{L}` now admits CJK/Cyrillic/Greek runs as tokens; they were dropped before] → Intended (they were unsearchable). No golden coverage, so the effect is unmeasured beyond the 1.2 Greek case.
- [Rule 2 drops a few `Mn` marks that `unicode61` (older Unicode tables) treats as token characters, e.g. U+1AB0 in the Combining Diacritical Marks Extended block] → Hard MATCH miss for that rare text; outside the Latin/Greek/Cyrillic contract. Accepted and documented.
- [Residual divergence outside Latin/Greek/Cyrillic: Cherokee, Georgian Mtavruli, newer Unicode capitals, some New Tai Lue letters `unicode61` treats as separators; ~478 code points] → Accepted. JS↔JS comparisons stay self-consistent, and MATCH/vocab lookups are re-tokenized by SQLite, so the effect is limited to slightly different JS rerank features for those scripts. Documented, not tested.
- [SQLite version drift in `unicode61` tables] → The D3 test runs on the runtime SQLite in CI.
- [Fold cost on accented bodies in rerank/MMR/proximity] → Measured 0.28 ms per 10 KB accented body with the non-ASCII-only replace (0.65 ms for a naive per-char loop); the ASCII fast path costs 0.028 ms vs 0.022 ms today. Gated by 3.3 against the 50 ms median search budget.

## Migration Plan

No data migration. Ship as one commit. Rollback = revert. Existing `.kb.db` files work before and after.
