// @vitest-environment node
/**
 * The REAL reindex worker (`reindex-worker.mjs`) through the real loader, driven by the real runner.
 * Folded from openspec/changes/throttle-kb-reindex/test-plan.md: #S47 #S53 #S54 #S55 #S56 #S57 #S58 #S59 #S64.
 * Exemplars: packages/kb-extension/src/__tests__/query-worker-loader.test.ts (real worker, layouts),
 * packages/kb/src/__tests__/index-atomicity.test.ts (temp assertions).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { indexOptionsHash, indexSource, loadConfig, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { afterEach, describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { reindexAll } from "../kb-routes.js";
import type { ReindexCoreInput } from "../reindex-core.js";
import { createReindexRunner, type ReindexWorkerLike } from "../reindex-runner.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SERVER_SRC = join(HERE, "..");
const WORKER_URL = pathToFileURL(join(SERVER_SRC, "reindex-worker.mjs"));
const CRASH_WORKER = pathToFileURL(join(HERE, "helpers", "crash-first-index-worker.mjs"));
const HUNG_WORKER = pathToFileURL(join(HERE, "helpers", "hung-tx-worker.mjs"));
const CHILD = join(HERE, "helpers", "reindex-worker-child.mts");
const NATIVE_TS = join(SERVER_SRC, "../../../shared/src/platform/native-ts-register.mjs");
const KB_PKG = join(SERVER_SRC, "../../../kb");
const SHARED_PKG = join(SERVER_SRC, "../../../shared");

const cleanup: string[] = [];
const kids: ChildProcess[] = [];
afterEach(() => {
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  for (const r of cleanup.splice(0)) rmSync(r, { recursive: true, force: true });
});

const SECTION = "Body text comfortably longer than the hundred character minimum so every section stays its own chunk in the index.";
/** `n` markdown files of 16 `##` sections each (≈ 20 ms of indexing per file — enough to cancel mid-run). */
function writeDocs(cwd: string, ref: string, n: number): void {
  mkdirSync(join(cwd, ref), { recursive: true });
  for (let i = 0; i < n; i++) {
    const sections = Array.from({ length: 16 }, (_, k) => `## ${ref} ${i} section ${k}\n\n${SECTION} ${ref}-${i}-${k}\n`).join("\n");
    writeFileSync(join(cwd, ref, `f${i}.md`), `# ${ref} ${i}\n\n${sections}`);
  }
}
function makeKb(sources: Record<string, number>): string {
  const cwd = mkdtempSync(join(tmpdir(), "kb-rworker-"));
  cleanup.push(cwd);
  for (const [ref, n] of Object.entries(sources)) writeDocs(cwd, ref, n);
  mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: Object.keys(sources).map((ref) => ({ kind: "filesystem", ref })) }));
  return cwd;
}
const dbOf = (cwd: string) => loadConfig(cwd).dbAbsPath;
const tmpOf = (cwd: string) => `${dbOf(cwd)}.tmp-${process.pid}`;
/** An existing, initialised, empty store — forces the in-place path. */
function seedEmptyDb(cwd: string): void {
  mkdirSync(join(dbOf(cwd), ".."), { recursive: true });
  const s = new SqliteFtsStore(dbOf(cwd));
  s.init();
  s.close();
}
function rows<T = Record<string, unknown>>(dbPath: string, sql: string): T[] {
  const s = new SqliteFtsStore(dbPath);
  try {
    return s.read((db) => db.prepare(sql).all() as T[]);
  } finally {
    s.close();
  }
}
const count = (cwd: string, where = "1=1") => (rows<{ n: number }>(dbOf(cwd), `SELECT count(*) n FROM chunks WHERE ${where}`)[0]?.n ?? 0) as number;
const meta = (cwd: string, key: string) => {
  const s = new SqliteFtsStore(dbOf(cwd));
  try {
    return s.getMeta(key) ?? null;
  } finally {
    s.close();
  }
};
function coreInput(cwd: string, mode: ReindexCoreInput["mode"]): ReindexCoreInput {
  const cfg = loadConfig(cwd);
  return { cwd, dbPath: cfg.dbAbsPath, mode, gate: indexOptionsHash(cfg), sources: cfg.allSourceSpecs.map((s) => ({ ref: s.ref, kind: "filesystem", id: s.ref, dir: join(cwd, s.ref), started: Date.now() })) };
}

