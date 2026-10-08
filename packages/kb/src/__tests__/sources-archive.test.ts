import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, httpsResolver, type ResolveCtx, recoverBackups } from "../sources.js";
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
  const noLeftovers = () => expect(readdirSync(cacheDir).filter((x) => x.includes("stage-") || x.includes(".old-"))).toEqual([]);

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

  describe("bounded extraction (CodeRabbit: decompression bombs / inode exhaustion)", () => {
    const limits = (l: { maxEntries?: number; maxExpandedBytes?: number }) => ({ testHooks: { archiveLimits: l } });
    const big = (n: number) => Buffer.alloc(n, 0);

    it("rejects a tar.gz that EXPANDS beyond the byte limit while the download itself is tiny", async () => {
      const bomb = tarGz([{ name: "zeros.bin", data: big(5 * 1024 * 1024) }]);
      expect(bomb.length).toBeLessThan(64 * 1024); // 5 MB of zeros compresses to a few KB
      await expect(resolveBody("a.tar.gz", bomb, limits({ maxExpandedBytes: 1024 * 1024 }))).rejects.toThrow(/expands beyond/);
      expect(readdirSync(cacheDir)).toEqual([]); // nothing extracted, no dest, no stage
    });

    it("zip: rejects past the byte limit", async () => {
      await expect(resolveBody("a.zip", zip([{ name: "a.bin", data: big(2 * 1024 * 1024) }]), limits({ maxExpandedBytes: 1024 * 1024 }))).rejects.toThrow(/expands beyond/);
      expect(readdirSync(cacheDir)).toEqual([]);
    });

    it("boundary: exactly the byte limit passes, one byte over rejects (tar + zip)", async () => {
      const lim = limits({ maxExpandedBytes: 1000 });
      expect(files((await resolveBody("a.tar.gz", tarGz([{ name: "f.md", data: big(1000) }]), lim)).r.dir)).toContain("f.md");
      expect(files((await resolveBody("a.zip", zip([{ name: "f.md", data: big(1000) }]), lim)).r.dir)).toContain("f.md");
      await expect(resolveBody("b.tar.gz", tarGz([{ name: "f.md", data: big(1001) }]), lim)).rejects.toThrow(/expands beyond/);
      await expect(resolveBody("b.zip", zip([{ name: "f.md", data: big(1001) }]), lim)).rejects.toThrow(/expands beyond/);
    });

    it("rejects too many entries before extracting (tar + zip); the limit itself passes", async () => {
      const many = (n: number): Entry[] => Array.from({ length: n }, (_, i) => ({ name: `f${i}.md`, data: "x" }));
      await expect(resolveBody("a.tar.gz", tarGz(many(11)), limits({ maxEntries: 10 }))).rejects.toThrow(/too many entries/);
      await expect(resolveBody("a.zip", zip(many(11)), limits({ maxEntries: 10 }))).rejects.toThrow(/too many entries/);
      expect(readdirSync(cacheDir)).toEqual([]);
      expect(files((await resolveBody("c.tar.gz", tarGz(many(10)), limits({ maxEntries: 10 }))).r.dir).filter((f) => f.endsWith(".md")).length).toBe(10);
    });

    it("defaults are generous for real documentation archives", async () => {
      const { r } = await resolveBody("docs.tar.gz", tarGz([{ name: "a.md", data: "# a" }, { name: "b.md", data: "# b" }]));
      expect(files(r.dir)).toContain("a.md");
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

    it("X4a dest absent + a backup present → restored (no refetch when fresh)", async () => {
      const spec = specOf("a.zip");
      const dest = join(cacheDir, cacheKey(spec));
      const bk = `${dest}.old-${Date.now() - 5 * 60_000}-crashed`; // past the grace window → abandoned, not in-flight
      seed(bk, "OLD");
      const fetch = vi.fn(async () => zip([{ name: "n.md", data: "x" }]));
      recordTrust(spec);
      const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch } });
      expect(readFileSync(join(r.dir, "orig.md"), "utf8")).toBe("OLD");
      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(bk)).toBe(false);
    });

    it("X4b dest + aged (>1h) backup → debris pruned, young backup kept, swap succeeds", async () => {
      const spec = specOf("a.zip");
      const dest = join(cacheDir, cacheKey(spec));
      seed(dest, "CUR");
      const aged = `${dest}.old-${Date.now() - 2 * 3_600_000}-debris`;
      const young = `${dest}.old-${Date.now()}-inflight`;
      seed(aged, "STALE");
      seed(young, "INFLIGHT");
      const { r } = await resolveSpec(spec, zip([{ name: "n.md", data: "x" }]), {}, true);
      expect(files(r.dir)).toEqual([".fetched", "n.md"]);
      expect(existsSync(aged)).toBe(false);
      expect(existsSync(young)).toBe(true);
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
      noLeftovers();
    });
  });
});

