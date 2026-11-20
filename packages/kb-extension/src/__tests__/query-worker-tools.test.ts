// Tests for change: bound-kb-proximity-search — kb_search / kb_get docs
// retrieval through the query worker at the tool surface (design D6–D9).
// Folded from openspec/changes/bound-kb-proximity-search/test-plan.md (#W6, #W9,
// #W16, #W18, #W21, #W24, #W26, #W27). Exemplars: kb-search-tool.test.ts
// (:364-388, execute + AbortController), kb-get-tool.test.ts (multi-root
// fixture), packages/kb/src/__tests__/helpers/event-loop-lag.ts.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, SqliteFtsStore, searchOptsFromConfig } from "@blackbelt-technology/pi-dashboard-kb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withEventLoopLag } from "../../../kb/src/__tests__/helpers/event-loop-lag.js";
import kbExtension from "../extension.js";
import { type FetchRequest, runQuery, type SearchRequest } from "../query-worker-entry.js";
import { createQueryWorkerHost, type QueryWorkerHost, type QueryWorkerHostOptions, setQueryWorkerHost } from "../query-worker-host.js";
import { CANCELLED_LINE, closeKbForCwd, createReindexState, getKb, reindexNow } from "../reindex.js";

const spy = vi.hoisted(() => ({ urls: [] as string[], workers: [] as Array<{ exited: boolean; on: (e: string, f: () => void) => void }> }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  class Worker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args);
      spy.urls.push(String(args[0]));
      const rec = Object.assign(this, { exited: false });
      spy.workers.push(rec as never);
      this.on("exit", () => { rec.exited = true; });
    }
  }
  return { ...actual, Worker };
});

type Res = { content: { type: string; text: string }[]; details: Record<string, unknown> };
type Tool = { execute: (id: string, p: Record<string, unknown>, s: AbortSignal | undefined, u: undefined, ctx: { cwd: string }) => Promise<Res> };
type Handler = (event: unknown, ctx?: unknown) => Promise<unknown>;
const FAKE = new URL("./helpers/fake-query-worker.mjs", import.meta.url);
const TIMEOUT_1S = "kb: query timed out after 1s — index may be oversized; try a narrower query";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function load(ext: typeof kbExtension = kbExtension) {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    registerTool: (t: Tool & { name: string }) => tools.set(t.name, t),
    on: (ev: string, h: Handler) => handlers.set(ev, [...(handlers.get(ev) ?? []), h]),
  } as unknown as Parameters<typeof kbExtension>[0];
  ext(pi);
  return { search: tools.get("kb_search")!, get: tools.get("kb_get")!, handlers };
}

const body = (s: string) => `${s} — a body long enough to stay its own chunk after the minimum-size merge pass of the markdown chunker.`;
/** Two-root project (+ colliding AGENTS.md path) with ≥ 20 docs, indexed. */
async function setupProject(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kb-qw-tools-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "dashboard", "knowledge_base.json"),
    JSON.stringify({ sources: [{ ref: "docs" }, { ref: "packages/a" }, { ref: "packages/b" }], dbPath: ".pi/dashboard/kb/index.db" }),
  );
  mkdirSync(join(dir, "docs"), { recursive: true });
  for (let i = 0; i < 22; i++) {
    writeFileSync(join(dir, "docs", `guide-${i}.md`), `# Guide ${i}\n${body(`token rotation guide ${i} explains the refresh flow`)}\n## Details ${i}\n${body(`principal resolution details ${i} for the interceptor`)}\n`);
  }
  for (const p of ["a", "b"]) {
    mkdirSync(join(dir, "packages", p), { recursive: true });
    writeFileSync(join(dir, "packages", p, "AGENTS.md"), `# DOX ${p}\n| File | Purpose |\n|---|---|\n| \`x.ts\` | ${body(`token interceptor module ${p}`)} |\n`);
  }
  const state = createReindexState();
  await reindexNow(state, dir);
  closeKbForCwd(state, dir);
  return dir;
}

