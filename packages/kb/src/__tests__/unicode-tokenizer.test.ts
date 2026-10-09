// Tests for change: fix-kb-unicode-tokenizer.
// Query tokenization folds Latin/Greek/Cyrillic exactly as the FTS5 `unicode61`
// (remove_diacritics=1) tokenizer does, so accented queries hit their documents.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexSource } from "../indexer.js";
import { rawTokens, SqliteFtsStore, tokenize } from "../sqlite-store.js";

describe("kb search: non-ASCII queries (integration)", () => {
  let dir: string;
  let store: SqliteFtsStore;
  const top = (q: string) => store.search(q, { limit: 5 }).map((h) => h.path);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-unicode-"));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "kozzetetel.md"), "# Közzétételek\n\nA kibocsátói közzétételek listája a termékadatlapon érhető el.\n");
    // Decoy: contains the ASCII fragment "telek" the old tokenizer produced.
    writeFileSync(join(docs, "telek.md"), "# Ingatlan\n\nA telek 474 m², a telek mérete nagy.\n");
    writeFileSync(join(docs, "riasztas.md"), "# Árfolyamriasztás\n\nÁrfolyamriasztás beállítása: értesítés küldése, ha az árfolyam eléri a megadott szintet.\n");
    writeFileSync(join(docs, "gyor.md"), "# Győr\n\nGyőrött működő üzemről, Ügyfélszolgálat.\n");
    writeFileSync(join(docs, "istanbul.md"), "# Travel\n\nNotes about İstanbul and the Bosphorus.\n");
    writeFileSync(join(docs, "greek.md"), "# Γλώσσα\n\nΗ Ελληνικά γλώσσα έχει μακρά ιστορία.\n");
    writeFileSync(join(docs, "viet.md"), "# Ngôn ngữ\n\nHọc tiếng Việt mỗi ngày.\n");
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
    expect(top("kozzetetelek")[0]).toBe("kozzetetel.md");
    expect(top("Ügyfélszolgálat")[0]).toBe("gyor.md");
    expect(top("ügyfélszolgálat")[0]).toBe("gyor.md");
    expect(top("ugyfelszolgalat")[0]).toBe("gyor.md");
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

  it("decomposed input folds like precomposed input", () => {
    expect(top("Ko\u0308zze\u0301tételek")[0]).toBe("kozzetetel.md");
  });

  it("dotted capital I folds like the index", () => {
    expect(top("İstanbul")[0]).toBe("istanbul.md");
    expect(top("İSTANBUL")[0]).toBe("istanbul.md");
    expect(rawTokens("İstanbul")).toEqual(["istanbul"]);
  });

  it("scripts the index does not fold stay searchable with their accents", () => {
    expect(top("Ελληνικά")[0]).toBe("greek.md");
    expect(top("tiếng")[0]).toBe("viet.md");
    expect(rawTokens("Ελληνικά")).toEqual(["ελληνικά"]);
    expect(rawTokens("tiếng")).toEqual(["tiếng"]);
  });
});

describe("tokenize: unit rows", () => {
  it.each([
    ["közzétételek", ["kozzetetelek"]],
    ["Árfolyamriasztás beállítása", ["arfolyamriasztas", "beallitasa"]],
    ["Győr működő", ["gyor", "mukodo"]],
    ["straße café naïve", ["straße", "cafe", "naive"]],
  ])("%s", (input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });

  it.each([
    ["how does pairing work", ["pairing", "work"]],
    ["kb_search v2", ["kb", "search", "v2"]],
    ["Foo-Bar_baz 42x", ["foo", "bar", "baz", "42x"]],
  ])("ASCII unchanged: %s", (input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });
});

const hex = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");

