import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkMarkdown } from "../chunker.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { indexSource } from "../indexer.js";
import { loadConfig } from "../config.js";
import { evaluate } from "../eval.js";
import { kbInit } from "../init.js";
import { existsSync, readFileSync } from "node:fs";
import type { KbStore } from "../types.js";
import { resolveAll, classifyRef, sourceIdentity, filesystemResolver, npmResolver, httpsResolver } from "../sources.js";
import { isTrusted, recordTrust, canonicalSource } from "../trust.js";
import { agentsChain, doxInit, doxLint } from "../dox.js";
import { createServer, type Server } from "node:http";

describe("chunker", () => {
  it("splits on headings and builds breadcrumb", () => {
    const text =
      "# Top\nintro paragraph comfortably longer than the hundred character minimum threshold so it stays its own chunk for sure here.\n" +
      "## Sub\nsub-section body also comfortably longer than the hundred character minimum threshold so it remains a distinct separate chunk.";
    const { chunks } = chunkMarkdown({ root: "r", path: "a.md", text });
    const sub = chunks.find((c) => c.heading === "Sub");
    expect(sub).toBeTruthy();
    expect(sub!.headingPath).toBe("Top > Sub");
    expect(sub!.level).toBe(2);
  });

  it("never treats a # inside a fenced code block as a heading", () => {
    const text = "# Real\nprose long enough to keep this chunk alive after merge thresholds apply here.\n\n```sh\n# not a heading\necho hi\n```\nmore prose that is also sufficiently long to remain its own content body.";
    const { chunks } = chunkMarkdown({ root: "r", path: "b.md", text });
    expect(chunks.every((c) => c.heading !== "not a heading")).toBe(true);
    // the fence content stays inside the Real section
    expect(chunks.some((c) => c.body.includes("# not a heading"))).toBe(true);
  });

  it("extracts wikilinks and md links", () => {
    const { wikilinks, mdLinks } = chunkMarkdown({ root: "r", path: "c.md", text: "see [[Other Note]] and [x](./sub/y.md)" });
    expect(wikilinks).toContain("Other Note");
    expect(mdLinks).toContain("./sub/y.md");
  });
});

