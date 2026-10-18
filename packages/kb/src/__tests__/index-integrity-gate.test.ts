// One option derivation + per-source gate + back-compat stamps.
// See change: fix-kb-index-integrity (test-plan E1-E5, X14).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { frontmatterConfigHash, indexOptionsFromConfig, indexOptionsHash, loadConfig, type ResolvedConfig } from "../config.js";
import { runIndexAtomic } from "../index-run.js";
import { SCHEMA_VERSION, SqliteFtsStore } from "../sqlite-store.js";

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
