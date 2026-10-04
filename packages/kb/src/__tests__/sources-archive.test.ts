import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, httpsResolver, type ResolveCtx } from "../sources.js";
import { recordTrust } from "../trust.js";
import { type Entry, tar, tarGz, zip } from "./helpers/archive-fixtures.js";

// Archive listing/extraction shells out to host tar/unzip (bsdtar on macOS, GNU
// tar on Linux CI); Windows runners have no Info-ZIP.
const d = describe.skipIf(process.platform === "win32");

d("https resolver: guarded fetch + archive extraction", () => {
  let cacheDir: string;
  let trustFile: string;
  const savedTrust = process.env.KB_SOURCE_TRUST_PATH;
  beforeAll(() => {
    trustFile = join(tmpdir(), `kb-trust-arch-${Date.now()}.json`);
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterAll(() => {
    if (savedTrust === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = savedTrust;
    rmSync(trustFile, { force: true });
  });
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "kb-arch-"));
  });

  let n = 0;
  /** Resolve `file` served as `body`; returns resolver result + spec. */
  async function resolveBody(file: string, body: Buffer | (() => Promise<Buffer>), extra: Partial<ResolveCtx> = {}, refresh = false) {
    const spec = { kind: "https" as const, ref: `https://example.test/${++n}/${file}` };
    return resolveSpec(spec, body, extra, refresh);
  }
  async function resolveSpec(spec: { kind: "https"; ref: string }, body: Buffer | (() => Promise<Buffer>), extra: Partial<ResolveCtx> = {}, refresh = false) {
    recordTrust(spec);
    const fetch = typeof body === "function" ? body : async () => body;
    const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh, ...extra, testHooks: { fetch, ...extra.testHooks } });
    return { r, spec };
  }
  const files = (dir: string) => readdirSync(dir).sort();
  const noLeftovers = () => expect(readdirSync(cacheDir).filter((x) => x.includes("stage-") || x.endsWith(".old"))).toEqual([]);

  it("E22 literal metadata URL: rejects with zero connect attempts", async () => {
    const spy = vi.spyOn(https, "request");
    const spec = { kind: "https" as const, ref: "https://169.254.169.254/latest/meta-data/" };
    recordTrust(spec);
    await expect(httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir })).rejects.toThrow(/non-public/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("E23 non-https refs are refused without fetching", async () => {
    const fetch = vi.fn(async () => Buffer.from("x"));
    for (const ref of ["http://example.com/a.md", "ssh://h/r"]) {
      const spec = { kind: "https" as const, ref };
      recordTrust(spec);
      await expect(httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch } })).rejects.toThrow(/only https/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("E31 plain-file name", async () => {
    for (const [path, name] of [["/docs/x.md", "x.md"], ["/", "index.md"], ["/docs/", "index.md"]] as const) {
      const spec = { kind: "https" as const, ref: `https://example.test${path}?n=${++n}` }; // ?n= keeps cache keys distinct
      const { r } = await resolveSpec(spec, Buffer.from("# hi"));
      expect(files(r.dir)).toEqual([".fetched", name]);
    }
  });

  it("E27 a failed fetch (cap/404) writes no file", async () => {
    const spec = { kind: "https" as const, ref: "https://example.test/cap/x.md" };
    recordTrust(spec);
    await expect(
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch: async () => { throw new Error("response exceeds 1024 bytes"); } } }),
    ).rejects.toThrow(/exceeds/);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  describe("rejects unsafe archives and extracts nothing", () => {
    const unsafe: [string, string, Buffer][] = [
      ["E50 tar ..", "a.tar.gz", tarGz([{ name: "../../evil", data: "x" }])],
      ["E52 tar symlink", "a.tar.gz", tarGz([{ name: "l", type: "symlink", target: "/etc" }])],
      ["E53 tar hardlink", "a.tar.gz", tarGz([{ name: "a.md", data: "x" }, { name: "h", type: "hardlink", target: "a.md" }])],
      ["E54 zip ..", "a.zip", zip([{ name: "../evil.md", data: "x" }])],
      ["E55 zip symlink", "a.zip", zip([{ name: "l", type: "symlink", target: "/etc" }])],
      ["E58 tar tab", "a.tar.gz", tarGz([{ name: "tab\tname.md", data: "x" }])],
      ["E58 tar newline", "a.tar.gz", tarGz([{ name: "nl\nname.md", data: "x" }])],
      ["E58 zip tab", "a.zip", zip([{ name: "tab\tname.md", data: "x" }])],
    ];
    for (const [label, file, buf] of unsafe) {
      it(label, async () => {
        await expect(resolveBody(file, buf)).rejects.toThrow(/unsafe archive entry|extracted|cannot validate/);
        expect(readdirSync(cacheDir)).toEqual([]); // no dest, no stage
      });
    }

    it("E51 tar absolute entry — nothing written at the absolute path", async () => {
      const abs = join(tmpdir(), `kb-abs-${Date.now()}`, "evil");
      await expect(resolveBody("a.tar.gz", tarGz([{ name: abs, data: "x" }]))).rejects.toThrow(/absolute/);
      expect(existsSync(abs)).toBe(false);
    });
  });

  it("E56 tricky but legal names extract as regular files (tar + zip)", async () => {
    const es: Entry[] = [{ name: "a -> b.md", data: "1" }, { name: "with space.md", data: "2" }];
    for (const [file, buf] of [["a.tar.gz", tarGz(es)], ["a.zip", zip(es)]] as const) {
      const { r } = await resolveBody(file, buf);
      expect(files(r.dir)).toEqual([".fetched", "a -> b.md", "with space.md"]);
    }
  });

  it("E57 non-ASCII names extract (tar + zip)", async () => {
    const es: Entry[] = [{ name: "café.md", data: "1" }, { name: "文.md", data: "2" }];
    const t = await resolveBody("a.tar.gz", tarGz(es));
    expect(files(t.r.dir).filter((f) => f.endsWith(".md")).length).toBe(2);
    const z = await resolveBody("a.zip", zip(es));
    expect(files(z.r.dir).filter((f) => f.endsWith(".md")).length).toBe(2);
  });

  it("E59 empty zip succeeds with an empty source dir + .fetched", async () => {
    const { r } = await resolveBody("a.zip", zip([]));
    expect(files(r.dir)).toEqual([".fetched"]);
  });

  it("E60 .tar.bz2 extracts", async () => {
    const src = mkdtempSync(join(tmpdir(), "kb-bz-"));
    writeFileSync(join(src, "doc.md"), "# bz\n");
    const archive = join(src, "a.tar.bz2");
    execFileSync("tar", ["-cjf", archive, "-C", src, "doc.md"]);
    const { r } = await resolveBody("a.tar.bz2", readFileSync(archive));
    expect(readFileSync(join(r.dir, "doc.md"), "utf8")).toBe("# bz\n");
    rmSync(src, { recursive: true, force: true });
  });

  it("E61/X3 corrupt archive rejects and keeps the prior good dest byte-identical", async () => {
    const good = tarGz([{ name: "keep.md", data: "KEEP" }]);
    const first = await resolveBody("a.tar.gz", good);
    const marker = readFileSync(join(first.r.dir, ".fetched"), "utf8");
    const spec = first.spec;
    const bad = good.subarray(0, good.length - 20);
    await expect(resolveSpec(spec, bad, {}, true)).rejects.toThrow();
    expect(readFileSync(join(first.r.dir, "keep.md"), "utf8")).toBe("KEEP");
    expect(readFileSync(join(first.r.dir, ".fetched"), "utf8")).toBe(marker);
    noLeftovers();
  });

  it("X3 refresh failures (HTTP error / zip-slip) keep dest + marker", async () => {
    const first = await resolveBody("a.zip", zip([{ name: "keep.md", data: "KEEP" }]));
    const marker = readFileSync(join(first.r.dir, ".fetched"), "utf8");
    await expect(resolveSpec(first.spec, async () => { throw new Error("HTTP 500"); }, {}, true)).rejects.toThrow(/HTTP 500/);
    await expect(resolveSpec(first.spec, zip([{ name: "../evil.md", data: "x" }]), {}, true)).rejects.toThrow(/unsafe/);
    expect(files(first.r.dir)).toEqual([".fetched", "keep.md"]);
    expect(readFileSync(join(first.r.dir, ".fetched"), "utf8")).toBe(marker);
    noLeftovers();
  });

  it("E62 marker moves with the content; no stage/old left", async () => {
    const { r } = await resolveBody("a.zip", zip([{ name: "a.md", data: "x" }]));
    expect(existsSync(join(r.dir, ".fetched"))).toBe(true);
    noLeftovers();
  });

  describe("crash recovery + swap rollback", () => {
    const seed = (dest: string, content: string) => {
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, "orig.md"), content);
      writeFileSync(join(dest, ".fetched"), "1");
    };
    const specOf = (file: string) => ({ kind: "https" as const, ref: `https://example.test/${++n}/${file}` });

    it("X4a dest absent + dest.old present → renamed back (no refetch when fresh)", async () => {
      const spec = specOf("a.zip");
      const dest = join(cacheDir, cacheKey(spec));
      seed(`${dest}.old`, "OLD");
      const fetch = vi.fn(async () => zip([{ name: "n.md", data: "x" }]));
      recordTrust(spec);
      const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch } });
      expect(readFileSync(join(r.dir, "orig.md"), "utf8")).toBe("OLD");
      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(`${dest}.old`)).toBe(false);
    });

    it("X4b dest + stale dest.old → old removed, swap succeeds", async () => {
      const spec = specOf("a.zip");
      const dest = join(cacheDir, cacheKey(spec));
      seed(dest, "CUR");
      seed(`${dest}.old`, "STALE");
      const { r } = await resolveSpec(spec, zip([{ name: "n.md", data: "x" }]), {}, true);
      expect(files(r.dir)).toEqual([".fetched", "n.md"]);
      expect(existsSync(`${dest}.old`)).toBe(false);
    });

    it("X5 swap failure restores dest from dest.old", async () => {
      const spec = specOf("a.zip");
      const dest = join(cacheDir, cacheKey(spec));
      seed(dest, "ORIGINAL");
      let calls = 0;
      const rename = (a: string, b: string) => {
        if (++calls === 2) throw new Error("injected rename failure"); // stage/out → dest
        renameSync(a, b);
      };
      await expect(resolveSpec(spec, zip([{ name: "n.md", data: "x" }]), { testHooks: { rename } }, true)).rejects.toThrow(/injected/);
      expect(readFileSync(join(dest, "orig.md"), "utf8")).toBe("ORIGINAL");
      expect(existsSync(`${dest}.old`)).toBe(false);
      noLeftovers();
    });
  });
});