describe("indexer + store (integration)", () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteFtsStore;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-it-"));
    const AUTH =
      "# Auth Guide\nThis guide explains how authentication works including the interceptor and principal resolution flow in enough detail to exceed the merge threshold.\n" +
      "## Token Extraction\nExtract claims from the bearer token to identify the principal user account; this body is long enough to remain its own dedicated chunk for testing.";
    writeFileSync(join(dir, "auth.md"), AUTH);
    writeFileSync(
      join(dir, "theme.md"),
      "# Theming\nThe theming system controls palette and typography across light and dark variants with enough descriptive text to exceed the tiny-chunk merge threshold here.\n" +
        "## Dark Mode\nChange the dark palette colors in the generated theme file for a night appearance; this section is intentionally verbose to remain a separate chunk.",
    );
    // exact duplicate of auth.md in a sub-tree → dedup target
    mkdirSync(join(dir, "copy"), { recursive: true });
    writeFileSync(join(dir, "copy/auth.md"), AUTH);
    dbPath = join(dir, ".kb.db");
    store = new SqliteFtsStore(dbPath);
    store.init();
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes and searches", async () => {
    const s = await indexSource(store, { root: "t", dir });
    expect(s.changed).toBe(3);
    const hits = store.search("extract claims from token", { limit: 5 });
    expect(hits[0].path).toMatch(/auth\.md$/);
    expect(hits[0].headingPath).toContain("Token Extraction");
  });

  it("collapses exact-content duplicates with akaPaths", () => {
    const hits = store.search("extract claims principal account", { limit: 5 });
    const top = hits.find((h) => h.path.endsWith("auth.md"));
    expect(top?.akaPaths?.length).toBeGreaterThanOrEqual(1);
  });

  it("incremental: re-index is a no-op when nothing changed", async () => {
    const s = await indexSource(store, { root: "t", dir });
    expect(s.changed).toBe(0);
    expect(s.deleted).toBe(0);
  });

  it("incremental: editing one file reindexes only that file", async () => {
    writeFileSync(
      join(dir, "theme.md"),
      "# Theming\nThe theming system controls palette and typography across light and dark variants with enough descriptive text to exceed the tiny-chunk merge threshold here.\n" +
        "## Dark Mode\nUpdated: tweak the dark palette and add a high-contrast variant for accessibility; verbose enough to remain a distinct chunk after the edit reindex.",
    );
    const s = await indexSource(store, { root: "t", dir });
    expect(s.changed).toBe(1);
    expect(store.search("high-contrast variant accessibility", { limit: 3 })[0].path).toMatch(/theme\.md$/);
  });

  it("incremental: deleting a file purges its rows", async () => {
    rmSync(join(dir, "theme.md"));
    const s = await indexSource(store, { root: "t", dir });
    expect(s.deleted).toBe(1);
    const hits = store.search("dark palette night appearance", { limit: 5 });
    expect(hits.every((h) => !h.path.endsWith("theme.md"))).toBe(true);
  });

  it("graph: child_of neighbors reach the parent section", () => {
    const nbrs = store.neighbors("Auth Guide > Token Extraction", 2);
    expect(nbrs.some((n) => n.name.includes("Auth Guide"))).toBe(true);
  });

  it("doc_type: AGENTS.md tagged 'agents', source-dir md tagged 'source-md'", async () => {
    const sub = mkdtempSync(join(tmpdir(), "kb-dt-"));
    try {
      writeFileSync(join(sub, "AGENTS.md"), "# Agents\nRules for the agent working in this repo, padded to survive the merge threshold cleanly.\n");
      mkdirSync(join(sub, "src"), { recursive: true });
      writeFileSync(join(sub, "src", "note.md"), "# Note\nA source-co-located note long enough to remain its own chunk after merge thresholds apply here.\n");
      writeFileSync(join(sub, "guide.md"), "# Guide\nA regular doc-root markdown guide long enough to remain its own chunk after merge thresholds apply here.\n");
      const db2 = join(sub, ".kb.db");
      const st2 = new SqliteFtsStore(db2); st2.init();
      await indexSource(st2, { root: "t", dir: sub }, { includeSourceMarkdown: true });
      const agents = st2.search("rules", { limit: 5, docType: "agents" });
      expect(agents.every((h) => h.docType === "agents")).toBe(true);
      expect(agents.some((h) => h.path.endsWith("AGENTS.md"))).toBe(true);
      const src = st2.search("source-co-located", { limit: 5, docType: "source-md" });
      expect(src.some((h) => h.path.includes("src/"))).toBe(true);
      st2.close();
    } finally { rmSync(sub, { recursive: true, force: true }); }
  });

  it("eval: golden harness reports metrics", () => {
    const m = evaluate(store, [{ q: "extract claims principal account token", expect: "auth.md" }], { k: 10 });
    expect(m.n).toBe(1);
    expect(m["P@1"]).toBe(1);
    expect(m["Recall@K"]).toBe(1);
    expect(m.MRR).toBe(1);
  });
});