/** Real worker thread (the runner's default shape) with terminate/exit observation. */
function spyingFactory(url: URL = WORKER_URL) {
  const seen = { spawned: 0, terminated: 0, exits: [] as number[] };
  const factory = (data: { input: ReindexCoreInput }): ReindexWorkerLike => {
    seen.spawned++;
    const w = new Worker(url, { execArgv: [], workerData: data });
    w.on("exit", (c) => seen.exits.push(c));
    const terminate = w.terminate.bind(w);
    w.terminate = () => {
      seen.terminated++;
      return terminate();
    };
    return w as unknown as ReindexWorkerLike;
  };
  return { seen, factory };
}
const until = async (pred: () => boolean, ms = 10_000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("condition never held");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("S47 graceful cancel (real worker, multi-source in-place pass)", () => {
  it("the worker receives cancel, aborts at the next yield and exits 0; terminate() is never called; the job is idle", async () => {
    const cwd = makeKb({ A: 400, B: 400 });
    seedEmptyDb(cwd);
    const { seen, factory } = spyingFactory();
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const registry = new KbJobRegistry();
    let cancelledAt = 0;
    const job = registry.start(cwd, (ctx) =>
      reindexAll(cwd, undefined, {
        runner,
        signal: ctx.signal,
        onProgress: (p) => {
          ctx.progress(p);
          if (!cancelledAt) {
            cancelledAt = Date.now();
            registry.cancel(cwd);
          }
        },
      }),
    ).promise.catch((e: Error) => e);
    const err = await job;
    expect((err as Error).name).toBe("AbortError");
    await until(() => seen.exits.length === 1);
    expect(seen.exits).toEqual([0]);
    expect(seen.terminated).toBe(0);
    expect(registry.statusFor(cwd)).toBe("idle");
    expect(registry.get(cwd)).toBeUndefined();
    expect(runner.liveCount()).toBe(0);
    expect(count(cwd)).toBeLessThan(800 * 16); // stopped well before the end
  }, 60_000);
});

describe("S53 config race", () => {
  it("a worker whose loadConfig yields another gate fails 'config changed during reindex' and indexes/stamps nothing", async () => {
    const cwd = makeKb({ A: 5 });
    seedEmptyDb(cwd);
    const input = coreInput(cwd, "in-place"); // gate G1 from the config as main resolved it
    writeFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "A" }], frontmatter: { searchableKeys: ["title"], facetKeys: [{ key: "team" }] } })); // → G2
    expect(indexOptionsHash(loadConfig(cwd))).not.toBe(input.gate);
    const runner = createReindexRunner({ useWorker: () => true });
    await expect(runner.run(input)).rejects.toThrow(/config changed during reindex/);
    expect(count(cwd)).toBe(0);
    expect(meta(cwd, "gate:A")).toBeNull();
    expect(meta(cwd, "facetConfigHash")).toBeNull();
  }, 30_000);
});

