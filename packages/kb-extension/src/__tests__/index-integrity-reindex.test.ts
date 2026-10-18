// kb-extension: single creation path, live-build back-off, per-source gate + isolation.
// See change: fix-kb-index-integrity (test-plan E6, E30-E34, F5, X6, X10).
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexOptionsFromConfig, indexOptionsHash, indexSource, loadConfig, runIndexAtomic, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { afterEach, describe, expect, it, vi } from "vitest";
import kbExtension from "../extension.js";
import { closeKb, createReindexState, reindexNow } from "../reindex.js";

vi.mock("@blackbelt-technology/pi-dashboard-kb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-kb")>();
  return { ...actual, indexSource: vi.fn(actual.indexSource), runIndexAtomic: vi.fn(actual.runIndexAtomic) };
});

const BUILDING = "(index is still being built — no results available yet; retry shortly)";
const PAD = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index here.";
const dirs: string[] = [];
const kids: ChildProcess[] = [];
afterEach(() => {
  vi.mocked(indexSource).mockClear();
  vi.mocked(runIndexAtomic).mockClear();
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(opts: { files?: number; sources?: string[]; extra?: Record<string, unknown> } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-ext-int-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".pi/dashboard/kb"), { recursive: true });
  const sources = opts.sources ?? ["docs"];
  writeFileSync(join(dir, ".pi/dashboard/knowledge_base.json"), JSON.stringify({ sources: sources.map((ref) => ({ kind: "filesystem", ref })), dbPath: ".pi/dashboard/kb/index.db", ...opts.extra }));
  for (const s of sources) {
    mkdirSync(join(dir, s), { recursive: true });
    for (let i = 0; i < (opts.files ?? 3); i++) writeFileSync(join(dir, s, `f${i}.md`), `---\nteam: core\n---\n# Guide ${i}\n\n${PAD} ${s} token ${i}\n`);
  }
  return dir;
}
const dbOf = (dir: string) => join(dir, ".pi/dashboard/kb/index.db");

type Tool = { execute: (id: string, p: Record<string, unknown>, s: undefined, u: undefined, ctx: { cwd: string }) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }> };
function tools(): { search: Tool; get: Tool; neighbors: Tool } {
  const m = new Map<string, Tool>();
  kbExtension({ registerTool: (t: Tool & { name: string }) => m.set(t.name, t), on: () => {} } as unknown as Parameters<typeof kbExtension>[0]);
  return { search: m.get("kb_search")!, get: m.get("kb_get")!, neighbors: m.get("kb_neighbors")! };
}
const call = (t: Tool, cwd: string, p: Record<string, unknown>) => t.execute("i", p, undefined, undefined, { cwd });

/** A live foreign first-index marker: a long-lived child's pid + a fresh tmp file. */
async function foreignBuilder(dir: string): Promise<void> {
  const k = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"]);
  kids.push(k);
  while (!k.pid) await new Promise((r) => setTimeout(r, 2));
  writeFileSync(`${dbOf(dir)}.tmp-${k.pid}`, "x");
}

const rows = (p: string, sql: string) => {
  const s = new SqliteFtsStore(p);
  try {
    return s.read((db) => db.prepare(sql).all() as Array<Record<string, unknown>>);
  } finally {
    s.close();
  }
};

describe("writers produce identical rows (E6)", () => {
  it("E6 CLI path and kb-extension reindexNow agree on chunks and property rows incl. a custom facet", async () => {
    const extra = { frontmatter: { searchableKeys: ["title"], facetKeys: [{ key: "team" }] } };
    const a = project({ extra });
    const b = project({ extra });
    const cfgA = loadConfig(a);
    await runIndexAtomic({ dbPath: cfgA.dbAbsPath, sources: cfgA.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })), indexOpts: indexOptionsFromConfig(cfgA), gate: cfgA });
    const state = createReindexState();
    await reindexNow(state, b);
    closeKb(state);
    const sel = "SELECT path, key, value FROM properties ORDER BY path, key, value";
    const props = rows(dbOf(b), sel);
    expect(props.some((r) => r.key === "team" && r.value === "core")).toBe(true);
    expect(props).toEqual(rows(dbOf(a), sel));
    const chunks = "SELECT path, heading_path, body FROM chunks ORDER BY path, heading_path";
    expect(rows(dbOf(b), chunks).map((r) => r.body)).toEqual(rows(dbOf(a), chunks).map((r) => r.body));
  });
});