describe("config layering", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-cfg-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults when no project/global config (no file cap)", () => {
    const cfg = loadConfig(dir, { configPath: join(dir, "missing.json") });
    expect(cfg.maxFileCount).toBeNull();
    expect(cfg.include).toContain("**/*.md");
    expect(cfg.dbPath).toContain(".pi/dashboard/kb/index.db");
  });

  it("project config fills absent fields from defaults; legacy roots[] → sources", () => {
    const p = join(dir, "kb.json");
    writeFileSync(p, JSON.stringify({ roots: [{ path: "docs", priority: 5 }], trigram: true }));
    const cfg = loadConfig(dir, { configPath: p });
    expect(cfg.origin).toBe("project");
    expect(cfg.trigram).toBe(true); // from project
    expect(cfg.maxFileCount).toBeNull(); // filled from defaults
    expect(cfg.resolvedSources[0].id).toBe("docs");
    expect(cfg.resolvedSources[0].priority).toBe(5);
    expect(cfg.resolvedSources[0].dir).toContain("/docs");
  });

  it("absolute dbPath honored; relative resolved against cwd", () => {
    const p = join(dir, "kb2.json");
    writeFileSync(p, JSON.stringify({ sources: [{ kind: "filesystem", ref: "/abs/docs" }], dbPath: "custom/index.db" }));
    const cfg = loadConfig(dir, { configPath: p });
    expect(cfg.resolvedSources[0].dir).toBe("/abs/docs");
    expect(cfg.dbAbsPath).toBe(join(dir, "custom/index.db"));
  });

  it("deep-merges nested config keys (partial ranking keeps default fieldWeights)", () => {
    const p = join(dir, "nested.json");
    writeFileSync(p, JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], ranking: { proximityBoost: false } }));
    const cfg = loadConfig(dir, { configPath: p });
    expect(cfg.ranking.proximityBoost).toBe(false); // from project
    expect(cfg.ranking.fieldWeights.headingPath).toBe(10); // preserved from defaults (not wiped)
    expect(cfg.ranking.diversity.enabled).toBe(true); // preserved from defaults
  });

  it("validator rejects bad sources and bad mode", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, JSON.stringify({ sources: [{ ref: 5 }] }));
    expect(() => loadConfig(dir, { configPath: p })).toThrow(/sources|ref/);
    const p2 = join(dir, "bad2.json");
    writeFileSync(p2, JSON.stringify({ queryExpansion: { mode: "bogus" } }));
    expect(() => loadConfig(dir, { configPath: p2 })).toThrow(/queryExpansion|mode/);
  });
});

describe("kb init", () => {
  let dir: string;
  beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "kb-init-"))));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("scaffolds a project config + gitignores dbPath", () => {
    const r = kbInit({ cwd: dir, sources: ["docs"] });
    expect(r.wrote).toBe(true);
    expect(existsSync(r.configPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(r.configPath, "utf8"));
    expect(cfg.sources[0].ref).toBe("docs");
    expect(cfg.maxFileCount).toBeNull();
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(r.gitignoreAdded!);
  });

  it("does not clobber without --force", () => {
    expect(() => kbInit({ cwd: dir })).toThrow(/already exists/);
  });

  it("--dry-run writes nothing", () => {
    const sub = join(dir, "dry");
    mkdirSync(sub, { recursive: true });
    kbInit({ cwd: sub, dryRun: true, sources: ["x"] });
    expect(existsSync(join(sub, ".pi", "dashboard", "knowledge_base.json"))).toBe(false);
  });

  it("--global targets the global path", () => {
    const r = kbInit({ global: true, dryRun: true });
    expect(r.configPath).toContain(".pi/dashboard/knowledge_base.json");
    expect(r.configPath).not.toBe(join(dir, ".pi", "dashboard", "knowledge_base.json"));
  });
});