const dirs: string[] = [];
const hosts: QueryWorkerHost[] = [];
const useHost = (o: QueryWorkerHostOptions = {}) => {
  const h = createQueryWorkerHost({ useWorker: true, ...o });
  hosts.push(h);
  setQueryWorkerHost(h);
  return h;
};
let fixture: string;
beforeAll(async () => { fixture = await setupProject(); }, 60_000);
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
afterEach(async () => {
  for (const h of hosts.splice(0)) h.shutdown();
  setQueryWorkerHost(null);
  delete process.env.KB_QUERY_TIMEOUT_MS;
  for (let i = 0; i < 100 && spy.workers.some((w) => !w.exited); i++) await sleep(50);
  spy.urls.length = 0;
  spy.workers.length = 0;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("deadline / abort at the tool surface", () => {
  it("W6: KB_QUERY_TIMEOUT_MS expiry → one timeout line (json: + []), timedOut, one warn naming tool/op/db; next call normal", async () => {
    process.env.KB_QUERY_TIMEOUT_MS = "1000";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useHost({ workerUrl: FAKE, workerData: { toolShaped: true, slowMs: 2000, slowCount: 2, shared: new SharedArrayBuffer(8) } });
    const t = load();
    const cond = await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: fixture });
    expect(cond.content[0].text).toBe(TIMEOUT_1S);
    expect(cond.details.timedOut).toBe(true);
    const json = await t.search.execute("i", { query: "token", format: "json" }, undefined, undefined, { cwd: fixture });
    expect(json.content[0].text.split("\n")).toEqual([TIMEOUT_1S, "[]"]);
    const timeoutWarns = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("timed out"));
    expect(timeoutWarns).toHaveLength(2); // one per expiry
    expect(timeoutWarns[0]).toContain("kb_search");
    expect(timeoutWarns[0]).toContain("search");
    expect(timeoutWarns[0]).toContain(join(".pi", "dashboard", "kb", "index.db"));
    // the two abandoned workers finish their 2 s op and exit (dying cap), then a fresh one serves
    const next = await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: fixture });
    expect(next.content[0].text).not.toContain("timed out");
    expect(next.details.timedOut).toBeUndefined();
    expect(next.details.hits).toBe(0); // the fake answers []
  }, 30_000);

  it("W26: abort mid-retrieval → the exact cancelled result on kb_search (condensed + json) and kb_get, ≤ 500 ms", async () => {
    useHost({ workerUrl: FAKE, workerData: { toolShaped: true, slowMs: 5000 } });
    const t = load();
    const calls: Array<[Tool, Record<string, unknown>, string]> = [
      [t.search, { query: "token" }, CANCELLED_LINE],
      [t.search, { query: "token", format: "json" }, `${CANCELLED_LINE}\n[]`],
      [t.get, { path: "guide-1.md" }, CANCELLED_LINE],
    ];
    for (const [tool, params, want] of calls) {
      const ac = new AbortController();
      const p = tool.execute("i", params, ac.signal, undefined, { cwd: fixture });
      await sleep(200);
      const t0 = Date.now();
      ac.abort();
      const r = await p;
      expect(Date.now() - t0).toBeLessThanOrEqual(500);
      expect(r.content[0].text).toBe(want);
      expect(r.details.aborted).toBe(true);
    }
  }, 30_000);

  it("W27: kb_get never blocks the session thread while the worker is busy", async () => {
    useHost({ workerUrl: FAKE, workerData: { toolShaped: true, slowMs: 3000 } });
    const t = load();
    const { result, maxDelayMs } = await withEventLoopLag(() => t.get.execute("i", { path: "guide-1.md" }, undefined, undefined, { cwd: fixture }));
    expect(result.content[0].text).toBe("(fake fetch)");
    expect(maxDelayMs).toBeLessThan(100);
  }, 30_000);
});

