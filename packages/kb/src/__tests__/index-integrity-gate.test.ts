// One option derivation + per-source gate + back-compat stamps.
// See change: fix-kb-index-integrity (test-plan E1-E5, X14).
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the real chunker (pass-through) so "not re-chunked" is observable. See change: throttle-kb-reindex (#S7-#S9).
vi.mock("../chunker.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../chunker.js")>();
  return { ...m, chunkMarkdown: vi.fn(m.chunkMarkdown) };
});

// @ts-expect-error plain-JS lib without type declarations
import { computeRowsHash, computeSrcHash } from "../../bin/lib/engine-fingerprint.mjs";
import { chunkMarkdown } from "../chunker.js";
import { frontmatterConfigHash, indexOptionsFromConfig, indexOptionsHash, loadConfig, type ResolvedConfig } from "../config.js";
import { setRunningEngineForTest, sourceGateIsStale } from "../index-gate.js";
import { runIndexAtomic } from "../index-run.js";
import { SCHEMA_VERSION, SqliteFtsStore } from "../sqlite-store.js";
import { copyKbSrc } from "./helpers/src-sandbox.js";

let root: string;
let dbPath: string;
let cfg: ResolvedConfig;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-gate-"));
  dbPath = join(root, "kb/index.db");
  cfg = loadConfig(root, { configPath: join(root, "none.json") });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const PAD = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index here.";
function docs(name: string, n = 3): { id: string; dir: string } {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(d, `f${i}.md`), `# T${i}\n\n${PAD} ${name} ${i}\n`);
  return { id: name, dir: d };
}
const meta = (k: string): string | null => {
  const s = new SqliteFtsStore(dbPath);
  try {
    return s.getMeta(k);
  } finally {
    s.close();
  }
};
const setMeta = (k: string, v: string | null) => {
  const s = new SqliteFtsStore(dbPath);
  s.init();
  if (v === null) s.read((db) => db.prepare("DELETE FROM kb_meta WHERE k=?").run(k));
  else s.setMeta(k, v);
  s.close();
};
const run = (sources: Array<{ id: string; dir: string }>, c = cfg) => runIndexAtomic({ dbPath, sources, indexOpts: indexOptionsFromConfig(c), gate: c });

describe("indexOptionsHash", () => {
  it("E1 selection-only options do not change the hash", () => {
    const base = indexOptionsHash(cfg);
    for (const patch of [{ exclude: ["x/**"] }, { include: ["y/**"] }, { extensions: [".md"] }, { respectGitignore: false }, { indexAgentsFiles: false }]) {
      expect(indexOptionsHash({ ...cfg, ...patch })).toBe(base);
    }
  });
  it("E2 includeSourceMarkdown: unset == true, false differs", () => {
    const h = (v: boolean | undefined) => indexOptionsHash({ frontmatter: cfg.frontmatter, includeSourceMarkdown: v });
    expect(h(undefined)).toBe(h(true));
    expect(h(false)).not.toBe(h(true));
  });
  it("frontmatter routing changes the hash", () => {
    expect(indexOptionsHash({ ...cfg, frontmatter: { ...cfg.frontmatter, facetKeys: [...cfg.frontmatter.facetKeys, { key: "team" }] } })).not.toBe(indexOptionsHash(cfg));
  });
});

describe("per-source gate", () => {
  it("E3 a source record absent / 2:<h> / 3:<other> forces every file; 3:<h> does not", async () => {
    const src = docs("docs", 4);
    await run([src]);
    const h = indexOptionsHash(cfg);
    const cases: Array<[string | null, boolean]> = [
      [null, true],
      [`2:${h}`, true],
      [`${SCHEMA_VERSION}:other`, true],
      [`${SCHEMA_VERSION}:${h}`, false],
    ];
    for (const [rec, forced] of cases) {
      setMeta("gate:docs", rec);
      const st = await run([src]);
      expect(st.changed, `record ${rec}`).toBe(forced ? 4 : 0);
    }
  });

  it("E4 a missing source is not stamped; a completed one is; a throwing one stays due", async () => {
    const good = docs("good");
    await run([good]);
    setMeta("gate:good", null);
    const missing = { id: "gone", dir: join(root, "gone") };
    await run([good, missing]);
    expect(meta("gate:good")).toBe(`${SCHEMA_VERSION}:${indexOptionsHash(cfg)}`);
    expect(meta("gate:gone")).toBeNull();
    // throwing source (a file, not a dir → ENOTDIR) after the good one
    setMeta("gate:good", null);
    const f = join(root, "notadir.md");
    writeFileSync(f, "x");
    await expect(run([good, { id: "bad", dir: f }])).rejects.toThrow();
    expect(meta("gate:good")).toBe(`${SCHEMA_VERSION}:${indexOptionsHash(cfg)}`);
    expect(meta("gate:bad")).toBeNull();
  });

  it("E5/X14 after a pass: user_version, frontmatter-only facetConfigHash — the pre-change gate predicate reads not-stale", async () => {
    await run([docs("docs")]);
    const s = new SqliteFtsStore(dbPath);
    expect(s.getUserVersion()).toBe(SCHEMA_VERSION);
    expect(s.getMeta("facetConfigHash")).toBe(frontmatterConfigHash(cfg.frontmatter));
    const preChangeStale = s.getUserVersion() < SCHEMA_VERSION || s.getMeta("facetConfigHash") !== frontmatterConfigHash(cfg.frontmatter);
    expect(preChangeStale).toBe(false);
    s.close();
  });

  it("E3b a changed includeSourceMarkdown option forces a pass; a selection-only change does not", async () => {
    const src = docs("docs", 2);
    await run([src]);
    expect((await run([src], { ...cfg, exclude: ["zzz/**"] })).changed).toBe(0);
    expect((await run([src], { ...cfg, includeSourceMarkdown: false })).changed).toBe(2);
  });
});