/** unicode61 terms (length ≥ 2 code points) per input, in offset order. */
function sqliteTokens(inputs: string[]): string[][] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(b, tokenize='unicode61'); CREATE VIRTUAL TABLE v USING fts5vocab(t, 'instance');");
    const ins = db.prepare("INSERT INTO t(rowid, b) VALUES (?, ?)");
    db.exec("BEGIN");
    inputs.forEach((s, i) => ins.run(i + 1, s));
    db.exec("COMMIT");
    const out: string[][] = inputs.map(() => []);
    for (const r of db.prepare("SELECT term, doc FROM v ORDER BY doc, offset").all() as Array<{ term: string; doc: number }>) {
      if ([...r.term].length >= 2) out[r.doc - 1].push(r.term);
    }
    return out;
  } finally {
    db.close();
  }
}

function diff(inputs: string[]): string[] {
  const want = sqliteTokens(inputs);
  const bad: string[] = [];
  inputs.forEach((s, i) => {
    const got = rawTokens(s);
    if (got.length !== want[i].length || got.some((t, j) => t !== want[i][j])) {
      bad.push(`${hex(s)}: js=[${got.map(hex).join(" | ")}] sqlite=[${want[i].map(hex).join(" | ")}]`);
    }
  });
  return bad;
}

// Design D3: every Latin/Greek/Cyrillic letter/digit through SQLite's own
// unicode61 tokenizer (no stemming) vs rawTokens(), compared by code point.
describe("rawTokens: exhaustive differential vs SQLite unicode61", () => {
  const BLOCKS: Array<[number, number]> = [
    [0x80, 0x24f], [0x1e00, 0x1eff], // Latin
    [0x370, 0x3ff], [0x1f00, 0x1fff], // Greek
    [0x400, 0x4ff], // Cyrillic
  ];
  // U+037F GREEK CAPITAL LETTER YOT: newer than SQLite's unicode61 case tables.
  const ALLOW = new Set([0x37f]);
  const TARGETED = [
    "İstanbul", "İSTANBUL", "Σίσυφος", "ſong", "tiếng", "Ελληνικά", "straße",
    "Ko\u0308zze\u0301tel", "cafe\u0301", "xa\u0301\u0302x", "σι\u0301συφος",
    "и\u0306ти", "xø\u0301x", "x\u0301x", "\u0301abc", "xa\u0903x", "xa\u20ddx",
  ];
  it("every \\p{L}\\p{N} code point in the blocks tokenizes identically (allowlist U+037F)", () => {
    const inputs: string[] = [];
    for (const [lo, hi] of BLOCKS) {
      for (let cp = lo; cp <= hi; cp++) {
        const c = String.fromCodePoint(cp);
        if (!ALLOW.has(cp) && /[\p{L}\p{N}]/u.test(c)) inputs.push(`x${c}x`);
      }
    }
    expect(inputs.length).toBeGreaterThan(1000);
    expect(diff(inputs)).toEqual([]);
  });

  it("targeted words and decomposed / Mn / Mc / Me mark sequences tokenize identically", () => {
    expect(diff(TARGETED)).toEqual([]);
  });
});