d("lock-free swap under concurrent refreshes (review B1: last-writer-wins, never lose the cache)", () => {
  const trust = join(tmpdir(), `kb-trust-conc-${Date.now()}.json`);
  const saved = process.env.KB_SOURCE_TRUST_PATH;
  beforeAll(() => { process.env.KB_SOURCE_TRUST_PATH = trust; });
  afterAll(() => {
    if (saved === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = saved;
    rmSync(trust, { force: true });
  });
  const specOf = (n: string) => ({ kind: "https" as const, ref: `https://example.test/conc-${n}/a.zip` });
  const mk = () => mkdtempSync(join(tmpdir(), "kb-conc-"));
  const seed = (dir: string, files: Record<string, string>) => {
    mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
  };
  const backups = (cacheDir: string) => readdirSync(cacheDir).filter((n) => n.includes(".old-"));

  it("another writer lands between our backup and our swap: dest keeps THEIR complete content; ours errors; nothing is lost", async () => {
    const cacheDir = mk();
    const spec = specOf("interleave");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    seed(dest, { "orig.md": "ORIGINAL", ".fetched": "1" });
    const other = join(cacheDir, "other-writer-out");
    seed(other, { "theirs.md": "THEIRS", ".fetched": "2" });
    let calls = 0;
    // After OUR rename #1 (dest → backup), the other writer completes its own swap (rename #2 is ours).
    const rename = (a: string, b: string) => {
      calls++;
      renameSync(a, b);
      if (calls === 1) renameSync(other, dest);
    };
    await expect(
      httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: async () => zip([{ name: "ours.md", data: "OURS" }]), rename } }),
    ).rejects.toThrow();
    expect(readdirSync(dest).sort()).toEqual([".fetched", "theirs.md"]); // one writer's complete content
    expect(readFileSync(join(dest, "theirs.md"), "utf8")).toBe("THEIRS");
    // the previous cache is still recoverable from our own backup (not deleted by anyone)
    const [bk] = backups(cacheDir);
    expect(readFileSync(join(cacheDir, bk, "orig.md"), "utf8")).toBe("ORIGINAL");
    expect(readdirSync(cacheDir).filter((n) => n.includes("stage-"))).toEqual([]);
  });

  it("a writer never deletes another writer's backup (unique names)", async () => {
    const cacheDir = mk();
    const spec = specOf("unique");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    seed(dest, { "orig.md": "ORIGINAL", ".fetched": "1" });
    const foreign = `${dest}.old-${Date.now()}-someone-elses`; // a concurrent writer's in-flight rollback copy
    seed(foreign, { "theirs-old.md": "X" });
    await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: async () => zip([{ name: "n.md", data: "x" }]) } });
    expect(existsSync(join(foreign, "theirs-old.md"))).toBe(true);
    expect(backups(cacheDir)).toEqual([foreign.split("/").pop()]); // only the foreign one remains; ours was removed
  });

  it("recovery: dest absent → restores the NEWEST backup past the grace window; prunes only backups older than 1h", async () => {
    const cacheDir = mk();
    const spec = specOf("recover");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    const now = Date.now();
    seed(`${dest}.old-${now - 5 * 60_000}-newest`, { "orig.md": "NEWEST", ".fetched": "1" });
    seed(`${dest}.old-${now - 6 * 60_000}-older`, { "x.md": "OLDER" });
    seed(`${dest}.old-${now - 2 * 3_600_000}-debris`, { "y.md": "DEBRIS" });
    const fetch = vi.fn(async () => zip([{ name: "n.md", data: "x" }]));
    const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch } });
    expect(readFileSync(join(r.dir, "orig.md"), "utf8")).toBe("NEWEST");
    expect(fetch).not.toHaveBeenCalled(); // marker is fresh → no refetch
    expect(backups(cacheDir)).toEqual([`${basename(dest)}.old-${now - 6 * 60_000}-older`]); // <1h kept, debris pruned, newest consumed
  });

  it("recovery never takes a YOUNG backup (a live writer's in-flight rollback copy), even with dest absent", async () => {
    const cacheDir = mk();
    const spec = specOf("grace");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    const young = `${dest}.old-${Date.now() - 1000}-inflight`;
    seed(young, { "orig.md": "IN-FLIGHT" });
    await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, testHooks: { fetch: async () => zip([{ name: "n.md", data: "x" }]) } });
    expect(existsSync(join(young, "orig.md"))).toBe(true); // untouched
    expect(existsSync(join(dest, "orig.md"))).toBe(false); // not restored over a fresh fetch
    expect(existsSync(join(dest, "n.md"))).toBe(true);
  });

  it("recovery entering the window between a writer's two renames does not break that writer", async () => {
    const cacheDir = mk();
    const spec = specOf("window");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    seed(dest, { "orig.md": "ORIGINAL", ".fetched": "1" });
    let calls = 0;
    // Writer A has renamed dest → its backup; ANOTHER process starts and runs recovery right now.
    const rename = (a: string, b: string) => {
      calls++;
      renameSync(a, b);
      if (calls === 1) {
        for (const t = Date.now(); Date.now() - t < 5; ); // the backup is now measurably "older than 0"
        recoverBackups(dest);
        expect(existsSync(dest)).toBe(false); // the in-flight backup was NOT "recovered"
      }
    };
    const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: async () => zip([{ name: "ours.md", data: "OURS" }]), rename } });
    expect(readFileSync(join(r.dir, "ours.md"), "utf8")).toBe("OURS"); // A's swap succeeded
    expect(readdirSync(cacheDir)).toEqual([cacheKey(spec)]); // A removed its own backup
  });

  it("recovery restores NOTHING while ANY young backup exists, even if an older abandoned one is also present", async () => {
    const cacheDir = mk();
    const spec = specOf("mixed-age");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    const now = Date.now();
    seed(`${dest}.old-${now - 1000}-live`, { "live.md": "LIVE" }); // a live writer's rollback copy
    seed(`${dest}.old-${now - 5 * 60_000}-abandoned`, { "orig.md": "ABANDONED", ".fetched": "1" });
    recoverBackups(dest);
    expect(existsSync(dest)).toBe(false); // nothing restored while a potentially live swap exists
    expect(backups(cacheDir).length).toBe(2); // and nothing pruned (both < 1h)
  });

  it("window interleave with an older backup present: the live writer's publish still succeeds", async () => {
    const cacheDir = mk();
    const spec = specOf("window-mixed");
    recordTrust(spec);
    const dest = join(cacheDir, cacheKey(spec));
    seed(dest, { "orig.md": "ORIGINAL", ".fetched": "1" });
    seed(`${dest}.old-${Date.now() - 5 * 60_000}-abandoned`, { "x.md": "OLD" });
    let calls = 0;
    const rename = (a: string, b: string) => {
      calls++;
      renameSync(a, b);
      if (calls === 1) {
        recoverBackups(dest); // another process enters recovery inside A's window
        expect(existsSync(dest)).toBe(false);
      }
    };
    const r = await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: async () => zip([{ name: "ours.md", data: "OURS" }]), rename } });
    expect(readFileSync(join(r.dir, "ours.md"), "utf8")).toBe("OURS");
  });

  it("sequential refreshes leave no backups or stage dirs behind", async () => {
    const cacheDir = mk();
    const spec = specOf("seq");
    recordTrust(spec);
    for (let i = 0; i < 3; i++) {
      await httpsResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: true, testHooks: { fetch: async () => zip([{ name: "n.md", data: String(i) }]) } });
    }
    expect(readdirSync(cacheDir)).toEqual([cacheKey(spec)]);
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