// ---- change: throttle-kb-reindex (D1) — the engine record is `rowsHash` ----
describe("runningEngine reads rowsHash (S6)", () => {
  afterEach(() => {
    delete process.env.KB_ENGINE_FINGERPRINT;
  });
  /** Import a SANDBOX copy of index-gate.ts so its `../engine-fingerprint.json` is the variant under test. */
  async function gateWith(name: string, fp: string | null) {
    const pkg = copyKbSrc(join(root, name));
    if (fp !== null) writeFileSync(join(pkg, "engine-fingerprint.json"), fp);
    return (await import(/* @vite-ignore */ join(pkg, "src", "index-gate.ts"))) as typeof import("../index-gate.js");
  }
  const VALID = JSON.stringify({ srcHash: "s".repeat(64), rowsHash: "r".repeat(64), tsconfigHash: null, distHash: null });

  it("a valid file yields its rowsHash (never srcHash)", async () => {
    const g = await gateWith("valid", VALID);
    expect(g.runningEngine()).toBe("r".repeat(64));
  });

  it.each([
    ["rowsHash absent", JSON.stringify({ srcHash: "s" })],
    ["rowsHash empty string", JSON.stringify({ srcHash: "s", rowsHash: "" })],
    ["rowsHash null", JSON.stringify({ srcHash: "s", rowsHash: null })],
    ["rowsHash a number", JSON.stringify({ srcHash: "s", rowsHash: 7 })],
    ["malformed JSON", "{ not json"],
    ["file missing", null],
  ])("invalid class (%s) → null, no throw, no engine record written or required", async (name, fp) => {
    const g = await gateWith(`invalid-${name.replace(/\W+/g, "-")}`, fp);
    expect(g.runningEngine()).toBeNull();
    const src = docs("docs", 2);
    const store = new SqliteFtsStore(dbPath);
    store.init();
    try {
      g.stampSource(store, cfg, src.id);
      g.stampPass(store, cfg);
      expect(store.getMeta(`engine:${src.id}`)).toBeNull(); // none written
      expect(g.sourceGateIsStale(store, cfg, src.id)).toBe(false); // none required
    } finally {
      store.close();
    }
  });
});

describe("engine record transitions with rowsHash (S7-S10)", () => {
  afterEach(() => setRunningEngineForTest(undefined));
  const calls = () => vi.mocked(chunkMarkdown).mock.calls.length;
  const edit = (pkg: string, rel: string) => appendFileSync(join(pkg, "src", rel), "\n// edit\n");

  it("S7 fresh → stays fresh: a non-row edit leaves rowsHash, so the source is not forced and no unchanged file is re-chunked", async () => {
    const pkg = copyKbSrc(join(root, "pkg-s7"));
    const src = docs("docs", 5);
    setRunningEngineForTest(computeRowsHash(pkg));
    await run([src]);
    edit(pkg, "render.ts"); // non-row edit, fingerprint regenerated
    setRunningEngineForTest(computeRowsHash(pkg));
    const s = new SqliteFtsStore(dbPath);
    try {
      expect(sourceGateIsStale(s, cfg, "docs")).toBe(false);
    } finally {
      s.close();
    }
    vi.mocked(chunkMarkdown).mockClear();
    expect((await run([src])).changed).toBe(0);
    expect(calls()).toBe(0);
  });

  it("S8 stale → stamped → fresh: a chunker edit forces every file once and stamps the new rowsHash", async () => {
    const pkg = copyKbSrc(join(root, "pkg-s8"));
    const src = docs("docs", 5);
    const h0 = computeRowsHash(pkg);
    setRunningEngineForTest(h0);
    await run([src]);
    expect(meta("engine:docs")).toBe(h0);
    edit(pkg, "chunker.ts");
    const h1 = computeRowsHash(pkg);
    expect(h1).not.toBe(h0);
    setRunningEngineForTest(h1);
    vi.mocked(chunkMarkdown).mockClear();
    expect((await run([src])).changed).toBe(5);
    expect(calls()).toBe(5);
    expect(meta("engine:docs")).toBe(h1);
    expect((await run([src])).changed).toBe(0);
  });

  it("S9 migration: a legacy srcHash record forces one pass per source, then becomes rowsHash", async () => {
    const pkg = copyKbSrc(join(root, "pkg-s9"));
    const a = docs("a", 3);
    const b = docs("b", 2);
    const rows = computeRowsHash(pkg);
    const legacy = computeSrcHash(pkg);
    expect(legacy).not.toBe(rows);
    setRunningEngineForTest(legacy);
    await run([a, b]); // as the pre-change build stamped it
    setRunningEngineForTest(rows);
    expect((await run([a, b])).changed).toBe(5);
    expect(meta("engine:a")).toBe(rows);
    expect(meta("engine:b")).toBe(rows);
    expect((await run([a, b])).changed).toBe(0);
  });

  it("S10 illegal (mixed versions): an old reader re-stamping srcHash makes the new reader stale again — documented ping-pong, pinned", async () => {
    const pkg = copyKbSrc(join(root, "pkg-s10"));
    const src = docs("docs", 3);
    const rows = computeRowsHash(pkg);
    setRunningEngineForTest(rows);
    await run([src]);
    setMeta("engine:docs", computeSrcHash(pkg)); // old reader stamps its srcHash
    const s = new SqliteFtsStore(dbPath);
    try {
      expect(sourceGateIsStale(s, cfg, "docs")).toBe(true);
    } finally {
      s.close();
    }
    expect((await run([src])).changed).toBe(3);
  });
});
