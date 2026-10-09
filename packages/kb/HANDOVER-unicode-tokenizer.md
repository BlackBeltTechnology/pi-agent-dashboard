# Handover: kb tokenizer breaks non-ASCII (Hungarian) queries

| | |
|---|---|
| Package | `@blackbelt-technology/pi-dashboard-kb` 0.9.0 |
| File | `packages/kb/src/sqlite-store.ts` (`tokenize()` ~line 694, `toMatch()` ~line 83) |
| Base commit | `9f592fb35` (develop, 2026-10-08) |
| Found | 2026-10-08, while evaluating kb as a knowledge base for the Hungarian BÉT chatbot tender |
| Status | Reproduced. Fix prototyped and verified locally, then reverted. **Nothing committed.** |
| Suggested change id | `fix-kb-unicode-tokenizer` |

## 1. Symptom

`kb_search` / `kb search` with accented terms (Hungarian, German, French, etc.) returns wrong hits or nothing:

- `közzétételek` (disclosures) returns a real-estate document about a **telek** (plot of land).
- `árfolyamriasztás` (price alert) returns nothing, although a section with exactly that heading exists.
- `Győr`, `működő` and `ügyfélszolgálat` return nothing.
- The same words typed **without accents** (`kozzetetelek`, `gyor`) do match.

## 2. Root cause

The FTS5 index is fine. Its tokenizer is `porter unicode61`, and `unicode61` defaults to `remove_diacritics=1`, so `Közzétételek` is stored as `kozzetetelek`.

The problem is on the **query side**, in the JS tokenizer, which only knows ASCII:

```ts
// sqlite-store.ts
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function toMatch(q: string): string {
  const terms = tokenize(q);
  const kept = terms.length ? terms : (q.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
  return kept.map((t) => `"${t}"`).join(" OR ");
}
```

`/[a-z0-9]{2,}/g` treats every accented letter as a separator:

| Query | `tokenize()` output today | FTS MATCH sent | Effect |
|---|---|---|---|
| `közzétételek` | `zz`, `telek` (`k` dropped, under 2 chars) | `"zz" OR "telek"` | matches the word *telek* |
| `közzétételt` | `zz`, `telt` | `"zz" OR "telt"` | irrelevant / none |
| `árfolyamriasztás` | `rfolyamriaszt` | `"rfolyamriaszt"` | no such token, so no hit |
| `Győr` | `gy` | `"gy"` | no hit |
| `ha egy` | `ha`, `egy` | `"ha" OR "egy"` | stop-word noise (separate issue, §6) |

`tokenize()` has 6 call sites, so the corruption reaches every ranking stage, not only the MATCH:

| Line (approx.) | Caller | Impact |
|---|---|---|
| 84 | `toMatch()` | wrong FTS MATCH (the main bug) |
| 416 | `search()` → `qterms` | coverage rerank / PRF use fragment terms |
| 634 | `coverageRerank()` | document tokens fragmented the same way, so IDF coverage is wrong |
| 658 | `prfTerms()` | PRF mines fragments like `zz` as expansion terms |
| 715 | `expandQuery()` | synonym lookup keyed by fragments, so accented synonyms never fire |
| 800 | `mmr()` | Jaccard diversity computed on fragments |

## 3. Reproduction (failing test, written first)

Add `packages/kb/src/__tests__/unicode-tokenizer.test.ts`:

```ts
// Tests for change: fix-kb-unicode-tokenizer.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";

describe("kb search: non-ASCII (Hungarian) queries", () => {
  let dir: string;
  let store: SqliteFtsStore;
  const top = (q: string) => store.search(q, { limit: 5 }).map((h) => h.path);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-unicode-"));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "kozzetetel.md"), "# Közzétételek\n\nA kibocsátói közzétételek listája a termékadatlapon érhető el.\n");
    // Decoy: contains the ASCII fragment "telek" that the buggy tokenizer produces.
    writeFileSync(join(docs, "telek.md"), "# Ingatlan\n\nA telek 474 m², a telek mérete nagy.\n");
    writeFileSync(join(docs, "riasztas.md"), "# Árfolyamriasztás\n\nÁrfolyamriasztás beállítása: értesítés küldése, ha az árfolyam eléri a megadott szintet.\n");
    writeFileSync(join(docs, "gyor.md"), "# Győr\n\nGyőrött működő üzemről, Ügyfélszolgálat.\n");
    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir: docs });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an accented word matches its own document, not an ASCII fragment of it", () => {
    expect(top("közzétételek")[0]).toBe("kozzetetel.md");
    expect(top("közzétételek")).not.toContain("telek.md");
  });

  it("case and diacritics are folded like the FTS5 unicode61 index", () => {
    expect(top("Közzétételek")[0]).toBe("kozzetetel.md");
    expect(top("kozzetetelek")[0]).toBe("kozzetetel.md"); // unaccented input still works
    expect(top("Ügyfélszolgálat")[0]).toBe("gyor.md");
  });

  it("a word starting with an accented letter is not truncated", () => {
    expect(top("árfolyamriasztás")[0]).toBe("riasztas.md");
  });

  it("double-acute letters (ő, ű) are handled", () => {
    expect(top("Győr")[0]).toBe("gyor.md");
    expect(top("működő")[0]).toBe("gyor.md");
  });

  it("a multi-term accented query ranks the right document", () => {
    expect(top("értesítés árfolyam szint")[0]).toBe("riasztas.md");
  });
});
```

Also add a pure unit test for `tokenize` (export it as `/** @internal */`, or test through `toMatch`):