describe("pull tools back off during another process's first index (D2)", () => {
  it("E30/E31 each tool returns the building line only (json: line + []), creates no file, runs no walk", async () => {
    const dir = project();
    await foreignBuilder(dir);
    const t = tools();
    expect((await call(t.search, dir, { query: "token" })).content[0].text).toBe(BUILDING);
    expect((await call(t.search, dir, { query: "token", format: "json" })).content[0].text.split("\n")).toEqual([BUILDING, "[]"]);
    expect((await call(t.get, dir, { path: "f0.md" })).content[0].text).toBe(BUILDING);
    expect((await call(t.neighbors, dir, { node: "f0.md" })).content[0].text).toBe(BUILDING);
    expect(existsSync(dbOf(dir))).toBe(false);
    expect(indexSource).not.toHaveBeenCalled();
    expect(runIndexAtomic).not.toHaveBeenCalled();
  });

  it("E32 a git-scope call neither triggers the docs reindex nor reports a building line", async () => {
    const dir = project();
    await foreignBuilder(dir);
    const r = await call(tools().search, dir, { query: "anything", scope: "git" });
    expect(r.content[0].text).not.toContain("still being built");
    expect(runIndexAtomic).not.toHaveBeenCalled();
    expect(existsSync(dbOf(dir))).toBe(false);
  });

  it("E33 the marker only counts while dbPath is absent (holder case: populated db + live tmp)", async () => {
    const dir = project();
    const cfg = loadConfig(dir);
    await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })) });
    await foreignBuilder(dir);
    const r = await call(tools().search, dir, { query: "token" });
    expect(r.content[0].text).not.toContain("still being built");
    expect(r.details.hits).toBeGreaterThan(0);
  });

  it("E34 a dead marker does not block: the cold-start populate builds through the first-index path", async () => {
    const dir = project();
    writeFileSync(`${dbOf(dir)}.tmp-99999`, "stale");
    const r = await call(tools().get, dir, { path: "f0.md" });
    expect(r.content[0].text).toContain("docs token 0");
    expect(runIndexAtomic).toHaveBeenCalledTimes(1);
    expect(existsSync(dbOf(dir))).toBe(true);
    expect(existsSync(`${dbOf(dir)}.tmp-99999`)).toBe(false);
  });

  it("F5 a pull tool's own first index is joined, not duplicated", async () => {
    const dir = project();
    const t = tools();
    const [s, g] = await Promise.all([call(t.search, dir, { query: "token" }), call(t.get, dir, { path: "f0.md" })]);
    expect(runIndexAtomic).toHaveBeenCalledTimes(1);
    expect(s.content[0].text).not.toContain("still being built");
    expect(g.content[0].text).not.toContain("still being built");
  });

  it("a debounced reindex skips silently while another process builds", async () => {
    const dir = project();
    await foreignBuilder(dir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createReindexState();
    await expect(reindexNow(state, dir)).resolves.toEqual({ changed: 0, chunks: 0 });
    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(dbOf(dir))).toBe(false);
    expect(state.completed.has(dir)).toBe(false);
    warn.mockRestore();
  });
});

describe("cold populate is atomic (X6)", () => {
  it("X6 a session killed mid-cold-populate leaves no dbPath, only a swept-on-next-run orphan", async () => {
    const dir = project({ files: 1500 });
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./helpers/populate-child.mts", import.meta.url)), dir], { env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"].filter(Boolean).join(" ") } });
    kids.push(child);
    const t0 = Date.now();
    const walSize = () => readdirSync(join(dir, ".pi/dashboard/kb")).filter((f) => /\.tmp-\d+-wal$/.test(f)).map((f) => statSync(join(dir, ".pi/dashboard/kb", f)).size).reduce((a, b) => Math.max(a, b), 0);
    while (walSize() === 0) {
      if (Date.now() - t0 > 30_000) throw new Error("child never started committing");
      await new Promise((r) => setTimeout(r, 2));
    }
    child.kill("SIGKILL");
    await new Promise((r) => child.on("close", r));
    expect(existsSync(dbOf(dir))).toBe(false);
    expect(readdirSync(join(dir, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f))).toBe(true);
    const cfg = loadConfig(dir);
    await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })) });
    expect(existsSync(dbOf(dir))).toBe(true);
    expect(readdirSync(join(dir, ".pi/dashboard/kb")).filter((f) => f.includes(".tmp-"))).toEqual([]);
  }, 90_000);
});

describe("per-source gate + isolation in reindexNow (D6)", () => {
  it("E3 a warm db with no source records is force-reindexed and stamped per source", async () => {
    const dir = project();
    const cfg = loadConfig(dir);
    await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })) }); // no gate stamps
    const state = createReindexState();
    const r = await reindexNow(state, dir);
    expect(r.chunks).toBeGreaterThan(0);
    closeKb(state);
    const rec = rows(dbOf(dir), "SELECT v FROM kb_meta WHERE k='gate:docs'");
    expect(rec[0]?.v).toBe(`3:${indexOptionsHash(cfg)}`);
  });

  it("X10 one failing source does not stop the others; its record stays unwritten so the next pass forces it", async () => {
    const dir = project({ sources: ["a", "b"] });
    const cfg = loadConfig(dir);
    await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })) });
    const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-kb")>("@blackbelt-technology/pi-dashboard-kb");
    vi.mocked(indexSource).mockImplementation(async (store, src, o) => {
      if (src.root === "a") throw new Error("walk of a exploded");
      return actual.indexSource(store, src, o);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createReindexState();
    await expect(reindexNow(state, dir)).rejects.toThrow(/exploded/);
    closeKb(state);
    expect(rows(dbOf(dir), "SELECT k FROM kb_meta WHERE k LIKE 'gate:%' ORDER BY k").map((r) => r.k)).toEqual(["gate:b"]);
    vi.mocked(indexSource).mockImplementation((...a) => actual.indexSource(...a));
    const st2 = createReindexState();
    await reindexNow(st2, dir);
    closeKb(st2);
    expect(rows(dbOf(dir), "SELECT k FROM kb_meta WHERE k LIKE 'gate:%' ORDER BY k").map((r) => r.k)).toEqual(["gate:a", "gate:b"]);
    warn.mockRestore();
  });
});
