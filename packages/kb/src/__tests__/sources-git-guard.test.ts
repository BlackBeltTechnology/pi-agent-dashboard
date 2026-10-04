import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAll } from "../net-guard.js";
import { cacheKey, gitResolver } from "../sources.js";
import { recordTrust } from "../trust.js";

/** Fake `git`: records argv; fakes version / remote get-url / rev-parse / clone. */
function fakeGit(opts: { version?: string; origin?: string; onClone?: () => void } = {}) {
  const calls: string[][] = [];
  const git = (args: string[]): string => {
    calls.push(args);
    const sub = args.filter((a) => !a.startsWith("-") && a !== "-c")[0];
    if (args.includes("version")) return `git version ${opts.version ?? "2.50.1"}\n`;
    if (args.includes("get-url")) return `${opts.origin ?? ""}\n`;
    const ci = args.indexOf("clone");
    if (ci >= 0) { opts.onClone?.(); mkdirSync(join(args[args.length - 1], ".git"), { recursive: true }); }
    if (args.includes("rev-parse")) return "abc1234\n";
    void sub;
    return "";
  };
  return { git, calls };
}
const pub = (addr: string, family = 4): LookupAll => (_h, _o, cb) => cb(null, [{ address: addr, family }]);
const network = (calls: string[][]) => calls.filter((c) => c.some((a) => ["clone", "fetch", "pull"].includes(a)));