describe("parity and lifecycle (real worker)", () => {
  it("W9: every search and fetch returns identical results off-thread and in-process", async () => {
    const h = useHost();
    const cfg = loadConfig(fixture);
    const session = new SqliteFtsStore(cfg.dbAbsPath);
    session.init();
    try {
      const base = searchOptsFromConfig(cfg, { overrides: { expandGraph: false, rerank: false } });
      const searches: SearchRequest[] = [
        { op: "search", dbPath: cfg.dbAbsPath, query: "token rotation", opts: { limit: 10, ...base } },
        { op: "search", dbPath: cfg.dbAbsPath, query: "principal resolution details interceptor token rotation refresh", opts: { limit: 10, ...base } },
        { op: "search", dbPath: cfg.dbAbsPath, query: "token interceptor", opts: { limit: 10, docType: "agents", ...base } },
        { op: "search", dbPath: cfg.dbAbsPath, query: "guide", opts: { limit: 25, ...base } },
        { op: "search", dbPath: cfg.dbAbsPath, query: "flow", opts: { limit: 5, ...base } },
      ];
      const hits = runQuery(session, { ...searches[0], query: "principal resolution details" }) as Array<{ path: string; headingPath: string }>;
      const sectionHit = hits.find((x) => x.headingPath.includes("Details"))!;
      expect(sectionHit).toBeDefined();
      const f = (arg: string, section?: string): FetchRequest => ({
        op: "fetch", dbPath: cfg.dbAbsPath, arg, section, hint: "pass `section`",
        fsSources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })), cwd: fixture,
      });
      const fetches = [f("guide-1.md"), f(sectionHit.path, sectionHit.headingPath), f(sectionHit.path, sectionHit.headingPath.split(" > ").pop()), f("AGENTS.md"), f("nope.md")];
      for (const req of [...searches, ...fetches]) {
        const off = await h.run(req, { inProcess: () => { throw new Error("must run off-thread"); } });
        expect(off.kind).toBe("ok");
        expect((off as { value: unknown }).value).toEqual(runQuery(session, req));
      }
      expect((runQuery(session, fetches[3]) as { text: string }).text).toMatch(/^\(ambiguous: AGENTS.md is indexed in 2 sources/); // ambiguous really is
      expect((runQuery(session, searches[0]) as unknown[]).length).toBeGreaterThan(3);
      for (const i of [0, 1, 2]) expect((runQuery(session, fetches[i]) as { found: boolean }).found).toBe(true);
      expect((runQuery(session, fetches[4]) as { found: boolean }).found).toBe(false);
    } finally {
      session.close();
    }
  }, 60_000);

  it("W16: no index.db → today's empty results, no worker, no warn", async () => {
    useHost();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "kb-qw-nodb-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".pi", "dashboard"), { recursive: true });
    writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }));
    const t = load();
    const s = await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir });
    const g = await t.get.execute("i", { path: "auth.md" }, undefined, undefined, { cwd: dir });
    expect(existsSync(join(dir, ".pi", "dashboard", "kb", "index.db"))).toBe(false);
    expect(s.details.hits).toBe(0);
    expect(g.content[0].text).toBe("(not found: auth.md)");
    expect(spy.urls).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  }, 30_000);

  it("W18: closeKbForCwd posts close before forgetting the entry; sidecars go; the worktree can be removed", async () => {
    const h = useHost();
    const dir = await setupProject();
    dirs.push(dir);
    const state = createReindexState();
    const kb = getKb(state, dir)!;
    const dbPath = kb.cfg.dbAbsPath;
    const r = await h.run({ op: "search", dbPath, query: "token", opts: {} }, { inProcess: () => { throw new Error("off-thread expected"); } });
    expect(r.kind).toBe("ok");
    const closeSpy = vi.spyOn(h, "close");
    const delSpy = vi.spyOn(state.kb, "delete");
    closeKbForCwd(state, dir);
    expect(closeSpy).toHaveBeenCalledWith(dbPath);
    expect(closeSpy.mock.invocationCallOrder[0]).toBeLessThan(delSpy.mock.invocationCallOrder[0]);
    for (let i = 0; i < 40 && (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)); i++) await sleep(50);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(() => rmSync(dir, { recursive: true, force: true })).not.toThrow();
    expect(existsSync(dir)).toBe(false);
    expect(() => h.close("/no/such/index.db")).not.toThrow(); // unknown path: no-op
    expect((await h.run({ op: "search", dbPath, query: "x", opts: {} }, { inProcess: () => [] })).kind).toBe("ok");
  }, 60_000);

  it("W21: session_shutdown terminates the live worker; none restarts until the next call", async () => {
    useHost();
    const t = load();
    expect((await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: fixture })).details.hits).toBeGreaterThan(0);
    expect(spy.workers).toHaveLength(1);
    const exited = new Promise<void>((r) => spy.workers[0].on("exit", () => r()));
    for (const h of t.handlers.get("session_shutdown") ?? []) await h({});
    await exited;
    await sleep(200);
    expect(spy.workers).toHaveLength(1);
    await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: fixture });
    expect(spy.workers).toHaveLength(2);
  }, 30_000);

  it("W24: loaded through jiti like pi does, the worker URL is the file: query-worker.mjs and search is off-thread", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // jiti requires node builtins natively (the vi.mock above does not reach it):
    // observe the real module's Worker export instead.
    const wt = createRequire(import.meta.url)("node:worker_threads") as typeof import("node:worker_threads");
    const Real = wt.Worker;
    const seen: string[] = [];
    (wt as { Worker: unknown }).Worker = class extends Real {
      constructor(url: string | URL, o?: import("node:worker_threads").WorkerOptions) {
        seen.push(String(url));
        super(url, o);
      }
    };
    syncBuiltinESMExports();
    const prevEnv = process.env.KB_QUERY_WORKER;
    process.env.KB_QUERY_WORKER = "1";
    let mod: { default: typeof kbExtension } | undefined;
    try {
      const { createJiti } = await import("jiti");
      mod = (await createJiti(import.meta.url).import(fileURLToPath(new URL("../index.ts", import.meta.url)))) as { default: typeof kbExtension };
      const t = load(mod.default);
      const r = await t.search.execute("i", { query: "token rotation" }, undefined, undefined, { cwd: fixture });
      expect(r.details.hits).toBeGreaterThan(0);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^file:.*query-worker\.mjs$/);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("query worker unavailable"))).toHaveLength(0);
      for (const h of t.handlers.get("session_shutdown") ?? []) await h({});
    } finally {
      (wt as { Worker: unknown }).Worker = Real;
      syncBuiltinESMExports();
      if (prevEnv === undefined) delete process.env.KB_QUERY_WORKER;
      else process.env.KB_QUERY_WORKER = prevEnv;
    }
  }, 60_000);
});