describe("first-index temp file hygiene (S54, S55, S56)", () => {
  it("S54 terminate mid-build removes <db>.tmp-<pid> and its -wal/-shm right after the job settles; no live db", async () => {
    const cwd = makeKb({ A: 800 });
    const runner = createReindexRunner({ useWorker: () => true });
    let sawTemp = false;
    const err = await reindexAll(cwd, undefined, {
      runner,
      onProgress: () => {
        sawTemp ||= existsSync(tmpOf(cwd)); // mid-build: the temp has pages
        void runner.shutdown(); // terminate() with no server restart
      },
    }).catch((e: Error) => e);
    expect(sawTemp).toBe(true);
    expect((err as Error).name).toBe("AbortError");
    for (const f of [tmpOf(cwd), `${tmpOf(cwd)}-wal`, `${tmpOf(cwd)}-shm`]) expect(existsSync(f)).toBe(false);
    expect(existsSync(dbOf(cwd))).toBe(false);
  }, 60_000);

  it("S55 a worker that crashes mid-build leaves no temp, and the next first run builds from scratch (row count == a fresh build)", async () => {
    const cwd = makeKb({ A: 8 });
    const crashing = createReindexRunner({ workerUrl: CRASH_WORKER, useWorker: () => true });
    await expect(reindexAll(cwd, undefined, { runner: crashing })).rejects.toThrow(/crash|simulated/i);
    for (const f of [tmpOf(cwd), `${tmpOf(cwd)}-wal`, `${tmpOf(cwd)}-shm`]) expect(existsSync(f)).toBe(false);
    expect(existsSync(dbOf(cwd))).toBe(false);

    const real = createReindexRunner({ useWorker: () => true });
    const r = await reindexAll(cwd, undefined, { runner: real });
    const fresh = makeKb({ A: 8 });
    const f = await reindexAll(fresh, undefined, { runner: createReindexRunner({ useWorker: () => false }) });
    expect(r.chunks).toBeGreaterThan(0);
    expect(r.chunks).toBe(f.chunks);
    expect(count(cwd)).toBe(count(fresh));
  }, 60_000);

  it("S56 graceful cancel of a first index closes+unlinks the temp itself: no live db, no temp, job idle, no terminate", async () => {
    const cwd = makeKb({ A: 800 });
    const { seen, factory } = spyingFactory();
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const registry = new KbJobRegistry();
    let sawTemp = false;
    await registry.start(cwd, (ctx) =>
      reindexAll(cwd, undefined, {
        runner,
        signal: ctx.signal,
        onProgress: () => {
          sawTemp ||= existsSync(tmpOf(cwd));
          registry.cancel(cwd);
        },
      }),
    ).promise.catch(() => undefined);
    expect(sawTemp).toBe(true);
    await until(() => seen.exits.length === 1);
    expect(seen.terminated).toBe(0);
    for (const f of [tmpOf(cwd), `${tmpOf(cwd)}-wal`, `${tmpOf(cwd)}-shm`, dbOf(cwd)]) expect(existsSync(f)).toBe(false);
    expect(registry.statusFor(cwd)).toBe("idle");
  }, 60_000);
});

describe("S57 multi-source cancel (in-place)", () => {
  it("keeps B's committed batches and A's stamp; C untouched, no pass stamp, no error; a re-run converges to the uninterrupted rows", async () => {
    const cwd = makeKb({ A: 3, B: 800, C: 3 });
    seedEmptyDb(cwd);
    const registry = new KbJobRegistry();
    const runner = createReindexRunner({ useWorker: () => true });
    await registry.start(cwd, (ctx) =>
      reindexAll(cwd, undefined, {
        runner,
        signal: ctx.signal,
        onProgress: (p) => {
          ctx.progress(p);
          if (p.root === "B") registry.cancel(cwd);
        },
      }),
    ).promise.catch(() => undefined);
    expect(registry.statusFor(cwd)).toBe("idle");
    expect(registry.get(cwd)).toBeUndefined(); // no lastError, no error outcome recorded
    expect(count(cwd, "root='A'")).toBeGreaterThan(0);
    expect(meta(cwd, "gate:A")).not.toBeNull(); // completed + stamped before the cancel keeps its stamp
    expect(count(cwd, "root='B'")).toBeGreaterThan(0); // committed batches stay
    expect(count(cwd, "root='B'")).toBeLessThan(800 * 16);
    expect(meta(cwd, "gate:B")).toBeNull();
    expect(count(cwd, "root='C'")).toBe(0); // untouched
    expect(meta(cwd, "gate:C")).toBeNull();
    expect(meta(cwd, "facetConfigHash")).toBeNull(); // no stampPass

    const again = await reindexAll(cwd, undefined, { runner });
    expect(again.outcomes?.every((o) => o.status === "ok")).toBe(true);
    const ref = makeKb({ A: 3, B: 800, C: 3 });
    await reindexAll(ref, undefined, { runner: createReindexRunner({ useWorker: () => false }) });
    const sel = "SELECT root, path, heading_path, body FROM chunks ORDER BY root, path, heading_path";
    expect(rows(dbOf(cwd), sel)).toEqual(rows(dbOf(ref), sel));
    expect(meta(cwd, "gate:C")).not.toBeNull();
  }, 120_000);
});