describe("git resolver guard (D3)", () => {
  let cacheDir: string;
  let trustFile: string;
  const savedTrust = process.env.KB_SOURCE_TRUST_PATH;
  beforeAll(() => {
    trustFile = join(tmpdir(), `kb-trust-git-${Date.now()}.json`);
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterAll(() => {
    if (savedTrust === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = savedTrust;
    rmSync(trustFile, { force: true });
  });
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "kb-git-"));
  });

  async function run(ref: string, hooks: { git: (a: string[]) => string; lookup?: LookupAll }, extra: { refresh?: boolean; pin?: string } = {}) {
    const spec = { kind: "git" as const, ref, ...(extra.pin ? { pin: extra.pin } : {}) };
    recordTrust(spec);
    const r = await gitResolver.resolve(spec, { cwd: cacheDir, cacheDir, refresh: extra.refresh, testHooks: hooks });
    return { r, spec };
  }

  it("E40 file:// transport refused; git never invoked", async () => {
    const { git, calls } = fakeGit();
    await expect(run("git:file:///etc", { git })).rejects.toThrow(/not allowed/);
    expect(calls).toHaveLength(0);
  });

  it("E41 other schemes / transport helpers refused", async () => {
    for (const ref of ["git:http://h/r", "git:git://h/r", "git:ext::sh -c x"]) {
      const { git, calls } = fakeGit();
      await expect(run(ref, { git, lookup: pub("93.184.216.34") }), ref).rejects.toThrow(/not allowed|not valid/);
      expect(network(calls), ref).toHaveLength(0);
    }
  });

  it("E42 private / loopback hosts refused", async () => {
    for (const ref of ["git:https://127.0.0.1/r", "git:https://10.0.0.5/r"]) {
      const { git, calls } = fakeGit();
      await expect(run(ref, { git }), ref).rejects.toThrow(/non-public/);
      expect(calls).toHaveLength(0);
    }
    const { git, calls } = fakeGit();
    await expect(run("git:https://internal.example/r", { git, lookup: pub("10.1.2.3") })).rejects.toThrow(/non-public/);
    expect(calls).toHaveLength(0);
  });

  it("E43 option-like pin/ref refused; git never invoked", async () => {
    const marker = join(tmpdir(), `kb-x-${Date.now()}`);
    const { git, calls } = fakeGit();
    await expect(run("git:github.com/o/r", { git, lookup: pub("93.184.216.34") }, { pin: `--upload-pack=touch ${marker}` })).rejects.toThrow(/option-like/);
    await expect(run("git:github.com/o/r@-x", { git, lookup: pub("93.184.216.34") })).rejects.toThrow(/option-like/);
    expect(calls).toHaveLength(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("E44 clone argv: hardening flags precede `clone`, resolve pin carries port + brackets IPv6", async () => {
    const a = fakeGit();
    await run("git:https://example.com:8443/r", { git: a.git, lookup: pub("93.184.216.34") });
    const clone = network(a.calls)[0];
    const head = clone.slice(0, clone.indexOf("clone")).join(" ");
    expect(head).toBe(
      "-c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always -c http.followRedirects=false " +
        "-c submodule.recurse=false -c fetch.recurseSubmodules=false -c http.curloptResolve=example.com:8443:93.184.216.34",
    );
    const b = fakeGit();
    await run("git:https://example.org/r", { git: b.git, lookup: pub("2606:2800::1", 6) });
    expect(network(b.calls)[0].join(" ")).toContain("http.curloptResolve=example.org:443:[2606:2800::1]");
  });

  it("E45 bare ref clones the https URL", async () => {
    const { git, calls } = fakeGit();
    await run("git:github.com/org/repo", { git, lookup: pub("140.82.112.3") });
    const clone = network(calls)[0];
    expect(clone[clone.length - 2]).toBe("https://github.com/org/repo");
    // sibling of review B1: the per-cache-key lock is released after the resolve
    expect(readdirSync(cacheDir).some((f) => f.endsWith(".lock"))).toBe(false);
  });

  it("ssh targets are checked but not pinned", async () => {
    const { git, calls } = fakeGit();
    await run("git@github.com:org/repo.git", { git, lookup: pub("140.82.112.3") });
    expect(network(calls)[0].join(" ")).not.toContain("curloptResolve");
    const bad = fakeGit();
    await expect(run("git@internal:org/repo.git", { git: bad.git, lookup: pub("10.0.0.1") })).rejects.toThrow(/non-public/);
  });

  describe("existing clone", () => {
    const seedClone = (ref: string) => {
      const dir = join(cacheDir, cacheKey({ kind: "git", ref }));
      mkdirSync(join(dir, ".git"), { recursive: true });
      return dir;
    };

    it("E46 origin mismatch on refresh → fresh guarded clone replaces the old one; nothing fetched from origin", async () => {
      const ref = "git:https://github.com/o/r";
      const dir = seedClone(ref);
      writeFileSync(join(dir, "OLD"), "old clone");
      const { git, calls } = fakeGit({ origin: "https://evil.internal/r" });
      await run(ref, { git, lookup: pub("140.82.112.3") }, { refresh: true });
      expect(existsSync(join(dir, "OLD"))).toBe(false); // old clone replaced
      expect(existsSync(join(dir, ".git"))).toBe(true); // by the fresh one
      const net = network(calls);
      expect(net).toHaveLength(1);
      expect(net[0]).toContain("clone");
      expect(net[0]).toContain("https://github.com/o/r");
      expect(calls.some((c) => c.includes("fetch") || c.includes("pull"))).toBe(false);
      expect(readdirSync(cacheDir).filter((n) => n.includes("stage-") || n.includes(".old-"))).toEqual([]);
    });

    // review r6 B2: the replacement is STAGED and swapped in atomically — the old clone is never
    // absent or half-deleted, so a concurrent resolver always sees one complete clone.
    it("origin mismatch: the old clone stays fully in place while the replacement is cloned, and survives a failed clone", async () => {
      const ref = "git:https://github.com/o/r";
      const dir = seedClone(ref);
      writeFileSync(join(dir, "OLD"), "old clone");
      let sawOld = false;
      const ok = fakeGit({ origin: "https://evil.internal/r", onClone: () => { sawOld = existsSync(join(dir, "OLD")) && existsSync(join(dir, ".git")); } });
      await run(ref, { git: ok.git, lookup: pub("140.82.112.3") }, { refresh: true });
      expect(sawOld).toBe(true);

      // a failing clone leaves the previous clone intact
      const dir2 = seedClone("git:https://github.com/o/r2");
      writeFileSync(join(dir2, "OLD"), "old clone 2");
      const bad = fakeGit({ origin: "https://evil.internal/r2", onClone: () => { throw new Error("clone failed"); } });
      await expect(run("git:https://github.com/o/r2", { git: bad.git, lookup: pub("140.82.112.3") }, { refresh: true })).rejects.toThrow(/clone failed/);
      expect(existsSync(join(dir2, "OLD"))).toBe(true);
      expect(readdirSync(cacheDir).filter((n) => n.includes("stage-"))).toEqual([]);
    });

    it("E48 matching origin: fetch/pull carry --no-recurse-submodules + -c flags before the subcommand", async () => {
      const refPinned = "git:https://github.com/o/r@v1";
      seedClone(refPinned);
      const p = fakeGit({ origin: "https://github.com/o/r@v1" });
      await run(refPinned, { git: p.git, lookup: pub("140.82.112.3") }, { refresh: true });
      const fetch = network(p.calls)[0];
      expect(fetch.indexOf("-c")).toBeLessThan(fetch.indexOf("fetch"));
      expect(fetch).toContain("--no-recurse-submodules");
      expect(fetch.join(" ")).toContain("submodule.recurse=false");
      // review r3 B2: the pinned-ref checkout is hardened too (.gitmodules URLs are attacker-controlled)
      const checkout = p.calls.find((c) => c.includes("checkout"))!;
      expect(checkout.indexOf("-c")).toBeLessThan(checkout.indexOf("checkout"));
      expect(checkout.join(" ")).toContain("submodule.recurse=false");
      expect(checkout).toContain("--no-recurse-submodules");

      const refPlain = "git:https://github.com/o/plain";
      seedClone(refPlain);
      const q = fakeGit({ origin: "https://github.com/o/plain" });
      await run(refPlain, { git: q.git, lookup: pub("140.82.112.3") }, { refresh: true });
      const pull = network(q.calls)[0];
      expect(pull.indexOf("-c")).toBeLessThan(pull.indexOf("pull"));
      expect(pull).toContain("--no-recurse-submodules");
    });
  });

  it("E47 old git: no curloptResolve flag, warning logged once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = fakeGit({ version: "2.30.0" });
    await run("git:https://example.com/r1", { git: a.git, lookup: pub("93.184.216.34") });
    const b = fakeGit({ version: "2.30.0" });
    await run("git:https://example.com/r2", { git: b.git, lookup: pub("93.184.216.34") });
    expect(network(a.calls)[0].join(" ")).not.toContain("curloptResolve");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// Real-git proof (review r3/r4 B2): a fake git only records argv, so it cannot show that
// the pinned-ref checkout stops submodule updates. Local repos, no network.
const gitOk = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe.skipIf(!gitOk)("git resolver: pinned checkout never updates submodules (real git)", () => {
  const savedTrust = process.env.KB_SOURCE_TRUST_PATH;
  const trustFile = join(tmpdir(), `kb-trust-realgit-${Date.now()}.json`);
  beforeAll(() => { process.env.KB_SOURCE_TRUST_PATH = trustFile; });
  afterAll(() => {
    if (savedTrust === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = savedTrust;
    rmSync(trustFile, { force: true });
  });

  it("submodule stays at its pinned commit when recursion is enabled in the user's git config", async () => {
    const root = mkdtempSync(join(tmpdir(), "kb-realgit-"));
    const cfg = join(root, "gitconfig"); // user config: recursion ON, file transport allowed for the local submodule fixture
    writeFileSync(cfg, "[submodule]\n\trecurse = true\n[protocol \"file\"]\n\tallow = always\n[user]\n\tname = t\n\temail = t@t\n");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1" };
    const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

    // submodule repo with two commits S1, S2
    const subrepo = join(root, "subrepo");
    mkdirSync(subrepo);
    g(subrepo, "init", "-q");
    writeFileSync(join(subrepo, "f"), "1");
    g(subrepo, "add", "."); g(subrepo, "commit", "-q", "-m", "s1");
    const S1 = g(subrepo, "rev-parse", "HEAD");
    writeFileSync(join(subrepo, "f"), "2");
    g(subrepo, "commit", "-q", "-am", "s2");
    const S2 = g(subrepo, "rev-parse", "HEAD");

    // parent: C1 pins sub@S1 (initialised); tag v2 = C2 moves the gitlink to S2
    const spec = { kind: "git" as const, ref: "git:https://github.com/o/r", pin: "v2" };
    const cacheDir = join(root, "cache");
    const clone = join(cacheDir, cacheKey(spec));
    mkdirSync(clone, { recursive: true });
    g(clone, "init", "-q");
    g(clone, "submodule", "add", "-q", subrepo, "sub");
    g(join(clone, "sub"), "checkout", "-q", S1);
    g(clone, "add", "-A"); g(clone, "commit", "-q", "-m", "c1");
    const C1 = g(clone, "rev-parse", "HEAD");
    g(join(clone, "sub"), "checkout", "-q", S2);
    g(clone, "add", "sub"); g(clone, "commit", "-q", "-m", "c2");
    g(clone, "tag", "v2");
    g(clone, "remote", "add", "origin", "https://github.com/o/r");

    const reset = () => { g(clone, "-c", "submodule.recurse=false", "checkout", "-q", "--no-recurse-submodules", C1); g(join(clone, "sub"), "checkout", "-q", S1); };
    const subHead = () => g(join(clone, "sub"), "rev-parse", "HEAD");

    // CONTROL: an UNGUARDED checkout under this config does move the submodule — the observable can fail.
    reset();
    g(clone, "checkout", "-q", "v2");
    expect(subHead()).toBe(S2);

    // The resolver's pinned refresh: real git for everything except the (network) fetch.
    reset();
    expect(subHead()).toBe(S1);
    recordTrust(spec);
    const realGit = (args: string[]) => (args.includes("fetch") ? "" : execFileSync("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    await gitResolver.resolve(spec, { cwd: root, cacheDir, refresh: true, testHooks: { git: realGit, lookup: pub("140.82.112.3") } });
    expect(g(clone, "rev-parse", "HEAD")).not.toBe(C1); // the parent DID move to v2 ...
    expect(subHead()).toBe(S1); // ... but the submodule was NOT updated
  });
});