describe("rawTokens: exception map and kept-as-is letters (vs unicode61)", () => {
  it("every exception-map entry matches unicode61 (E9)", () => {
    const inputs = ["ſong", "Σίσυφος", "xµx", "xϐx", "xϑx", "xϕx", "xϖx", "xϰx", "xϱx", "xϵx", "xẛx", "x\u1FBEx"];
    expect(diff(inputs)).toEqual([]);
    expect(rawTokens("ſong")).toEqual(["song"]);
    expect(rawTokens("Σίσυφος")).toEqual(["σίσυφοσ"]);
    expect(rawTokens("x\u1FBEx")).toEqual(["x\u03b9x"]);
    // toLowerCase turns word-final Σ into ς; unicode61 yields σ (final-sigma fixup).
    expect(diff(["ΟΔΟΣ", "ΣΙΣΥΦΟΣ ΟΔΟΣ"])).toEqual([]);
    expect(rawTokens("ΟΔΟΣ")).toEqual(["οδοσ"]);
  });

  it("letters without an ASCII single-mark decomposition are kept (E12)", () => {
    const inputs = ["straße", "łódź", "xæx", "xǣx", "xǿx", "m²"];
    expect(diff(inputs)).toEqual([]);
    expect(inputs.map((s) => rawTokens(s)[0])).toEqual(["straße", "łodz", "xæx", "xǣx", "xǿx", "m²"]);
  });

  it("decomposed sequences fold to the expected terms (E10, E11)", () => {
    const cases: Array<[string, string[]]> = [
      ["Ko\u0308zze\u0301tel", ["kozzetel"]], ["cafe\u0301", ["cafe"]], ["xa\u0301\u0302x", ["xax"]],
      ["σι\u0301συφος", ["σισυφοσ"]], ["и\u0306ти", ["ити"]], ["xø\u0301x", ["xøx"]], ["x\u0301x", ["xx"]],
      ["\u0301abc", ["abc"]], ["xa\u0903x", ["xa"]], ["xa\u20ddx", ["xa"]],
    ];
    for (const [input, want] of cases) expect(rawTokens(input)).toEqual(want);
  });

  it("tokenize is rawTokens minus stopwords only (E17)", () => {
    const inputs = ["közzétételek", "Árfolyamriasztás beállítása", "how does Győr work", "the İstanbul and Ελληνικά", "straße café naïve", "kb_search v2"];
    for (const s of inputs) {
      const raw = rawTokens(s);
      const kept = tokenize(s);
      expect(kept.every((t) => raw.includes(t))).toBe(true);
      for (const t of raw.filter((t) => !kept.includes(t))) expect(tokenize(t)).toEqual([]);
    }
  });

  it("pathological combining-mark input folds linearly (X2)", () => {
    const s = "a\u0301".repeat(500_000);
    const t0 = performance.now();
    const out = rawTokens(s);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out).toEqual(["a".repeat(500_000)]);
  });
});

describe("kb search: query edge cases and ranking stages", () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteFtsStore;
  const filler = Array.from({ length: 60 }, (_, i) => `filler${i}`).join(" ");

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-unicode-edge-"));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "what.md"), "# Questions\n\nWhat happens next is unclear.\n");
    writeFileSync(join(docs, "kozzetetel.md"), "# Közzétételek\n\nA kibocsátói közzétételek listája.\n");
    // E16: same words, same length; only the distance between the two query terms differs.
    writeFileSync(join(docs, "near.md"), `# Doc\n\nárfolyam riasztás ${filler}\n`);
    writeFileSync(join(docs, "far.md"), `# Doc\n\nárfolyam ${filler} riasztás\n`);
    dbPath = join(dir, ".kb.db");
    store = new SqliteFtsStore(dbPath);
    store.init();
    await indexSource(store, { root: "t", dir: docs });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a stopword-only query falls back to raw folded terms (E14)", () => {
    expect(store.search("how what the", { limit: 5 }).map((h) => h.path)).toContain("what.md");
  });

  it.each(["é", "\u0301\u0301", "— →"])("a query with no usable terms returns [] (E15): %j", (q) => {
    expect(store.search(q, { limit: 5 })).toEqual([]);
  });

  it("proximity boost works on accented bodies (E16)", () => {
    const paths = store.search("árfolyam riasztás", { limit: 5, proximityBoost: true }).map((h) => h.path);
    expect(paths.indexOf("near.md")).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf("far.md")).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf("far.md")).toBeGreaterThan(paths.indexOf("near.md"));
  });

  it.each(['ü" OR x* NEAR(', "\uD800", 'közzé"tételek'])("hostile MATCH input does not throw (X1): %j", (q) => {
    expect(() => store.search(q, { limit: 5 })).not.toThrow();
    for (const t of rawTokens(q)) expect(t).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it("an index built before reopening keeps working without reindex (X3)", () => {
    store.close();
    store = new SqliteFtsStore(dbPath);
    store.init();
    expect(store.search("közzétételek", { limit: 5 })[0]?.path).toBe("kozzetetel.md");
  });
});