describe("retrieval pipeline (Tier A/B/C)", () => {
  let dir: string, dbPath: string, store: SqliteFtsStore;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-rank-"));
    writeFileSync(
      join(dir, "rank.md"),
      "# Auth\nA long body about unrelated things like weather and clouds to pad the section well past the merge threshold.\n" +
        "## Token Rotation\nThe token rotation mechanism refreshes short-lived credentials on a schedule for safety and correctness here.\n",
    );
    writeFileSync(
      join(dir, "body.md"),
      "# Misc\nToken appears only in this body text without any heading mention at all, padded to survive the merge threshold cleanly here.\n",
    );
    dbPath = join(dir, ".kb.db");
    store = new SqliteFtsStore(dbPath);
    store.init();
    await indexSource(store, { root: "t", dir });
  });
  afterAll(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  it("BM25F: heading match outranks body-only match", () => {
    const hits = store.search("token", { limit: 5, fieldWeights: { headingPath: 10, heading: 5, body: 1 } });
    const rot = hits.findIndex((h) => h.headingPath.includes("Token Rotation"));
    const body = hits.findIndex((h) => h.path === "body.md");
    expect(rot).toBeGreaterThanOrEqual(0);
    if (body >= 0) expect(rot).toBeLessThan(body); // heading match ranks ahead
  });

  it("parent expand attaches the parent section", () => {
    const hits = store.search("token rotation refresh", { limit: 5, expandParent: true });
    const rot = hits.find((h) => h.headingPath.includes("Token Rotation"));
    expect(rot?.parent).toBeTruthy();
    expect(rot!.parent!.headingPath).toContain("Auth");
  });

  it("rerank flag is a clean no-op without a model", () => {
    const hits = store.search("token", { limit: 5, rerank: true });
    expect(hits.length).toBeGreaterThan(0); // no error, BM25 order preserved
  });

  it("lexical MMR runs and respects the limit", () => {
    const hits = store.search("token", { limit: 3, diversity: { enabled: true, lambda: 0.5 } });
    expect(hits.length).toBeLessThanOrEqual(3);
  });
});

describe("KbStore double (interface boundary)", () => {
  it("an in-memory double satisfies KbStore", () => {
    const mem: KbStore = {
      init() {}, begin() {}, commit() {}, rollback() {}, close() {},
      getFileState: () => null, setFileState() {}, listPaths: () => [], deleteByPath() {},
      insertChunk() {}, addNode() {}, addEdge() {},
      search: () => [], neighbors: () => [], backlinks: () => [], getChunk: () => null, getChunkById: () => null,
      counts: () => ({ files: 0, chunks: 0, nodes: 0, edges: 0 }),
    };
    expect(mem.search("x")).toEqual([]);
    expect(mem.counts().chunks).toBe(0);
  });
});

describe("doc-example integration", () => {
  const fileDir = new URL(".", import.meta.url).pathname;
  // corpus lives at repo root `doc-example/` (gitignored; absent in worktrees)
  const docExample = join(fileDir, "../../../..", "doc-example");
  const hasCorpus = existsSync(docExample);
  (hasCorpus ? it : it.skip)("indexes the real corpus and answers the golden queries", async () => {
    const db = join(tmpdir(), `kb-docex-${Date.now()}.db`);
    const store = new SqliteFtsStore(db);
    store.init();
    const s = await indexSource(store, { root: "doc-example", dir: docExample });
    expect(s.scanned).toBeGreaterThan(100);
    const hit = store.search("decoupled service creation CQRS pattern", { limit: 5, expandParent: true })[0];
    expect(hit?.path).toMatch(/interceptors\.md$/);
    expect(hit.parent).toBeTruthy();
    const nbrs = store.neighbors(hit.headingPath, 2);
    expect(nbrs.length).toBeGreaterThan(0);
    store.close();
    rmSync(db, { force: true }); rmSync(db + "-wal", { force: true }); rmSync(db + "-shm", { force: true });
  });
});