d("per-cache-key lock (review B1: concurrent refreshes)", () => {
  const trust = join(tmpdir(), `kb-trust-lock-${Date.now()}.json`);
  const saved = process.env.KB_SOURCE_TRUST_PATH;
  beforeAll(() => { process.env.KB_SOURCE_TRUST_PATH = trust; });
  afterAll(() => {
    if (saved === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = saved;
    rmSync(trust, { force: true });
  });

  const specOf = (n: string) => ({ kind: "https" as const, ref: `https://example.test/lock-${n}/a.zip` });
  const mk = () => mkdtempSync(join(tmpdir(), "kb-lock-"));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("two concurrent refreshes of one source never run their fetch+swap critical sections at once", async () => {
    const cacheDir = mk();
    const spec = specOf("serial");
    recordTrust(spec);
    let inflight = 0;
    let maxInflight = 0;
    const fetch = async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await sleep(60);
      inflight--;
      return zip([{ name: "n.md", data: "x" }]);
    };
    const ctx = { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch } };
    await Promise.all([httpsResolver.resolve(spec, ctx), httpsResolver.resolve(spec, ctx)]);
    expect(maxInflight).toBe(1);
    expect(readdirSync(cacheDir).sort()).toEqual([cacheKey(spec)]); // lock dir + stage + .old all gone
  });

  it("a failing swap in one refresh leaves the cache intact for the concurrent refresh, which then lands", async () => {
    const cacheDir = mk();
    const spec = specOf("failswap");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "orig.md"), "ORIGINAL");
    writeFileSync(join(dest, ".fetched"), "1");
    let calls = 0;
    const failing = (a: string, b: string) => {
      if (++calls === 2) throw new Error("injected rename failure");
      renameSync(a, b);
    };
    const slowFetch = async () => { await sleep(30); return zip([{ name: "n.md", data: "NEW" }]); };
    const [a, b] = await Promise.allSettled([
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: slowFetch, rename: failing } }),
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: slowFetch } }),
    ]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("fulfilled");
    expect(readFileSync(join(dest, "n.md"), "utf8")).toBe("NEW");
    expect(readdirSync(cacheDir).sort()).toEqual([cacheKey(spec)]);
  });

  it("waits for a lock held by another process and proceeds once it is released", async () => {
    const cacheDir = mk();
    const spec = specOf("held");
    recordTrust(spec);
    const lock = join(cacheDir, `${cacheKey(spec)}.lock`);
    mkdirSync(lock, { recursive: true }); // as if another `kb` process holds it
    let fetched = false;
    const p = httpsResolver.resolve(spec, {
      cwd: cacheDir, cacheDir,
      testHooks: { fetch: async () => { fetched = true; return zip([{ name: "n.md", data: "x" }]); }, lockPollMs: 10 },
    });
    await sleep(80);
    expect(fetched).toBe(false);
    rmSync(lock, { recursive: true });
    await p;
    expect(fetched).toBe(true);
  });

  it("steals a stale lock (dead holder) instead of hanging", async () => {
    const cacheDir = mk();
    const spec = specOf("stale");
    recordTrust(spec);
    mkdirSync(join(cacheDir, `${cacheKey(spec)}.lock`), { recursive: true });
    await sleep(30);
    const r = await httpsResolver.resolve(spec, {
      cwd: cacheDir, cacheDir,
      testHooks: { fetch: async () => zip([{ name: "n.md", data: "x" }]), lockStaleMs: 10, lockPollMs: 5 },
    });
    expect(existsSync(join(r.dir, "n.md"))).toBe(true);
  });

  // ---- review r2 B1: ownership-safe stale recovery ----
  const writeOwner = (lock: string, pid: number, token: string) => writeFileSync(join(lock, "owner"), JSON.stringify({ pid, token }));
  const age = (path: string, ms: number) => utimesSync(path, new Date(Date.now() - ms), new Date(Date.now() - ms));
  /** A pid that is guaranteed dead: a child that already exited. */
  async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((r) => child.on("exit", r));
    return child.pid as number;
  }

  it("never steals a lock whose holder is alive, however old; gives up with an actionable error", async () => {
    const cacheDir = mk();
    const spec = specOf("live-old");
    recordTrust(spec);
    const lock = join(cacheDir, `${cacheKey(spec)}.lock`);
    mkdirSync(lock, { recursive: true });
    writeOwner(lock, process.pid, "live-holder"); // this very process is the live holder
    age(lock, 60_000);
    const fetch = vi.fn(async () => zip([{ name: "n.md", data: "x" }]));
    await expect(
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch, lockStaleMs: 10, lockPollMs: 5, lockWaitMs: 120 } }),
    ).rejects.toThrow(new RegExp(`held by pid ${process.pid}`));
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(lock, "owner"), "utf8")).token).toBe("live-holder"); // untouched
  });

  it("steals immediately from a dead holder, even a young lock", async () => {
    const cacheDir = mk();
    const spec = specOf("dead-young");
    recordTrust(spec);
    const lock = join(cacheDir, `${cacheKey(spec)}.lock`);
    mkdirSync(lock, { recursive: true });
    writeOwner(lock, await deadPid(), "dead-holder");
    const r = await httpsResolver.resolve(spec, {
      cwd: cacheDir, cacheDir,
      testHooks: { fetch: async () => zip([{ name: "n.md", data: "x" }]), lockPollMs: 5 },
    });
    expect(existsSync(join(r.dir, "n.md"))).toBe(true);
  });

  it("release only removes a lock this holder still owns", async () => {
    const cacheDir = mk();
    const spec = specOf("owner-release");
    recordTrust(spec);
    const lock = join(cacheDir, `${cacheKey(spec)}.lock`);
    // While A is inside its critical section, its lock is replaced by another holder's.
    const fetch = async () => {
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
      writeOwner(lock, process.pid, "successor");
      return zip([{ name: "n.md", data: "x" }]);
    };
    await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch } });
    expect(JSON.parse(readFileSync(join(lock, "owner"), "utf8")).token).toBe("successor");
  });

  it("many concurrent waiters on a dead holder's lock: exactly one steals, critical sections never overlap", async () => {
    const cacheDir = mk();
    const spec = specOf("many-stealers");
    recordTrust(spec);
    const lock = join(cacheDir, `${cacheKey(spec)}.lock`);
    mkdirSync(lock, { recursive: true });
    writeOwner(lock, await deadPid(), "dead-holder");
    let inflight = 0;
    let maxInflight = 0;
    const fetch = async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await sleep(30);
      inflight--;
      return zip([{ name: "n.md", data: "x" }]);
    };
    const ctx = { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch, lockPollMs: 5 } };
    await Promise.all(Array.from({ length: 6 }, () => httpsResolver.resolve(spec, ctx)));
    expect(maxInflight).toBe(1);
    expect(readdirSync(cacheDir).sort()).toEqual([cacheKey(spec)]);
  });

  it("releases the lock when the critical section throws", async () => {
    const cacheDir = mk();
    const spec = specOf("release");
    recordTrust(spec);
    await expect(
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch: async () => { throw new Error("HTTP 500"); } } }),
    ).rejects.toThrow(/HTTP 500/);
    expect(readdirSync(cacheDir)).toEqual([]);
  });
});

// Keep tar() referenced for the bsdtar/GNU rendering pin below.
d("listing renderings pinned on the host tar/unzip", () => {
  it("hardlink + symlink are never regular entries on this host", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-pin-"));
    writeFileSync(join(dir, "t.tar"), tar([{ name: "h", type: "hardlink", target: "a" }, { name: "l", type: "symlink", target: "/etc" }]));
    const out = execFileSync("tar", ["-tvf", join(dir, "t.tar")], { encoding: "latin1", env: { ...process.env, LC_ALL: "C" } }).split("\n");
    expect(out[0][0]).not.toBe("-"); // bsdtar/GNU: 'h'
    expect(out[1][0]).toBe("l");
    rmSync(dir, { recursive: true, force: true });
  });
});