describe("S58 terminate mid-transaction", () => {
  it("a hung worker inside an open write transaction is terminated after the grace; the db is intact and a re-run completes", async () => {
    const cwd = makeKb({ A: 6 });
    // committed batches: a normal in-place index on the main thread (this test's own setup)
    const setup = new SqliteFtsStore(dbOf(cwd));
    mkdirSync(join(dbOf(cwd), ".."), { recursive: true });
    setup.init();
    await indexSource(setup, { root: "A", dir: join(cwd, "A") });
    setup.close();
    const committed = count(cwd);
    expect(committed).toBeGreaterThan(0);

    const runner = createReindexRunner({ workerUrl: HUNG_WORKER, useWorker: () => true, graceMs: 200 });
    const ac = new AbortController();
    const job = runner.run(coreInput(cwd, "in-place"), { signal: ac.signal }).catch((e: Error) => e);
    await new Promise((r) => setTimeout(r, 400)); // the worker is inside its open transaction
    ac.abort(); // grace 200 ms elapses → terminate()
    expect(((await job) as Error).name).toBe("AbortError");

    const db = new DatabaseSync(dbOf(cwd));
    try {
      expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='zz_uncommitted'").all()).toEqual([]);
    } finally {
      db.close();
    }
    expect(count(cwd)).toBe(committed);
    const r = await reindexAll(cwd, undefined, { runner: createReindexRunner({ useWorker: () => true }) });
    expect(r.outcomes?.every((o) => o.status === "ok")).toBe(true);
  }, 60_000);
});

describe("S59 second writer (stand-in for a kb-extension session)", () => {
  it("a lock held past busy_timeout ends the job in a locked/busy error while the main loop stays responsive", async () => {
    const cwd = makeKb({ A: 20 });
    seedEmptyDb(cwd);
    const holder = spawn(process.execPath, [
      "-e",
      `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(${JSON.stringify(dbOf(cwd))});d.exec("PRAGMA busy_timeout=0;BEGIN IMMEDIATE");process.stdout.write("locked\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));setTimeout(()=>process.exit(0),40000);`,
    ], { stdio: ["pipe", "pipe", "ignore"] }); // holds the lock until the parent closes stdin (the job has settled); 40 s is only a cleanup safety net
    kids.push(holder);
    await new Promise<void>((res, rej) => {
      holder.stdout?.once("data", () => res());
      holder.once("error", rej);
    });
    const registry = new KbJobRegistry();
    const runner = createReindexRunner({ useWorker: () => true });
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    await registry.start(cwd, (ctx) => reindexAll(cwd, undefined, { runner, signal: ctx.signal })).promise.catch(() => undefined);
    lag.disable();
    holder.stdin?.end(); // release the writer lock only now that the indexing attempt has settled
    expect(registry.statusFor(cwd)).toBe("error");
    expect(registry.get(cwd)?.error).toMatch(/locked|busy/i);
    expect(lag.max / 1e6).toBeLessThanOrEqual(200);
  }, 60_000);
});

