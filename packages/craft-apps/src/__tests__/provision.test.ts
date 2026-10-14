import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeListing,
  assetFor,
  locateBinary,
  type ProvisionDeps,
  parseSums,
  provision,
} from "../provision.js";
import { CRAFT_APPS, type CraftApp, envPrefix, } from "../registry.js";
import {
  cleanupTmp,
  craftArchive,
  type Fixture,
  isBsdtar,
  makeTarGz,
  STUB_BINARY,
  STUB_VERSION_OUTPUT,
  sha256,
  startFixture,
  tmpDir,
} from "./helpers/fixtures.js";

/** The full provisioning suite runs once per registry row (PhotoCraft's tests, parameterised). */
function suite(app: CraftApp): void {
  const ID = app.id;
  const CLI = app.cli;
  const PFX = envPrefix(app);
  const NAME = app.name;
  // X7 spawns real child processes; two apps are enough to prove the per-app cache is process-safe.
  const heavy = ID === "photocraft" || ID === "soundcraft";

  const ASSET = `${ID}-0.7.0-linux-x86_64.tar.gz`;
  const TOP = `${ID}-0.7.0-linux-x86_64`;
  const goodArchive = () =>
    makeTarGz({ [`${TOP}/bin/${CLI}`]: STUB_BINARY, [`${TOP}/bin/${ID}`]: STUB_BINARY, [`${TOP}/share/icon.txt`]: "icon" });

  const fixtures: Fixture[] = [];
  afterEach(async () => {
    for (const f of fixtures.splice(0)) await f.close();
    cleanupTmp();
  });

  async function setup(opts: Parameters<typeof startFixture>[0] = { assets: { [ASSET]: goodArchive() } }) {
    const fx = await startFixture({ repo: app.repo, ...opts });
    fixtures.push(fx);
    const home = path.join(tmpDir(), "craft-home");
    const root = path.join(home, ID);
    const logs: string[] = [];
    const deps = (extra: Partial<ProvisionDeps> = {}): Partial<ProvisionDeps> => ({
      env: { CRAFT_HOME: home },
      platform: "linux",
      arch: "x64",
      glibcVersion: () => "2.36",
      apiBase: fx.url,
      log: (m) => logs.push(m),
      ...extra,
    });
    const envWith = (e: NodeJS.ProcessEnv) => ({ CRAFT_HOME: home, ...e });
    return { fx, root, home, logs, deps, envWith };
  }

  function stubFile(mode = 0o755, content = STUB_BINARY): string {
    const f = path.join(tmpDir(), `${CLI}`);
    fs.writeFileSync(f, content);
    fs.chmodSync(f, mode);
    return f;
  }
  const noStaging = (root: string) => fs.existsSync(root) && fs.readdirSync(root).filter((n) => n.startsWith(".staging-")).length === 0;
  const asErr = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected rejection"); }, (e: Error) => e);

  describe("version resolution", () => {
    it(`E1 ${PFX}_BIN returns the path without network or cache`, async () => {
      const s = await setup();
      const bin = stubFile();
      const r = await provision(app, s.deps({ env: s.envWith({ [`${PFX}_BIN`]: bin }) }));
      expect(r.binary).toBe(bin);
      expect(r.source).toBe("override");
      expect(s.fx.requests).toHaveLength(0);
      expect(fs.existsSync(s.root)).toBe(false);
    });

    it(`E2 non-usable ${PFX}_BIN names the variable, the path and the reason`, async () => {
      const s = await setup();
      const dir = tmpDir();
      const cases: [string, string][] = [
        [path.join(dir, "nope"), "not found"],
        [dir, "not a file"],
        [stubFile(0o644), "not executable"],
      ];
      for (const [p, reason] of cases) {
        const e = await asErr(provision(app, s.deps({ env: s.envWith({ [`${PFX}_BIN`]: p }) })));
        expect(e.message).toContain(`${PFX}_BIN`);
        expect(e.message).toContain(p);
        expect(e.message).toContain(reason);
      }
      expect(s.fx.requests).toHaveLength(0);
    });

    it("E3 pinned version (with and without v) never asks for latest", async () => {
      for (const pin of ["v0.7.0", "0.7.0"]) {
        const s = await setup();
        const r = await provision(app, s.deps({ env: s.envWith({ [`${PFX}_VERSION`]: pin }) }));
        expect(r.version).toBe("0.7.0");
        expect(r.source).toBe("pin");
        expect(r.asset).toBe(ASSET);
        expect(s.fx.requests.map((q) => q.url)).toContain(`/repos/storytold/${ID}/releases/tags/v0.7.0`);
        expect(s.fx.requests.some((q) => q.url.endsWith("/releases/latest"))).toBe(false);
      }
    });

    it("E3b a pin that is not a safe path segment is rejected", async () => {
      const s = await setup();
      for (const pin of ["../evil", "1/2", "v"]) {
        const e = await asErr(provision(app, s.deps({ env: s.envWith({ [`${PFX}_VERSION`]: pin }) })));
        expect(e.message).toContain(`invalid ${NAME} version`);
      }
    });

    it("E4 latest lookup cache: 23h59m hit, 24h / future / corrupt refetch", async () => {
      const now = 1_800_000_000_000;
      const H = 3_600_000;
      const cases: [string, number][] = [
        [JSON.stringify({ tag: "v0.7.0", checkedAt: now - (24 * H - 60_000) }), 0],
        [JSON.stringify({ tag: "v0.7.0", checkedAt: now - 24 * H }), 1],
        [JSON.stringify({ tag: "v0.7.0", checkedAt: now + H }), 1],
        ["{not json", 1],
      ];
      for (const [record, calls] of cases) {
        const s = await setup();
        fs.mkdirSync(s.root, { recursive: true });
        fs.writeFileSync(path.join(s.root, "latest.json"), record);
        const r = await provision(app, s.deps({ now: () => now }));
        expect(s.fx.requests.filter((q) => q.url.endsWith("/releases/latest"))).toHaveLength(calls);
        expect(r.source).toBe(calls ? "latest" : "latest-cached");
      }
    });

    it("E5 GITHUB_TOKEN is sent as a bearer credential only when set", async () => {
      const withToken = await setup();
      await provision(app, withToken.deps({ env: withToken.envWith({ GITHUB_TOKEN: "abc" }) }));
      expect(withToken.fx.requests.find((q) => q.url.endsWith("/releases/latest"))?.auth).toBe("Bearer abc");
      // the token never reaches asset downloads
      expect(withToken.fx.requests.filter((q) => q.url.startsWith("/download")).every((q) => q.auth === undefined)).toBe(true);
      const without = await setup();
      await provision(app, without.deps());
      expect(without.fx.requests.find((q) => q.url.endsWith("/releases/latest"))?.auth).toBeUndefined();
    });
  });

  describe("host → asset", () => {
    it("E6 every registry host row, and an unsupported host", () => {
      for (const [host, patterns] of Object.entries(app.assets)) {
        const [os, arch] = host.split("/");
        expect(assetFor(app, os, arch, "0.7.0"), host).toBe((patterns as readonly string[])[0].replaceAll("{v}", "0.7.0"));
      }
      expect(assetFor(app, "darwin", "arm64", "0.7.0")).toBe(`${CLI}-0.7.0-macos-universal.zip`);
      expect(assetFor(app, "win32", "x64", "0.7.0")).toBe(`${ID}-0.7.0-windows-x64-portable.zip`);
      expect(() => assetFor(app, "linux", "s390x", "0.7.0")).toThrow(new RegExp(`linux.*s390x.*${PFX}_BIN`, "s"));
    });

    it("E41 linux C library gate: old glibc and musl fail before any fetch", async () => {
      for (const [v, needle] of [["2.17", "glibc 2.17"], [undefined, "musl"]] as const) {
        const s = await setup();
        const e = await asErr(provision(app, s.deps({ glibcVersion: () => v })));
        expect(e.message).toContain(needle);
        expect(e.message).toContain(`≥ ${app.glibcMin[0]}.${app.glibcMin[1]}`);
        expect(e.message).toContain(`${PFX}_BIN`);
        expect(s.fx.requests).toHaveLength(0);
      }
      for (const v of [`${app.glibcMin[0]}.${app.glibcMin[1]}`, "2.99"]) {
        const s = await setup();
        await expect(provision(app, s.deps({ glibcVersion: () => v }))).resolves.toBeDefined();
      }
    });

    it("X3 release without the mapped asset names the tag and the asset", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, hide: [ASSET] });
      const e = await asErr(provision(app, s.deps()));
      expect(e.message).toContain("v0.7.0");
      expect(e.message).toContain(ASSET);
    });
  });

  describe("checksums", () => {
    it("E7 SHA256SUMS parsing: marker, ./, CRLF accepted; duplicate and missing rejected", () => {
      const h = "a".repeat(64);
      expect(parseSums(`${h}  n.tgz\n`, "n.tgz")).toBe(h);
      expect(parseSums(`${h} *n.tgz\n`, "n.tgz")).toBe(h);
      expect(parseSums(`${h}  ./n.tgz\n`, "n.tgz")).toBe(h);
      expect(parseSums(`${h}  n.tgz\r\nother\r\n`, "n.tgz")).toBe(h);
      expect(() => parseSums(`${h}  n.tgz\n${h}  n.tgz\n`, "n.tgz")).toThrow(/2 entries/);
      expect(() => parseSums(`${h}  other.tgz\n`, "n.tgz")).toThrow(/no entry/);
      expect(() => parseSums(`${"z".repeat(64)}  n.tgz\n`, "n.tgz")).toThrow(/no entry/);
    });

    it("E7b duplicate / missing entries leave nothing in <ver>/", async () => {
      const archive = goodArchive();
      const d = sha256(archive);
      for (const sums of [`${d}  ${ASSET}\n${d}  ${ASSET}\n`, "\n"]) {
        const s = await setup({ assets: { [ASSET]: archive }, sums });
        await asErr(provision(app, s.deps()));
        expect(fs.existsSync(path.join(s.root, "0.7.0"))).toBe(false);
        expect(noStaging(s.root)).toBe(true);
      }
    });

    it("X4 digest mismatch shows both digests and installs nothing", async () => {
      const archive = goodArchive();
      const wrong = "0".repeat(64);
      const s = await setup({ assets: { [ASSET]: archive }, sums: `${wrong}  ${ASSET}\n` });
      const e = await asErr(provision(app, s.deps()));
      expect(e.message).toContain(wrong);
      expect(e.message).toContain(sha256(archive));
      expect(fs.existsSync(path.join(s.root, "0.7.0"))).toBe(false);
      expect(noStaging(s.root)).toBe(true);
    });

    it("X5 unavailable SHA256SUMS.txt fails closed", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, sums: null });
      await asErr(provision(app, s.deps()));
      expect(fs.existsSync(path.join(s.root, "0.7.0"))).toBe(false);
      expect(noStaging(s.root)).toBe(true);
    });
  });

  describe("extraction + cache", () => {
    it("E8 binary lookup: known path, fallback basename, __MACOSX ignored, ambiguity", () => {
      const mk = (files: string[]) => {
        const d = tmpDir();
        for (const f of files) {
          fs.mkdirSync(path.join(d, path.dirname(f)), { recursive: true });
          fs.writeFileSync(path.join(d, f), "x");
        }
        return d;
      };
      const known = mk([`top/bin/${CLI}`, `other/${CLI}`]);
      expect(locateBinary(app, known, "linux", "a")).toBe(path.join(known, `top/bin/${CLI}`));
      const fallback = mk([`deep/er/${CLI}`]);
      expect(locateBinary(app, fallback, "linux", "a")).toBe(path.join(fallback, `deep/er/${CLI}`));
      const macosx = mk([`deep/er/${CLI}`, `__MACOSX/deep/er/${CLI}`]);
      expect(locateBinary(app, macosx, "linux", "a")).toBe(path.join(macosx, `deep/er/${CLI}`));
      const two = mk([`a/x/${CLI}`, `b/y/${CLI}`]);
      expect(() => locateBinary(app, two, "linux", "the-asset")).toThrow(/the-asset/);
      expect(locateBinary(app, mk(["nothing"]), "linux", "a")).toBeUndefined();
    });

    it("E8b ambiguous archive: error names the asset and staging is removed", async () => {
      const archive = makeTarGz({ [`a/x/${CLI}`]: STUB_BINARY, [`b/y/${CLI}`]: STUB_BINARY });
      const s = await setup({ assets: { [ASSET]: archive } });
      const e = await asErr(provision(app, s.deps()));
      expect(e.message).toContain(ASSET);
      expect(noStaging(s.root)).toBe(true);
    });

    it("E9 cache hit vs damaged entries", async () => {
      const s = await setup();
      const first = await provision(app, s.deps());
      expect(first.cacheHit).toBe(false);
      const hit = await provision(app, s.deps({ env: s.envWith({ [`${PFX}_VERSION`]: "0.7.0" }) }));
      expect(hit.cacheHit).toBe(true);
      expect(hit.binary).toBe(first.binary);
      expect(s.fx.requests.filter((q) => q.url.startsWith("/download"))).toHaveLength(2); // first install only

      const damage: [string, (b: string) => void][] = [
        ["missing", (b) => fs.rmSync(b)],
        ["empty", (b) => fs.writeFileSync(b, "")],
        ["mode 0644", (b) => fs.chmodSync(b, 0o644)],
      ];
      for (const [, mutate] of damage) {
        mutate(first.binary);
        const before = s.fx.requests.length;
        const r = await provision(app, s.deps({ env: s.envWith({ [`${PFX}_VERSION`]: "0.7.0" }) }));
        expect(r.cacheHit).toBe(false);
        expect(s.fx.requests.length).toBeGreaterThan(before);
        expect(fs.statSync(r.binary).size).toBeGreaterThan(0);
      }
    });

    it("E10 only the mapped archive, SHA256SUMS.txt and API paths are requested", async () => {
      const installers = [`${ID}.dmg`, `${ID}.msi`, `${ID}.deb`, `${ID}.AppImage`, `${ID}.flatpak`, `${ID}.rpm`];
      const assets: Record<string, Buffer> = { [ASSET]: goodArchive() };
      for (const i of installers) assets[i] = Buffer.from("installer");
      const s = await setup({ assets });
      await provision(app, s.deps());
      const paths = s.fx.requests.map((q) => q.url);
      expect(paths.filter((p) => p.startsWith("/download")).sort()).toEqual(["/download/v0.7.0/SHA256SUMS.txt", `/download/v0.7.0/${ASSET}`]);
      expect(paths.filter((p) => !p.startsWith("/download"))).toEqual([`/repos/storytold/${ID}/releases/latest`]);
    });

    it("E11 report: fresh install and override shapes", async () => {
      const s = await setup();
      const r = await provision(app, s.deps());
      expect(r).toMatchObject({ version: "0.7.0", source: "latest", asset: ASSET, cacheHit: false });
      expect(path.isAbsolute(r.binary)).toBe(true);
      expect(typeof r.durationMs).toBe("number");
      const o = await provision(app, s.deps({ env: s.envWith({ [`${PFX}_BIN`]: stubFile() }), probeVersion: true }));
      expect(o).toMatchObject({ source: "override", asset: null, version: "0.7.0" });
      expect(STUB_VERSION_OUTPUT).toContain("0.7.0");
    });

    it("E12 macOS Gatekeeper result is recorded; rejection only warns", async () => {
      const zipName = `${CLI}-0.7.0-macos-universal.zip`;
      // tar -x reads this stand-in archive; the darwin ditto call is mapped onto tar.
      const archive = makeTarGz({ [`${CLI}`]: STUB_BINARY });
      for (const accepted of [true, false]) {
        const s = await setup({ assets: { [zipName]: archive } });
        const calls: string[] = [];
        const exec: ProvisionDeps["exec"] = async (file, args, opts) => {
          calls.push(file);
          if (file === "spctl") {
            if (!accepted) throw Object.assign(new Error("rejected"), { code: 3 });
            return { stdout: "", stderr: "" };
          }
          const real = (await import("@blackbelt-technology/pi-dashboard-shared/platform/exec.js")).execFileAsync;
          if (file === "ditto") return real("tar", ["-xf", args[2], "-C", args[3]], opts);
          return real(file, args, opts);
        };
        const r = await provision(app, s.deps({ platform: "darwin", arch: "arm64", exec }));
        expect(r.gatekeeper).toBe(accepted ? "accepted" : "rejected");
        expect(calls).toContain("spctl");
        expect(s.logs.some((l) => /Gatekeeper rejected/.test(l))).toBe(!accepted);
      }
    });

    it("E46 desktop executable removed; listing mismatch rejected before extraction", async () => {
      const s = await setup();
      const r = await provision(app, s.deps());
      expect(fs.existsSync(r.binary)).toBe(true);
      expect(fs.existsSync(path.join(path.dirname(r.binary), `${ID}`))).toBe(false);

      const s2 = await setup();
      let extracted = false;
      const real = (await import("@blackbelt-technology/pi-dashboard-shared/platform/exec.js")).execFileAsync;
      const exec: ProvisionDeps["exec"] = async (file, args, opts) => {
        if (file === "tar" && args[0] === "-tvf") return { stdout: "-rwxr-xr-x 0 0 0 1 Jan 1 00:00 only-one-line\n", stderr: "" };
        if (file === "tar" && args[0] === "-tf") return { stdout: "a\nb\n", stderr: "" };
        if (file === "tar" && args[0] === "-xf") extracted = true;
        return real(file, args, opts);
      };
      const e = await asErr(provision(app, s2.deps({ exec })));
      expect(e.message).toMatch(/listing mismatch/);
      expect(extracted).toBe(false);
      expect(fs.existsSync(path.join(s2.root, "0.7.0"))).toBe(false);
    });

    it("E46b assertSafeListing rejects unrecognised detail lines", () => {
      expect(() => assertSafeListing(["a"], ["garbage"])).toThrow(/not understood/);
      expect(() => assertSafeListing(["a"], ["-rw-r--r-- 0 0 0 1 Jan 1 00:00 a"])).not.toThrow();
    });

    it("X6 hostile archives abort before extraction and write nothing", async () => {
      const kinds = ["tar-traversal", "tar-absolute", "tar-symlink", "tar-hardlink"] as const;
      for (const kind of kinds) {
        const s = await setup({ assets: { [ASSET]: craftArchive(kind) } });
        const e = await asErr(provision(app, s.deps()));
        expect(e.message, kind).toMatch(/refusing to extract/);
        expect(fs.existsSync(path.join(s.root, "0.7.0")), kind).toBe(false);
        expect(noStaging(s.root), kind).toBe(true);
        expect(fs.existsSync("/tmp/pcraft-abs-x")).toBe(false);
      }
    });

    it.skipIf(!isBsdtar())("X6b hostile zip with a symlink entry is rejected (bsdtar reads zip)", async () => {
      const zipName = `${CLI}-0.7.0-macos-universal.zip`;
      const s = await setup({ assets: { [zipName]: craftArchive("zip-symlink") } });
      const e = await asErr(provision(app, s.deps({ platform: "darwin", arch: "arm64" })));
      expect(e.message).toMatch(/not a regular file|refusing to extract/);
      expect(fs.existsSync(path.join(s.root, "0.7.0"))).toBe(false);
    });

    it.skipIf(!heavy)("X7 concurrent installs both succeed with one complete <ver>/", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, assetDelayMs: 400 });
      const child = fileURLToPath(new URL("./helpers/provision-child.ts", import.meta.url));
      const spawnAsync = (cmd: string[]) =>
        new Promise<{ status: number | null; out: string }>((resolve) => {
          // real concurrency: two processes in flight at once
          const p = spawn(process.execPath, cmd, { stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          p.stdout.on("data", (d) => (out += d));
          p.on("close", (status) => resolve({ status, out }));
        });
      const args = ["--import", createRequire(import.meta.url).resolve("tsx"), child, app.id, s.fx.url, s.home];
      const [a, b] = await Promise.all([spawnAsync(args), spawnAsync(args)]);
      expect(a.status).toBe(0);
      expect(b.status).toBe(0);
      expect(JSON.parse(a.out).binary).toBe(JSON.parse(b.out).binary);
      expect(fs.readdirSync(s.root).filter((n) => /^\d/.test(n))).toEqual(["0.7.0"]);
      expect(noStaging(s.root)).toBe(true);
    }, 30_000);

    it("X8 interrupted download leaves no <ver>/ and the next run completes", async () => {
      const archive = goodArchive();
      const s = await setup({ assets: { [ASSET]: archive }, truncateAt: 0.5 });
      await asErr(provision(app, s.deps()));
      expect(fs.existsSync(path.join(s.root, "0.7.0"))).toBe(false);
      expect(noStaging(s.root)).toBe(true);
      await s.fx.close();
      fixtures.pop();
      const healthy = await startFixture({ repo: app.repo, assets: { [ASSET]: archive } });
      fixtures.push(healthy);
      const r = await provision(app, s.deps({ apiBase: healthy.url }));
      expect(fs.existsSync(r.binary)).toBe(true);
    });

    it("X9 stale staging sweep: 61 min removed, 59 min kept", async () => {
      const s = await setup();
      fs.mkdirSync(s.root, { recursive: true });
      const old = path.join(s.root, ".staging-1-old");
      const fresh = path.join(s.root, ".staging-2-fresh");
      fs.mkdirSync(old);
      fs.mkdirSync(fresh);
      const now = Date.now();
      fs.utimesSync(old, new Date(now - 61 * 60_000), new Date(now - 61 * 60_000));
      fs.utimesSync(fresh, new Date(now - 59 * 60_000), new Date(now - 59 * 60_000));
      await provision(app, s.deps({ now: () => now }));
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
    });
  });

  describe("offline fallbacks", () => {
    function install(root: string, version: string) {
      const dir = path.join(root, version, "x", "bin");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${CLI}`), STUB_BINARY, { mode: 0o755 });
    }

    it("X1 failing latest lookup falls back to the highest installed semver", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, latestStatus: 403 });
      for (const v of ["0.6.0", "0.7.0", "0.10.0"]) install(s.root, v);
      const r = await provision(app, s.deps());
      expect(r.version).toBe("0.10.0");
      expect(r.source).toBe("fallback-installed");
      expect(s.logs.join("\n")).toMatch(/403/);
      expect(s.logs.join("\n")).toContain("0.10.0");
    });

    it("X1b fallback skips damaged cache entries (empty / non-executable highest version)", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, latestStatus: 403 });
      install(s.root, "0.7.0");
      install(s.root, "0.9.0");
      fs.writeFileSync(path.join(s.root, "0.9.0", "x", "bin", `${CLI}`), ""); // empty
      install(s.root, "0.10.0");
      fs.chmodSync(path.join(s.root, "0.10.0", "x", "bin", `${CLI}`), 0o644); // not executable
      const r = await provision(app, s.deps());
      expect(r.version).toBe("0.7.0");
      expect(r.source).toBe("fallback-installed");
      expect(r.cacheHit).toBe(true);
    });

    it("X2 failing lookup with an empty cache names the error and the escape hatches", async () => {
      const s = await setup({ assets: { [ASSET]: goodArchive() }, latestStatus: 500 });
      const e = await asErr(provision(app, s.deps()));
      expect(e.message).toContain("500");
      for (const word of ["GITHUB_TOKEN", `${PFX}_VERSION`, `${PFX}_BIN`]) expect(e.message).toContain(word);
    });
  });

}

describe.each(CRAFT_APPS)("provision $id", (app) => {
  suite(app);
});
