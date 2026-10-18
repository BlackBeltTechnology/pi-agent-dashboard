// No-clobber install, live-build marker, heartbeat, and CLI-level concurrency.
// See change: fix-kb-index-integrity (test-plan E22-E28, F6, X1-X7).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type InstallDeps, installIndex, isFirstIndexLive, makeHeartbeat, runIndexAtomic, sweepOrphanTemps } from "../index-run.js";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";

let root: string;
let dbPath: string;
const kids: ChildProcess[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-inst-"));
  dbPath = join(root, ".pi/dashboard/kb/index.db");
  mkdirSync(join(root, ".pi/dashboard/kb"), { recursive: true });
});
afterEach(() => {
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
});

const PAD = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index here.";
function fixture(n: number, headings = 3): void {
  const d = join(root, "docs");
  for (let i = 0; i < n; i++) {
    const abs = join(d, `g${i % 10}/f${i}.md`);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, `# Doc ${i}\n\n${PAD}\n\n${Array.from({ length: headings }, (_, h) => `## S${h}\n\n${PAD} ${i}.${h}\n`).join("\n")}`);
  }
  mkdirSync(join(root, ".pi/dashboard"), { recursive: true });
  writeFileSync(join(root, ".pi/dashboard/knowledge_base.json"), JSON.stringify({ sources: [{ ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }));
}
const kbDir = fileURLToPath(new URL("..", import.meta.url));
const env = () => ({ ...process.env, HOME: root, USERPROFILE: root, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"].filter(Boolean).join(" ") });
const cliArgs = (...a: string[]) => ["--import", "tsx", join(kbDir, "cli.ts"), ...a, "--cwd", root];
function spawnCli(...a: string[]): { proc: ChildProcess; out: () => { stdout: string; stderr: string }; done: Promise<number | null> } {
  const proc = spawn(process.execPath, cliArgs(...a), { cwd: kbDir, env: env() });
  kids.push(proc);
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (d) => (stdout += d));
  proc.stderr?.on("data", (d) => (stderr += d));
  return { proc, out: () => ({ stdout, stderr }), done: new Promise((r) => proc.on("close", (c) => r(c))) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await sleep(5);
  }
}
const tmpOf = (pid: number) => `${dbPath}.tmp-${pid}`;
function countsOf(p: string): { files: number; chunks: number; uv: number } {
  const s = new SqliteFtsStore(p);
  try {
    const c = s.counts();
    return { files: c.files, chunks: c.chunks, uv: s.getUserVersion() };
  } finally {
    s.close();
  }
}
/** A "holder": another connection that created dbPath and stays open. */
function holder(rows = 10): SqliteFtsStore {
  const h = new SqliteFtsStore(dbPath);
  h.init();
  h.begin();
  for (let i = 0; i < rows; i++) h.insertChunk({ root: "holder", path: `h${i}.md`, chunkId: `h${i}`, headingPath: "H", heading: "H", level: 1, parentChunkId: null, docType: "doc", body: `holder row ${i}`, bodyHash: `h${i}` });
  h.commit();
  return h;
}

describe("live-build marker + orphan sweep (D2)", () => {
  const stamp = (path: string, ageMs: number) => {
    const t = new Date(Date.now() - ageMs);
    utimesSync(path, t, t);
  };
  const touch = (path: string, ageMs: number) => {
    writeFileSync(path, "x");
    stamp(path, ageMs);
  };
  const live = process.ppid; // a live PID that is not ours

  it("E22 marker predicate", () => {
    expect(isFirstIndexLive(dbPath)).toBe(false); // no tmp
    touch(tmpOf(99999), 1000);
    expect(isFirstIndexLive(dbPath)).toBe(false); // dead pid
    rmSync(tmpOf(99999));
    touch(tmpOf(live), 10_000);
    expect(isFirstIndexLive(dbPath)).toBe(true); // live, fresh
    stamp(tmpOf(live), 121_000);
    expect(isFirstIndexLive(dbPath)).toBe(false); // stale
    stamp(tmpOf(live), -60_000);
    expect(isFirstIndexLive(dbPath)).toBe(false); // future mtime (clock skew)
    stamp(tmpOf(live), 300_000);
    touch(`${tmpOf(live)}-wal`, 5000);
    expect(isFirstIndexLive(dbPath)).toBe(true); // stale tmp but fresh -wal
    rmSync(tmpOf(live));
    rmSync(`${tmpOf(live)}-wal`);
    touch(tmpOf(process.pid), 1000);
    expect(isFirstIndexLive(dbPath)).toBe(false); // own pid is ignored
  });

  it("E23 orphan sweep: dead removed, live-fresh kept, live-abandoned (>1h) removed", () => {
    touch(tmpOf(99999), 1000);
    sweepOrphanTemps(dbPath);
    expect(existsSync(tmpOf(99999))).toBe(false);
    touch(tmpOf(live), 10 * 60_000);
    sweepOrphanTemps(dbPath);
    expect(existsSync(tmpOf(live))).toBe(true);
    stamp(tmpOf(live), 61 * 60_000);
    sweepOrphanTemps(dbPath);
    expect(existsSync(tmpOf(live))).toBe(false);
  });

  it("E24 a slow build keeps its marker live: the walk heartbeat refreshes the temp mtime on a clock", async () => {
    fixture(10, 1);
    const tmp = tmpOf(live);
    writeFileSync(tmp, "x");
    let clock = Date.now();
    const calls: number[] = [];
    const hb = makeHeartbeat(tmp, {
      now: () => clock,
      intervalMs: 30_000,
      utimes: (p, _a, m) => {
        calls.push(m.getTime());
        utimesSync(p, m, m);
      },
    });
    const store = new SqliteFtsStore(":memory:");
    store.init();
    await indexSource(store, { root: "docs", dir: join(root, "docs") }, { heartbeat: () => { clock += 15_000; hb(); } }); // 10 files x 15 s = 150 s
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(statSync(tmp).mtimeMs).toBeGreaterThan(Date.now() + 100_000);
    store.close();
  });
});

describe("installIndex (D1) — injected seams", () => {
  function builtTmp(): string {
    const t = `${dbPath}.tmp-${process.pid}`;
    const s = new SqliteFtsStore(t);
    s.init();
    s.checkpointAndClose();
    return t;
  }
  const mkDeps = (o: Partial<InstallDeps> = {}) => {
    const lines: string[] = [];
    let clock = 0;
    const sleeps: number[] = [];
    const deps: Partial<InstallDeps> = { log: (l) => lines.push(l), now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, ...o };
    return { deps, lines, sleeps };
  };
  const rejectWith = (errcode: number) => async () => {
    throw Object.assign(new Error("injected"), { code: "ERR_SQLITE_ERROR", errcode });
  };

  it("E25 backup retried on errcode 0/5/6 only", async () => {
    for (const [code, retried] of [[0, true], [5, true], [6, true], [26, false], [10, false]] as const) {
      writeFileSync(dbPath, ""); // dbPath exists → backup branch
      let attempts = 0;
      const { deps, lines } = mkDeps({ backup: async () => { attempts++; if (attempts === 1) return rejectWith(code)(); return 1; }, maxWaitMs: 30_000 });
      const tmp = builtTmp();
      const r = installIndex(tmp, dbPath, deps);
      if (retried) {
        expect((await r).retries).toBe(1);
      } else {
        await expect(r).rejects.toThrow(/could not install/);
        expect(lines.join("\n")).toMatch(new RegExp(`install-failed=backup-error:${code} retries=0`));
        expect(existsSync(tmp)).toBe(false);
      }
      rmSync(dbPath, { force: true });
      rmSync(tmp, { force: true });
    }
  });

  it("E26 busy schedule 100,200,400,800,1600,2000… and gives up before passing 30 s", async () => {
    writeFileSync(dbPath, "");
    const { deps, lines, sleeps } = mkDeps({ backup: rejectWith(5), maxWaitMs: 30_000 });
    const tmp = builtTmp();
    await expect(installIndex(tmp, dbPath, deps)).rejects.toThrow(/busy-timeout/);
    expect(sleeps.slice(0, 7)).toEqual([100, 200, 400, 800, 1600, 2000, 2000]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);
    expect(lines.at(-1)).toMatch(/^\[kb\] install-failed=busy-timeout retries=\d+ ms=\d+$/);
  });

  it("E27 branch selection: link / backup on EEXIST / rename when link fails and dbPath absent / backup when it is present", async () => {
    const eexist = () => { throw Object.assign(new Error("exists"), { code: "EEXIST" }); };
    const eperm = () => { throw Object.assign(new Error("perm"), { code: "EPERM" }); };
    const branch = async (link: InstallDeps["linkSync"] | undefined, present: boolean): Promise<string> => {
      rmSync(dbPath, { force: true });
      if (present) writeFileSync(dbPath, "");
      const { deps } = mkDeps({ ...(link ? { linkSync: link } : {}), backup: async () => 1 });
      const tmp = builtTmp();
      const r = await installIndex(tmp, dbPath, deps);
      rmSync(tmp, { force: true });
      return r.branch;
    };
    expect(await branch(undefined, false)).toBe("link");
    expect(await branch(eexist, true)).toBe("backup");
    expect(await branch(eperm, false)).toBe("rename");
    expect(await branch(eperm, true)).toBe("backup");
  });
});

describe("kb index CLI under concurrency (D1)", () => {
  it("E28 a clean first index logs install=link retries=0", async () => {
    fixture(5);
    const c = spawnCli("index");
    expect(await c.done).toBe(0);
    expect(c.out().stderr).toMatch(/^\[kb\] install=link retries=0 ms=\d+$/m);
    expect(countsOf(dbPath).files).toBe(5);
  }, 60_000);

  it("X1 a handle that created dbPath mid-build keeps its (replaced) contents consistent: install=backup", async () => {
    fixture(500);
    const c = spawnCli("index");
    await until(() => readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f)));
    const h = holder();
    expect(await c.done).toBe(0);
    expect(c.out().stderr).toMatch(/install=backup/);
    const rep = c.out().stdout.match(/indexed (\d+) files .*?(\d+) chunks/);
    const fresh = countsOf(dbPath);
    expect(fresh.files).toBe(500);
    expect(fresh.uv).toBe(3);
    expect(String(fresh.chunks)).toBe(rep?.[2]);
    expect(h.counts().files).toBe(500); // the holder's next query sees the installed index
    h.close();
    expect(countsOf(dbPath).files).toBe(500); // and it survives the holder exiting
  }, 90_000);

  it("X2 a write-locked destination is retried until it unlocks", async () => {
    fixture(30, 2); // small: the build ends well inside the 2 s the destination stays locked
    const c = spawnCli("index");
    await until(() => readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f)));
    const h = holder();
    h.read((db) => db.exec("BEGIN IMMEDIATE"));
    await sleep(2000);
    h.read((db) => db.exec("COMMIT"));
    expect(await c.done).toBe(0);
    expect(c.out().stderr).toMatch(/install=backup retries=[1-9]\d* ms=/);
    expect(countsOf(dbPath).files).toBe(30);
    h.close();
  }, 90_000);

  it("X3 the retry bound elapsing fails the run, leaves the holder's database, removes the temp", async () => {
    fixture(100);
    const proc = spawn(process.execPath, cliArgs("index"), { cwd: kbDir, env: { ...env(), KB_INSTALL_MAX_WAIT_MS: "1000" } });
    kids.push(proc);
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d));
    const done = new Promise<number | null>((r) => proc.on("close", r));
    await until(() => readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f)));
    const h = holder();
    h.read((db) => db.exec("BEGIN IMMEDIATE"));
    expect(await done).not.toBe(0);
    expect(stderr).toMatch(/install-failed=busy-timeout/);
    expect(readdirSync(join(root, ".pi/dashboard/kb")).some((f) => f.includes(".tmp-"))).toBe(false);
    h.read((db) => db.exec("COMMIT"));
    expect(h.counts().chunks).toBe(10); // still the holder's own rows
    h.close();
    expect(countsOf(dbPath).chunks).toBe(10);
  }, 90_000);

  it("X4 a non-database destination fails at once, unchanged, no retry", async () => {
    fixture(100);
    const c = spawnCli("index");
    await until(() => readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f)));
    const garbage = Buffer.alloc(4096, 0x41);
    writeFileSync(dbPath, garbage);
    expect(await c.done).not.toBe(0);
    expect(c.out().stderr).toMatch(/install-failed=backup-error:26 retries=0/);
    expect(readFileSync(dbPath).equals(garbage)).toBe(true);
    expect(readdirSync(join(root, ".pi/dashboard/kb")).some((f) => f.includes(".tmp-"))).toBe(false);
  }, 90_000);

  it("X5 a SIGKILL during the install leaves the destination either wholly old or wholly new", async () => {
    fixture(600, 4);
    // old contents: a 50-file index created by a holder
    const small = join(root, "small");
    mkdirSync(small, { recursive: true });
    for (let i = 0; i < 50; i++) writeFileSync(join(small, `s${i}.md`), `# S${i}\n\n${PAD} small ${i}\n`);
    const c = spawnCli("index");
    await until(() => readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+$/.test(f)));
    await runIndexAtomic({ dbPath, sources: [{ id: "small", dir: small }] });
    await until(() => !readdirSync(join(root, ".pi/dashboard/kb")).some((f) => /\.tmp-\d+-wal$/.test(f)) || c.out().stderr.includes("install="));
    c.proc.kill("SIGKILL");
    await c.done;
    const s = new SqliteFtsStore(dbPath);
    expect((s.read((db) => db.prepare("PRAGMA quick_check").get()) as { quick_check: string }).quick_check).toBe("ok");
    expect([50, 600]).toContain(s.counts().files);
    s.close();
  }, 120_000);

  it("F6 two simultaneous first indexes both succeed; one links, the other copies", async () => {
    fixture(300);
    const a = spawnCli("index");
    const b = spawnCli("index");
    expect([await a.done, await b.done]).toEqual([0, 0]);
    const lines = [a.out().stderr, b.out().stderr].join("\n").match(/install=(link|backup)/g)?.sort();
    expect(lines).toEqual(["install=backup", "install=link"]);
    expect(countsOf(dbPath).files).toBe(300);
  }, 120_000);

  it("X7 another command during a live first index prints the building line, exits 75, creates nothing", async () => {
    fixture(20);
    const foreign = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)"]); // a live foreign builder
    kids.push(foreign);
    await until(() => !!foreign.pid);
    writeFileSync(tmpOf(foreign.pid as number), "x");
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, cliArgs("search", "foo"), { cwd: kbDir, env: env(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      status = (e as { status: number }).status;
      stdout = String((e as { stdout: string }).stdout);
    }
    expect(status).toBe(75);
    expect(stdout.trim()).toBe("(index is still being built — no results available yet; retry shortly)");
    expect(existsSync(dbPath)).toBe(false);
  }, 60_000);

  it("a cold `kb search` builds through the first-index path (temp + install), never an in-place husk", async () => {
    fixture(10);
    const c = spawnCli("search", "Doc");
    expect(await c.done).toBe(0);
    expect(c.out().stderr).toMatch(/install=link/);
    expect(countsOf(dbPath).files).toBe(10);
  }, 60_000);
});

describe("DatabaseSync import sanity", () => {
  it("backup is exported by this Node", async () => {
    const sqlite = await import("node:sqlite");
    expect(typeof (sqlite as unknown as { backup: unknown }).backup).toBe("function");
  });
});