describe("S64 loader layouts", () => {
  const stripWarnings = (s: string) => s.split("\n").filter((l) => l && !/ExperimentalWarning|trace-warnings|^\[kb\] /.test(l)).join("\n");
  type Child = { code: number | null; stderr: string; out?: { chunks: number; execArgv: unknown[] } };
  function runChild(args: string[], inputPath: string, runnerPath: string): Promise<Child> {
    return new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [...args, CHILD, runnerPath, inputPath], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
      let stdout = "";
      let stderr = "";
      c.stdout.on("data", (d) => (stdout += d));
      c.stderr.on("data", (d) => (stderr += d));
      const cap = setTimeout(() => c.kill("SIGKILL"), 40_000);
      c.on("error", reject);
      c.on("close", (code) => {
        clearTimeout(cap);
        const line = stdout.split("\n").find((l) => l.startsWith("{"));
        resolve({ code, stderr, out: line ? JSON.parse(line) : undefined });
      });
    });
  }
  const inputFile = (cwd: string): string => {
    const p = join(cwd, "input.json");
    writeFileSync(p, JSON.stringify(coreInput(cwd, "first")));
    return p;
  };
  const RUNNER = join(SERVER_SRC, "reindex-runner.ts");

  it("(a) dev checkout under tsx: rows readable by the main handle, worker execArgv [], silent stderr, exits on its own", async () => {
    const cwd = makeKb({ docs: 20 });
    const r = await runChild(["--import", "tsx"], inputFile(cwd), RUNNER);
    expect(stripWarnings(r.stderr)).toBe("");
    expect(r.code).toBe(0);
    expect(r.out?.execArgv).toEqual([[]]);
    expect(count(cwd)).toBe(r.out?.chunks);
    expect(count(cwd)).toBeGreaterThan(0);
  }, 60_000);

  it("(b) under the dashboard's native TS loader: no hook stacking", async () => {
    const cwd = makeKb({ docs: 20 });
    const r = await runChild(["--import", pathToFileURL(NATIVE_TS).href], inputFile(cwd), RUNNER);
    expect(stripWarnings(r.stderr)).toBe("");
    expect(r.code).toBe(0);
    expect(r.out?.execArgv).toEqual([[]]);
    expect(count(cwd)).toBe(r.out?.chunks);
    expect(count(cwd)).toBeGreaterThan(0);
  }, 60_000);

  it("(c) published layout (kb-plugin, kb and shared under node_modules)", async () => {
    const cwd = makeKb({ docs: 20 });
    const input = inputFile(cwd);
    const scope = join(cwd, "published", "node_modules", "@blackbelt-technology");
    const plugin = join(scope, "pi-dashboard-kb-plugin", "src", "server");
    mkdirSync(plugin, { recursive: true });
    for (const f of ["reindex-runner.ts", "reindex-core.ts", "reindex-worker.mjs"]) cpSync(join(SERVER_SRC, f), join(plugin, f));
    mkdirSync(join(scope, "pi-dashboard-kb-plugin", "src", "shared"), { recursive: true });
    cpSync(join(SERVER_SRC, "../shared/kb-plugin-types.ts"), join(scope, "pi-dashboard-kb-plugin", "src", "shared", "kb-plugin-types.ts"));
    cpSync(join(KB_PKG, "package.json"), join(scope, "pi-dashboard-kb", "package.json"));
    cpSync(join(KB_PKG, "engine-fingerprint.json"), join(scope, "pi-dashboard-kb", "engine-fingerprint.json"));
    cpSync(join(KB_PKG, "src"), join(scope, "pi-dashboard-kb", "src"), { recursive: true, filter: (p) => !p.includes("__tests__") });
    mkdirSync(join(scope, "pi-dashboard-shared", "src"), { recursive: true });
    cpSync(join(SHARED_PKG, "package.json"), join(scope, "pi-dashboard-shared", "package.json"));
    cpSync(join(SHARED_PKG, "src", "platform"), join(scope, "pi-dashboard-shared", "src", "platform"), { recursive: true, filter: (p) => !p.includes("__tests__") });
    const register = join(scope, "pi-dashboard-shared", "src", "platform", "native-ts-register.mjs");
    const r = await runChild(["--import", pathToFileURL(register).href], input, join(plugin, "reindex-runner.ts"));
    expect(r.stderr).not.toMatch(/Error|ERR_|WARN/);
    expect(r.code).toBe(0);
    expect(r.out?.execArgv).toEqual([[]]);
    expect(count(cwd)).toBe(r.out?.chunks);
    expect(count(cwd)).toBeGreaterThan(0);
  }, 60_000);
});