| Input | Expected tokens |
|---|---|
| `közzétételek` | `["kozzetetelek"]` |
| `Árfolyamriasztás beállítása` | `["arfolyamriasztas", "beallitasa"]` |
| `Győr működő` | `["gyor", "mukodo"]` |
| `straße café naïve` | `["straße", "cafe", "naive"]` (ß has no decomposition. Matches unicode61 behaviour, verify) |
| `how does pairing work` | `["pairing", "work"]` (**unchanged** ASCII behaviour) |
| `kb_search v2` | `["kb", "search", "v2"]` (unchanged) |

Run:

```sh
cd packages/kb
NODE_OPTIONS=--experimental-sqlite npx vitest run src/__tests__/unicode-tokenizer.test.ts
```

### Measured on `9f592fb35` (before the fix)

| Query | Top hit today | Expected |
|---|---|---|
| `közzétételek` | `telek.md` ❌ | `kozzetetel.md` |
| `Közzétételek` | `telek.md` ❌ | `kozzetetel.md` |
| `kozzetetelek` | `kozzetetel.md` ✅ | `kozzetetel.md` |
| `árfolyamriasztás` | (none) ❌ | `riasztas.md` |
| `értesítés árfolyam szint` | (none) ❌ | `riasztas.md` |
| `Győr` | (none) ❌ | `gyor.md` |
| `működő` | (none) ❌ | `gyor.md` |
| `ügyfélszolgálat` / `Ügyfélszolgálat` | (none) ❌ | `gyor.md` |

## 4. Proposed fix (prototyped, all green)

Fold diacritics in JS the same way `unicode61` does, and tokenize on Unicode letter/number classes:

```ts
/** Match FTS5 unicode61 (remove_diacritics=1): NFD, drop combining marks, lowercase. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}
function tokenize(s: string): string[] {
  return (fold(s).match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((t) => !STOP.has(t));
}

function toMatch(q: string): string {
  const terms = tokenize(q);
  const kept = terms.length ? terms : (fold(q).match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  return kept.map((t) => `"${t}"`).join(" OR ");
}
```

Why fold rather than only widening the regex:
- `toMatch` alone would work without folding, because FTS5 re-tokenizes the quoted term with unicode61.
- But `coverageRerank`, `prfTerms`, `mmr`, `hasStem` and `stems()` / `documentFrequencies()` compare JS tokens with each other **and** with FTS vocab terms, which are folded. Folding in JS keeps every stage on the same token space.
- No schema or index change: the stored index is already folded, so **no reindex and no `SCHEMA_VERSION` bump**.

### Verification done locally (2026-10-08, then reverted)

- Every row of the §3 table returned the expected document after the patch.
- Full package suite: `NODE_OPTIONS=--experimental-sqlite npx vitest run` → **30 files, 486 passed, 1 skipped, 0 failed**.
- Running vitest rewrote `engine-fingerprint.json`. It was restored. A real PR must run `npm run build` so the fingerprint is committed fresh (see `bin/lib/engine-fingerprint.mjs`).

### Still to do in the PR

1. Add the tests from §3 (red first on `develop`, then green).
2. Apply the §4 patch.
3. Run the retrieval benchmarks to prove there is no ranking regression on the (English) golden sets:
   ```sh
   cd packages/kb
   NODE_OPTIONS=--experimental-sqlite npx tsx eval/run-fixtures.ts --fresh
   ```
   Compare P@1 / MRR for `golden.markdown-intent.json` and `golden.source-intent.json` against the numbers in `openspec/changes/archive/*fix-kb-search-retrieval-quality*/measurements.md`. Expect identical results, since ASCII input yields the same tokens.
4. `npm run build` → commit the refreshed `engine-fingerprint.json`.
5. Update the `sqlite-store.ts` row in `packages/kb/src/AGENTS.md` (`See change: fix-kb-unicode-tokenizer`).
6. CHANGELOG entry (kb package): "kb search: non-ASCII queries (accented letters) no longer split into fragments".

## 5. Compatibility, risk, rollback

- **Compatibility:** ASCII queries tokenize identically. Index format is unchanged, so existing `.kb.db` files keep working with no reindex.
- **Risk:** low. 2 functions, ~5 lines. The edge case is scripts where unicode61 and NFD folding differ (e.g. `ß`, `ø`, `ł`, which have no NFD decomposition and stay as-is on both sides). Covered by the `straße` unit row. Also `\p{L}` now admits CJK, Cyrillic and similar runs as single tokens. That is an improvement over today, where they are dropped entirely.
- **Performance:** `normalize("NFD")` runs per query and per candidate body in the rerank and MMR stages. Negligible against the SQLite cost, but check it with `eval/measure-search-latency.ts --enrich`.
- **Rollback:** revert the single commit. No data migration to undo.

## 6. Related, out of scope (separate follow-ups)

- **No Hungarian morphology:** `porter` is an English stemmer, so inflected forms (`közzétételt` ↔ `közzétételek`, `árfolyamát` ↔ `árfolyam`) still don't match after this fix (`közzétételt` returned nothing in the prototype too). Options: a trigram tokenizer side table, a light prefix match (`"term"*` for tokens of 5+ chars), or a Hungarian Snowball stemmer as a custom FTS5 tokenizer (heavy). Measure first.
- **Stop words are English-only:** `ha`, `egy`, `a`, `az`, `és`, `hogy`, `nem`, `is` pass through as OR terms and dilute ranking (`ha egy` matches unrelated docs). Consider a small Hungarian STOP set behind a config key, e.g. `kb.stopwords: ["en","hu"]`.

## 7. Context

Found while assessing whether kb could replace a vector RAG for the BÉT mobile-app chatbot tender (BlackBelt, 2026-10). Verdict there: no (lexical-only retrieval is not enough for paraphrased end-user questions). This tokenizer bug is independent of that verdict, and it also affects every Hungarian-language kb in the archive (e.g. `~/Documents`).
