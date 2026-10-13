// Single sync owner per repository (change: add-kb-git-forge-scope, test-plan #X8–#X11).
// X8/X9 fork real node processes sharing one index; X10 uses two connections + a fake clock.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitLease, LeaseLostError } from "../git-scope/lease.js";
import { GIT_ROOT } from "../git-scope/store.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { FakeForge, fakeClock, fakeItem, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const WORKER = join(import.meta.dirname, "helpers", "lease-worker.ts");

function runWorker(role: "sync" | "hang", cwd: string, log: string, leaseSeconds: number) {
  const child = spawn(process.execPath, ["--import", "tsx", WORKER, role, cwd, fx.baseDir, log, String(leaseSeconds)], { env: { ...process.env, HOME: fx.home }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const line = () => new Promise<{ pid: number; ms: number; text: string }>((resolve, reject) => {
    const t = setInterval(() => {
      const l = out.split("\n").find((x) => x.startsWith("{"));
      if (l) (clearInterval(t), resolve(JSON.parse(l)));
    }, 25);
    child.on("exit", (code) => code !== 0 && !out.includes("{") && (clearInterval(t), reject(new Error(`worker exited ${code}: ${err}`))));
  });
  const exited = new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
  return { child, line, exited };
}
const syncLog = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

describe("lease", () => {
  it("X8: two processes searching at once trigger exactly one forge sync; the loser is not blocked", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const log = join(fx.tmp, "sync.log");
    const a = runWorker("sync", dir, log, 60);
    const b = runWorker("sync", dir, log, 60);
    const [ra, rb] = await Promise.all([a.line(), b.line()]);
    await Promise.all([a.exited, b.exited]);
    expect(syncLog(log)).toHaveLength(1);
    expect(Math.max(ra.ms, rb.ms)).toBeLessThan(2500); // nobody waited out the 1 s sync + start-up
    // the owner indexed the (single) commit inside its budget; the loser never blocked and says why it has nothing yet
    const [owner, loser] = ra.text.includes("initial commit") ? [ra, rb] : [rb, ra];
    expect(owner.text).toContain("initial commit");
    expect(loser.text.includes("initial commit") || /elsewhere/.test(loser.text)).toBe(true);
  }, 60_000);

  it("X9: a SIGKILLed owner's lease expires and a later search takes over", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const log = join(fx.tmp, "sync.log");
    const hung = runWorker("hang", dir, log, 2);
    await hung.line(); // the owner holds the lease and is stuck inside a forge request
    hung.child.kill("SIGKILL");
    await hung.exited;
    const forge = new FakeForge();
    forge.items = [fakeItem("pr", 1, "item one")];
    const scope = scopeFor(fx, { adapterFor: () => forge, gitConfig: { forge: { leaseSeconds: 2 } } });
    const early = await scope.search({ query: "item" }, { cwd: dir });
    expect(forge.requests).toHaveLength(0); // lease still live: not stolen early
    expect(early.text).toMatch(/forge (syncing elsewhere|not synced yet)/);
    await new Promise((r) => setTimeout(r, 2600));
    const late = await scope.search({ query: "item" }, { cwd: dir });
    expect(forge.requests).toHaveLength(1);
    expect(late.text).toContain("item one");
  }, 60_000);

  it("X10: a deposed owner cannot write, extend or release", () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    void dir;
    const clock = fakeClock();
    // two connections to ONE database file, standing in for two processes
    const path = join(fx.tmp, "shared.db");
    const mk = () => {
      const s = new SqliteFtsStore(path);
      s.init();
      s.immediate((db) => db.exec("CREATE TABLE IF NOT EXISTS git_lease (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT, nonce TEXT, expires_at INTEGER); INSERT OR IGNORE INTO git_lease VALUES (1,'','',0)"));
      return s;
    };
    const sa = mk();
    const sb = mk();
    const A = new GitLease(sa, { owner: "A", leaseMs: 1000, now: clock.now });
    const B = new GitLease(sb, { owner: "B", leaseMs: 1000, now: clock.now });
    expect(A.tryAcquire()).toBe(true);
    expect(B.tryAcquire()).toBe(false); // live lease: try, never blocks
    clock.advance(1500); // A pauses past its expiry
    expect(B.tryAcquire()).toBe(true);
    const row = () => sb.read((db) => db.prepare("SELECT owner, nonce, expires_at FROM git_lease").get());
    const bRow = row();

    const chunk = { root: GIT_ROOT, path: "pr/1", chunkId: "pr/1#0", headingPath: "pr #1 [open] · d · @a > t", heading: "t", level: 0, parentChunkId: null, docType: "doc" as const, body: "deposed write", bodyHash: "h" };
    expect(() => A.fenced(() => sa.replaceItem(GIT_ROOT, "pr/1", [chunk], []))).toThrow(LeaseLostError);
    expect(A.extend()).toBe(false);
    A.release(); // fenced: must not free B's lease
    expect(row()).toEqual(bRow);
    expect(sb.read((db) => db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE path='pr/1'").get())).toMatchObject({ n: 0 });
    expect(B.extend()).toBe(true);
    sa.close();
    sb.close();
  });
});

describe("hints", () => {
  it("X11: a hint recorded during a running sync earns exactly one extra round, bypassing the interval", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const forge = new FakeForge();
    forge.delayMs = 150;
    forge.items = [fakeItem("pr", 1, "item one")];
    const scope = scopeFor(fx, { adapterFor: () => forge, gitConfig: { forge: { minSyncIntervalSeconds: 600, hintedMinSyncIntervalSeconds: 60 } } });
    forge.onPage = (n) => {
      if (n === 1) {
        forge.items.push(fakeItem("pr", 2, "item two (created by the hinted command)"));
        scope.hint(dir);
      }
    };
    await scope.search({ query: "item" }, { cwd: dir });
    await scope.idle();
    expect(forge.requests).toHaveLength(2); // round 1 + exactly one extra round
    const r = await scope.search({ query: "hinted" }, { cwd: dir });
    expect(r.text).toContain("item two");
    expect(forge.requests).toHaveLength(2); // and nothing more inside the 600 s interval
    void [readdirSync];
  }, 30_000);
});
