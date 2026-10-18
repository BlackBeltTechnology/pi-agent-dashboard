// @vitest-environment node
//
// Dashboard reindex job: waits for a live first index, builds through the atomic path,
// per-source gate / identical rows. See change: fix-kb-index-integrity
// (test-plan F2, F3, X13, E6). `node` environment: this suite reaches kb's sqlite store.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource, loadConfig, runIndexAtomic, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { mountKbRoutes, reindexAll } from "../kb-routes.js";

const PAD = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index here.";
const cleanup: string[] = [];
const kids: ChildProcess[] = [];
afterEach(() => {
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  for (const r of cleanup.splice(0)) rmSync(r, { recursive: true, force: true });
});

function folder(sources: Array<Record<string, unknown>> = [{ kind: "filesystem", ref: "docs" }], extra: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kb-plug-int-"));
  cleanup.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const n of ["a", "b"]) writeFileSync(join(root, "docs", `${n}.md`), `---\nteam: core\n---\n# ${n}\n\n${PAD} ${n}\n`);
  mkdirSync(join(root, ".pi/dashboard"), { recursive: true });
  writeFileSync(join(root, ".pi/dashboard/knowledge_base.json"), JSON.stringify({ sources, ...extra }));
  return root;
}
const dbOf = (cwd: string) => loadConfig(cwd).dbAbsPath;
const q = (cwd: string) => encodeURIComponent(cwd);
async function foreignBuilder(cwd: string): Promise<ChildProcess> {
  const k = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"]);
  kids.push(k);
  while (!k.pid) await new Promise((r) => setTimeout(r, 2));
  mkdirSync(join(dbOf(cwd), ".."), { recursive: true });
  writeFileSync(`${dbOf(cwd)}.tmp-${k.pid}`, "x");
  return k;
}
const rows = (p: string, sql: string) => {
  const s = new SqliteFtsStore(p);
  try {
    return s.read((db) => db.prepare(sql).all() as Array<Record<string, unknown>>);
  } finally {
    s.close();
  }
};
function buildApp(cwd: string): FastifyInstance {
  const app = Fastify();
  mountKbRoutes(app, { knownCwds: () => [cwd], registry: new KbJobRegistry() });
  return app;
}
type Stats = { indexing: boolean; chunks: number; jobStatus: string };
async function stats(app: FastifyInstance, cwd: string): Promise<Stats> {
  return (await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${q(cwd)}` })).json();
}
async function until(app: FastifyInstance, cwd: string, pred: (s: Stats) => boolean, ms = 20_000): Promise<Stats> {
  const t0 = Date.now();
  for (;;) {
    const s = await stats(app, cwd);
    if (pred(s)) return s;
    if (Date.now() - t0 > ms) throw new Error("stats never settled");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("reindex job and another process's first index (D2)", () => {
  it("F2 the job waits (running, creating nothing) while a live first index builds, then walks the installed db", async () => {
    const cwd = folder();
    await foreignBuilder(cwd);
    const app = buildApp(cwd);
    const res = await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${q(cwd)}` });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("running");
    await new Promise((r) => setTimeout(r, 300));
    const mid = await stats(app, cwd);
    expect(mid).toMatchObject({ indexing: true, jobStatus: "running" });
    expect(existsSync(dbOf(cwd))).toBe(false); // the job created nothing while waiting
    // the builder installs its index and removes its temp
    const k = kids[0];
    await runIndexAtomic({ dbPath: dbOf(cwd), sources: [{ id: "docs", dir: join(cwd, "docs") }] });
    rmSync(`${dbOf(cwd)}.tmp-${k.pid}`, { force: true });
    const done = await until(app, cwd, (s) => !s.indexing && s.jobStatus !== "running", 30_000);
    expect(done.jobStatus).toBe("idle");
    expect(done.chunks).toBeGreaterThan(0);
    await app.close();
  }, 60_000);

  it("F3 an awaited first index that dies: the job builds through the first-index path itself", async () => {
    const cwd = folder();
    const k = await foreignBuilder(cwd);
    const job = reindexAll(cwd, undefined, { pollMs: 20 });
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(dbOf(cwd))).toBe(false);
    k.kill("SIGKILL");
    await new Promise((r) => k.on("close", r));
    const r = await job;
    expect(r.chunks).toBeGreaterThan(0);
    expect(existsSync(dbOf(cwd))).toBe(true);
    expect(r.outcomes?.every((o) => o.status === "ok")).toBe(true);
  }, 30_000);

  it("a cold job with no resolvable on-disk source creates no database", async () => {
    const cwd = folder([{ kind: "filesystem", ref: "nope" }]);
    const r = await reindexAll(cwd);
    expect(r.chunks).toBe(0);
    expect(existsSync(dbOf(cwd))).toBe(false);
  });
});

describe("one derivation, per-source gate (D6)", () => {
  it("X13 an untrusted source's chunks stay and its gate record stays unwritten; the trusted source is re-chunked and recorded", async () => {
    const REMOTE = "https://github.com/example/never";
    const cwd = folder([{ kind: "filesystem", ref: "docs" }, { kind: "git", ref: REMOTE }]);
    const store = new SqliteFtsStore(dbOf(cwd));
    store.init();
    await indexSource(store, { root: REMOTE, dir: join(cwd, "docs") }, { cwd }); // earlier content under the remote's root
    store.close();
    const before = rows(dbOf(cwd), `SELECT count(*) n FROM chunks WHERE root='${REMOTE}'`)[0].n;
    expect(before).toBe(2);
    const r = await reindexAll(cwd);
    expect(r.outcomes?.find((o) => o.ref === REMOTE)?.status).toBe("untrusted");
    expect(rows(dbOf(cwd), `SELECT count(*) n FROM chunks WHERE root='${REMOTE}'`)[0].n).toBe(2);
    const gates = rows(dbOf(cwd), "SELECT k FROM kb_meta WHERE k LIKE 'gate:%'").map((x) => x.k);
    expect(gates).toEqual(["gate:docs"]);
  });

  it("E6 the job and the CLI path write identical chunks and property rows incl. a custom facet", async () => {
    const extra = { frontmatter: { searchableKeys: ["title"], facetKeys: [{ key: "team" }] } };
    const a = folder([{ kind: "filesystem", ref: "docs" }], extra);
    const b = folder([{ kind: "filesystem", ref: "docs" }], extra);
    const cfg = loadConfig(a);
    await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources: [{ id: "docs", dir: join(a, "docs") }], indexOpts: { frontmatter: cfg.frontmatter }, gate: cfg });
    await reindexAll(b);
    const sel = "SELECT path, key, value FROM properties ORDER BY path, key, value";
    expect(rows(dbOf(b), sel).some((r) => r.key === "team" && r.value === "core")).toBe(true);
    expect(rows(dbOf(b), sel)).toEqual(rows(dbOf(a), sel));
    const chunks = "SELECT path, heading_path, body FROM chunks ORDER BY path, heading_path";
    expect(rows(dbOf(b), chunks)).toEqual(rows(dbOf(a), chunks));
  });
});