describe("source resolvers + trust", () => {
  let trustFile: string, cacheDir: string;
  beforeAll(() => {
    trustFile = join(tmpdir(), `kb-trust-${Date.now()}.json`);
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
    cacheDir = mkdtempSync(join(tmpdir(), "kb-cache-"));
  });
  afterAll(() => { delete process.env.KB_SOURCE_TRUST_PATH; rmSync(cacheDir, { recursive: true, force: true }); rmSync(trustFile, { force: true }); });

  it("classifyRef + sourceIdentity mirror pi rules", () => {
    expect(classifyRef("npm:@scope/pkg@1.2.3")).toBe("npm");
    expect(classifyRef("git:github.com/org/repo")).toBe("git");
    expect(classifyRef("https://x.org/y")).toBe("https");
    expect(classifyRef("docs")).toBe("filesystem");
    expect(sourceIdentity({ ref: "npm:@scope/pkg@1.2.3" })).toBe("npm:@scope/pkg");
    expect(sourceIdentity({ ref: "git:github.com/org/repo@v2" })).toBe("git:github.com/org/repo");
  });

  it("filesystem resolver resolves abs + project-relative, no trust needed", async () => {
    const abs = mkdtempSync(join(tmpdir(), "kb-fs-"));
    const r = await filesystemResolver.resolve({ kind: "filesystem", ref: abs }, { cwd: abs, cacheDir });
    expect(r.dir).toBe(abs);
    const rel = await filesystemResolver.resolve({ kind: "filesystem", ref: "docs" }, { cwd: abs, cacheDir });
    expect(rel.dir).toBe(join(abs, "docs"));
    rmSync(abs, { recursive: true, force: true });
  });

  it("npm resolver locates an installed pkg in cwd node_modules", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kb-npm-"));
    mkdirSync(join(cwd, "node_modules", "fake-pkg", "docs"), { recursive: true });
    writeFileSync(join(cwd, "node_modules", "fake-pkg", "docs", "x.md"), "# X\nhello docs padding to survive merge threshold here.\n");
    const r = await npmResolver.resolve({ kind: "npm", ref: "npm:fake-pkg", subdir: "docs" }, { cwd, cacheDir, promptTrust: async () => true });
    expect(r.dir).toBe(join(cwd, "node_modules", "fake-pkg", "docs"));
    rmSync(cwd, { recursive: true, force: true });
  });

  it("TOFU: untrusted remote blocks; recordTrust unblocks; filesystem skips trust", async () => {
    const spec = { kind: "https" as const, ref: "https://example.invalid/x.md" };
    await expect(httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir })).rejects.toThrow(/not trusted/);
    expect(isTrusted(spec)).toBe(false);
    recordTrust(spec);
    expect(isTrusted(spec)).toBe(true);
    expect(canonicalSource(spec)).toBe(canonicalSource(spec));
  });

  // Exercises the resolver's fetch → cache → write path against a loopback server.
  // A local HTTPS listener needs a self-signed cert; the fetch/cache logic is
  // scheme-agnostic, so we use http:// loopback to test the mechanism, not to
  // assert any "https-only" contract.
  it("https resolver fetches + caches a single .md (fetch path, loopback)", async () => {
    const body = "# Fetched\nRemote markdown content long enough to remain a chunk after merge.\n";
    const srv: Server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/markdown" }); res.end(body); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as any).port;
    const url = `http://127.0.0.1:${port}/note.md`;
    const spec = { kind: "https" as const, ref: url };
    recordTrust(spec);
    const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir });
    expect(existsSync(join(r.dir, "note.md"))).toBe(true);
    expect(readFileSync(join(r.dir, "note.md"), "utf8")).toBe(body);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("resolveAll preserves order + priority across sources", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kb-all-"));
    writeFileSync(join(cwd, "local.md"), "# Local\nlocal doc padding to survive merge threshold cleanly here.\n");
    const specs = [{ kind: "filesystem" as const, ref: join(cwd, "local.md"), priority: 10 }];
    const out = await resolveAll(specs, { cwd, cacheDir });
    expect(out[0].priority).toBe(10);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("dox: kb agents chain", () => {
  let dir: string;
  beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "kb-agents-"))));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("returns root→nearest AGENTS.md chain for a path", () => {
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# Root\nroot rules.\n");
    writeFileSync(join(dir, "sub", "AGENTS.md"), "# Sub\nsub rules.\n");
    writeFileSync(join(dir, "sub", "code.ts"), "export const x = 1;\n");
    const { chain } = agentsChain(dir, join(dir, "sub", "code.ts"), { claudeMd: true });
    expect(chain.map((c) => c.rel)).toEqual(["AGENTS.md", "sub/AGENTS.md"]);
  });

  it("falls back to a manifest when no AGENTS.md on the path", () => {
    const sub = mkdtempSync(join(tmpdir(), "kb-fb-"));
    writeFileSync(join(sub, "note.md"), "# Note\na note.\n");
    const { chain, manifest } = agentsChain(sub, join(sub, "note.md"), { fallbackManifest: true });
    expect(chain.length).toBe(0);
    expect(manifest).toContain("note.md");
    rmSync(sub, { recursive: true, force: true });
  });
});

describe("dox: source-aware kb dox init (migrate-file-index deltas)", () => {
  let dir: string;
  const w = (rel: string, body = "export const x = 1;\n") => {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-doxsrc-"));
    // real source tree across nested dirs
    w("src/client/App.tsx");
    w("src/client/components/Foo.tsx");
    w("src/client/components/Bar.tsx");
    w("src/server/index.ts");
    // delta ①: skipped source shapes
    w("src/types.d.ts");
    w("src/client/App.test.tsx");
    w("src/__tests__/helper.ts");
    // non-source ignored
    w("src/notes.md", "# notes\n");
    // delta ②: excluded noise trees
    w(".worktrees/repo/src/z.ts");
    w("openspec/changes/y.ts");
    w("doc-example/e.ts");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("delta ③+A: every dir with ≥1 source file gets its own AGENTS.md (grouped by full parent dir)", () => {
    const plan = doxInit({ cwd: dir });
    expect(plan.created).toContain(join(dir, "src", "client", "AGENTS.md"));
    expect(plan.created).toContain(join(dir, "src", "client", "components", "AGENTS.md"));
    expect(plan.created).toContain(join(dir, "src", "server", "AGENTS.md"));
  });

  it("delta ⑤: rows are relative to each AGENTS.md's own directory", () => {
    const comp = readFileSync(join(dir, "src", "client", "components", "AGENTS.md"), "utf8");
    expect(comp).toContain("`Foo.tsx`");
    expect(comp).toContain("`Bar.tsx`");
    expect(comp).not.toContain("src/client/components/Foo.tsx");
    // purpose column left empty for the agent to author
    expect(comp).toMatch(/`Foo\.tsx`\s*\|\s*\|/);
  });

  it("delta ①: skips .d.ts, *.test.*, __tests__ dirs, and non-source files", () => {
    doxInit({ cwd: dir });
    const client = readFileSync(join(dir, "src", "client", "AGENTS.md"), "utf8");
    expect(client).toContain("`App.tsx`");
    expect(client).not.toContain("App.test.tsx"); // *.test.* skipped
    // skipped shapes never create their own AGENTS.md
    expect(existsSync(join(dir, "src", "__tests__", "AGENTS.md"))).toBe(false); // __tests__ dir excluded
    expect(existsSync(join(dir, "src", "AGENTS.md"))).toBe(false); // only types.d.ts + notes.md here, both skipped
  });

  it("delta ②: excludes .worktrees, openspec, doc-example", () => {
    const plan = doxInit({ cwd: dir });
    const paths = [...plan.created, ...plan.appended.map((a) => a.file)];
    expect(paths.some((p) => p.includes(".worktrees"))).toBe(false);
    expect(paths.some((p) => p.includes(join(dir, "openspec")))).toBe(false);
    expect(paths.some((p) => p.includes("doc-example"))).toBe(false);
  });

  it("delta ④: no part-N pseudo-directories", () => {
    const plan = doxInit({ cwd: dir });
    expect(plan.created.some((p) => /part-\d+/.test(p))).toBe(false);
  });

  it("is idempotent: rerun creates nothing new", () => {
    doxInit({ cwd: dir });
    const before = readFileSync(join(dir, "src", "client", "components", "AGENTS.md"), "utf8");
    const plan = doxInit({ cwd: dir });
    expect(plan.created.length).toBe(0);
    expect(readFileSync(join(dir, "src", "client", "components", "AGENTS.md"), "utf8")).toBe(before);
  });

  it("--dry-run writes nothing", () => {
    const sub = mkdtempSync(join(tmpdir(), "kb-doxdry-"));
    mkdirSync(join(sub, "src"), { recursive: true });
    writeFileSync(join(sub, "src", "a.ts"), "export const a = 1;\n");
    doxInit({ cwd: sub, dryRun: true });
    expect(existsSync(join(sub, "src", "AGENTS.md"))).toBe(false);
    rmSync(sub, { recursive: true, force: true });
  });
});

describe("dox: kb dox lint", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-doxlint-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# DOX\n\n| `src/a.md` |  |\n| `src/gone.md` |  |\n");
    writeFileSync(join(dir, "src", "a.md"), "# A\na doc that is fine.\n");
    // src/b.md is eligible but has no row (missing)
    writeFileSync(join(dir, "src", "b.md"), "# B\nb doc that is fine.\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("detects orphan + missing rows", () => {
    const r = doxLint({ cwd: dir });
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain("orphan"); // src/gone.md
    expect(kinds).toContain("missing"); // src/b.md
  });

  it("clean tree exits with no issues", () => {
    writeFileSync(join(dir, "AGENTS.md"), "# DOX\n\n| `src/a.md` |  |\n| `src/b.md` |  |\n");
    rmSync(join(dir, "src", "gone.md"), { force: true }); // not present anyway
    const r = doxLint({ cwd: dir });
    const real = r.issues.filter((i) => i.kind !== "missing-companion");
    expect(real.length).toBe(0);
  });

  it("--fix prunes orphans and adds missing path-only rows", () => {
    const r = doxLint({ cwd: dir, fix: true });
    expect(r.fixed).toBeGreaterThan(0);
    const after = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(after).not.toContain("gone.md");
    expect(after).toContain("src/b.md");
  });

  it("--json emits a machine-readable issue list", () => {
    const r = doxLint({ cwd: dir });
    expect(Array.isArray(r.issues)).toBe(true);
    for (const i of r.issues) expect(i).toHaveProperty("kind"), expect(i).toHaveProperty("agentsFile");
  });

  it("resolves row paths relative to the owning AGENTS.md dir (Defect A)", () => {
    // sub-dir AGENTS.md with a BARE BASENAME row for a sibling file that exists
    const sub = join(dir, "src", "nested");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "AGENTS.md"), "# DOX \u2014 src/nested\n\n| `api.ts` |  |\n");
    writeFileSync(join(sub, "api.ts"), "export const api = 1;\n");
    const r = doxLint({ cwd: dir });
    // api.ts exists next to its AGENTS.md → must NOT be an orphan
    expect(r.issues.filter((i) => i.kind === "orphan" && i.path === "api.ts").length).toBe(0);
  });

  it("falls back to repo-root for root-config rows documented in a sub-dir AGENTS.md (Option B)", () => {
    // docs/AGENTS.md documents root-level config that lives at the repo root
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "AGENTS.md"), "# DOX \u2014 docs\n\n| `biome.json` |  |\n");
    writeFileSync(join(dir, "biome.json"), "{}\n"); // at repo root, not in docs/
    const r = doxLint({ cwd: dir });
    expect(r.issues.filter((i) => i.kind === "orphan" && i.path === "biome.json").length).toBe(0);
  });

  it("ignores backtick cells in non-DOX prose tables (Defect B)", () => {
    writeFileSync(join(dir, "AGENTS.md"),
      "# DOX\n\n| `src/a.md` |  |\n| `src/b.md` |  |\n\n## Subagent Routing\n\n| Agent | Use |\n| `Explore` | search |\n");
    const r = doxLint({ cwd: dir });
    // `Explore` lives under a non-DOX heading → not a file row, no orphan
    expect(r.issues.filter((i) => i.path === "Explore").length).toBe(0);
  });
});
