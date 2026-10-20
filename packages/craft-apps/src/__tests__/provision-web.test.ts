/**
 * `provisionWeb`: browser-build provisioning (`<app>-web-<ver>.zip`) through the shared install core.
 * Offline against the fixture release server. See change: edit-office-in-pane-with-craft-web (test-plan E4–E14, X1, X6).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { latestWebVersion, type ProvisionWebError, type ProvisionWebOptions, provision, provisionWeb, type WebErrorCode } from "../provision.js";
import { getApp } from "../registry.js";
import { listZip } from "../zip-guard.js";
import { cleanupTmp, craftArchive, type Fixture, makeTarGz, STUB_BINARY, startFixture, tmpDir } from "./helpers/fixtures.js";

const APP = getApp("wordcraft");
const ZIP = "wordcraft-web-0.8.0.zip";
const INDEX = '<html><script type="module">/*trunk*/</script></html>';

function webZip(files: Record<string, string> = { "index.html": INDEX, "app_bg.wasm": "wasm-bytes" }, level: 0 | 6 = 0): Buffer {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [n, c] of Object.entries(files)) entries[n] = [strToU8(c), { level }];
  return Buffer.from(zipSync(entries));
}

/** Patch the first central-directory header's uncompressed size (offset 24); only valid for deflated entries (yauzl checks stored ones). */
function claimUncompressed(zip: Buffer, size: number): Buffer {
  const out = Buffer.from(zip);
  const cd = out.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  out.writeUInt32LE(size, cd + 24);
  return out;
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  cleanupTmp();
});

async function setup(assets: Record<string, Buffer> = { [ZIP]: webZip() }, tag = "v0.8.0", extra: Partial<Parameters<typeof startFixture>[0]> = {}) {
  const fx = await startFixture({ repo: APP.repo, tag, assets, ...extra });
  fixtures.push(fx);
  const home = path.join(tmpDir(), "craft-home");
  const appRoot = path.join(home, "wordcraft-web");
  const logs: string[] = [];
  const opts = (o: Partial<ProvisionWebOptions> = {}): ProvisionWebOptions => ({
    root: home,
    shimVersion: 1,
    env: { CRAFT_HOME: home },
    platform: "linux",
    arch: "x64",
    apiBase: fx.url,
    log: (m) => logs.push(m),
    ...o,
  });
  const envWith = (e: NodeJS.ProcessEnv) => ({ CRAFT_HOME: home, ...e });
  const downloads = () => fx.requests.filter((r) => r.url.startsWith("/download/") && r.url.endsWith(".zip"));
  return { fx, home, appRoot, logs, opts, envWith, downloads };
}

const errOf = async (p: Promise<unknown>): Promise<ProvisionWebError> =>
  p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e) => e as ProvisionWebError,
  );
const noInstalled = (appRoot: string) => !fs.existsSync(appRoot) || fs.readdirSync(appRoot).filter((n) => !n.startsWith(".staging-")).length === 0;

function treeDigest(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      h.update(`${path.relative(dir, p)}\n`);
      if (e.isDirectory()) walk(p);
      else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

function overrideDir(files: Record<string, string>): string {
  const d = path.join(tmpDir(), "override");
  for (const [rel, c] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c);
  }
  return d;
}

describe("provisionWeb resolution", () => {
  it("E4 WEB_DIR wins with no network; BIN/VERSION are ignored", async () => {
    const s = await setup();
    const dir = overrideDir({ "index.html": INDEX });
    const env = s.envWith({
      WORDCRAFT_WEB_DIR: dir,
      WORDCRAFT_WEB_VERSION: "v0.8.0",
      WORDCRAFT_BIN: "/nope",
      WORDCRAFT_VERSION: "9.9.9",
    });
    const r = await provisionWeb(APP, s.opts({ env }));
    expect(r.source).toBe("env-dir");
    expect(r.asset).toBeNull();
    expect(s.fx.requests).toHaveLength(0);
  });

  it("E4 WEB_VERSION pin (leading v stripped) beats the registry and never asks for latest", async () => {
    const s = await setup({ "wordcraft-web-0.9.0.zip": webZip() }, "v0.9.0");
    const r = await provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_VERSION: "v0.9.0", WORDCRAFT_VERSION: "1.2.3", WORDCRAFT_BIN: "/nope" }) }));
    expect(r.version).toBe("0.9.0");
    expect(r.source).toBe("env-version");
    expect(r.asset).toBe("wordcraft-web-0.9.0.zip");
    const urls = s.fx.requests.map((q) => q.url);
    expect(urls).toContain("/repos/storytold/wordcraft/releases/tags/v0.9.0");
    expect(urls.some((u) => u.endsWith("/releases/latest"))).toBe(false);
  });

  it("E4 registry webVersion otherwise; never latest even when a newer release exists", async () => {
    const s = await setup();
    const r = await provisionWeb(APP, s.opts());
    expect(r.source).toBe("registry");
    expect(r.version).toBe("0.8.0");
    expect(s.fx.requests.some((q) => q.url.endsWith("/releases/latest"))).toBe(false);
  });

  it("E4 an app without a verified web build fails closed with no network", async () => {
    const s = await setup();
    const e = await errOf(provisionWeb("figcraft", s.opts()));
    expect(e.code).toBe<WebErrorCode>("not-verified");
    expect(s.fx.requests).toHaveLength(0);
  });

  it("E4b an unsafe WEB_VERSION is rejected", async () => {
    const s = await setup();
    const e = await errOf(provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_VERSION: "../evil" }) })));
    expect(e.message).toContain("invalid");
    expect(s.fx.requests).toHaveLength(0);
  });

  it("E5 CRAFT_SOURCE=launcher fails closed without WEB_DIR (zero network), installs from the dir with it", async () => {
    const s = await setup();
    const e = await errOf(provisionWeb(APP, s.opts({ env: s.envWith({ CRAFT_SOURCE: "launcher" }) })));
    expect(e.code).toBe<WebErrorCode>("launcher-source");
    expect(e.message).toContain("launcher");
    expect(s.fx.requests).toHaveLength(0);
    expect(noInstalled(s.appRoot)).toBe(true);

    const dir = overrideDir({ "index.html": INDEX });
    const r = await provisionWeb(APP, s.opts({ env: s.envWith({ CRAFT_SOURCE: "launcher", WORDCRAFT_WEB_DIR: dir }) }));
    expect(r.source).toBe("env-dir");
    expect(fs.existsSync(path.join(r.dir, "index.html"))).toBe(true);
    expect(s.fx.requests).toHaveLength(0);
  });
});

describe("provisionWeb override directory", () => {
  it("E6 copies a read-only override without mutating it", async () => {
    const s = await setup();
    const dir = overrideDir({ "index.html": INDEX, "assets/app_bg.wasm": "w1" });
    const before = treeDigest(dir);
    fs.chmodSync(path.join(dir, "index.html"), 0o444);
    fs.chmodSync(path.join(dir, "assets"), 0o555);
    fs.chmodSync(dir, 0o555);
    try {
      const r = await provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_DIR: dir }) }));
      expect(r.dir).toMatch(new RegExp(`${s.appRoot}/dir-[0-9a-f]{12}-s1$`.replace(/[/]/g, "[/]")));
      expect(fs.readFileSync(path.join(r.dir, "assets", "app_bg.wasm"), "utf8")).toBe("w1");
      expect(treeDigest(dir)).toBe(before);
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.chmodSync(path.join(dir, "assets"), 0o755);
    }
  });

  it("E6b an override with a symlink or no index.html is rejected", async () => {
    const s = await setup();
    const bad = overrideDir({ "index.html": INDEX });
    fs.symlinkSync("/etc/passwd", path.join(bad, "link"));
    expect((await errOf(provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_DIR: bad }) })))).code).toBe("invalid-dir");
    const empty = overrideDir({ "x.txt": "x" });
    expect((await errOf(provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_DIR: empty }) })))).code).toBe("invalid-dir");
    expect((await errOf(provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_DIR: "/no/such/dir" }) })))).code).toBe("invalid-dir");
    expect(noInstalled(s.appRoot)).toBe(true);
  });

  it("E7 a changed wasm with an identical index.html gets a new key and `current` follows", async () => {
    const s = await setup();
    const dir = overrideDir({ "index.html": INDEX, "app_bg.wasm": "one" });
    const env = s.envWith({ WORDCRAFT_WEB_DIR: dir });
    const r1 = await provisionWeb(APP, s.opts({ env }));
    const again = await provisionWeb(APP, s.opts({ env }));
    expect(again.dir).toBe(r1.dir);
    expect(again.cacheHit).toBe(true);
    fs.writeFileSync(path.join(dir, "app_bg.wasm"), "two");
    const r2 = await provisionWeb(APP, s.opts({ env }));
    expect(r2.dir).not.toBe(r1.dir);
    expect(r2.cacheHit).toBe(false);
    expect(fs.realpathSync(path.join(s.appRoot, "current"))).toBe(fs.realpathSync(r2.dir));
    expect(fs.existsSync(r1.dir)).toBe(true);
  });
});

describe("provisionWeb zip guard and extraction", () => {
  const cases: [string, () => Buffer][] = [
    ["a ../ entry", () => webZip({ "index.html": INDEX, "../x": "x" })],
    ["an absolute entry", () => webZip({ "index.html": INDEX, "/abs/x": "x" })],
    ["a symlink entry", () => craftArchive("zip-symlink")],
    ["2,001 entries", () => webZip({ "index.html": INDEX, ...Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`f${i}`, ""])) })],
    ["513 MB uncompressed", () => claimUncompressed(webZip(undefined, 6), 513 * 1024 * 1024)],
  ];
  for (const [label, make] of cases) {
    it(`E8 ${label} aborts before extraction and installs nothing`, async () => {
      const s = await setup({ [ZIP]: make() });
      const e = await errOf(provisionWeb(APP, s.opts()));
      expect(e.code).toBe<WebErrorCode>("extract-failed");
      expect(e.message).toMatch(/refusing to extract|escapes|invalid relative path|absolute/);
      expect(noInstalled(s.appRoot)).toBe(true);
      expect(fs.readdirSync(s.appRoot).filter((n) => n.startsWith(".staging-"))).toEqual([]);
    });
  }

  it("E8 listZip accepts the limits exactly (2,000 entries, 512 MB claimed)", async () => {
    const dir = tmpDir();
    const ok = path.join(dir, "ok.zip");
    fs.writeFileSync(ok, webZip({ index: "x", ...Object.fromEntries(Array.from({ length: 1999 }, (_, i) => [`f${i}`, ""])) }));
    expect(await listZip(ok)).toHaveLength(2000);
    const big = path.join(dir, "big.zip");
    fs.writeFileSync(big, claimUncompressed(webZip({ "index.html": "x" }, 6), 512 * 1024 * 1024));
    expect(await listZip(big)).toHaveLength(1);
  });

  it("E8 each guard fires for its own reason", async () => {
    const dir = tmpDir();
    for (const [label, make, re] of [
      ["many", cases[3][1], /2001 entries/],
      ["big", cases[4][1], /exceeds 536870912 bytes/],
      ["link", cases[2][1], /not a regular file or directory/],
    ] as const) {
      const f = path.join(dir, `${label}.zip`);
      fs.writeFileSync(f, make());
      await expect(listZip(f)).rejects.toThrow(re);
    }
  });

  it("E8 a zip without index.html is not installed", async () => {
    const s = await setup({ [ZIP]: webZip({ "other.html": "x" }) });
    expect((await errOf(provisionWeb(APP, s.opts()))).code).toBe("extract-failed");
    expect(noInstalled(s.appRoot)).toBe(true);
  });

  it("E9 Linux install uses JS extraction: no tar/ditto exec", async () => {
    const s = await setup();
    const calls: string[] = [];
    const r = await provisionWeb(APP, s.opts({ exec: async (file) => (calls.push(file), { stdout: "", stderr: "" }) }));
    expect(calls).toEqual([]);
    expect(fs.readFileSync(path.join(r.dir, "index.html"), "utf8")).toBe(INDEX);
    expect(fs.readFileSync(path.join(r.dir, "app_bg.wasm"), "utf8")).toBe("wasm-bytes");
  });
});

describe("provisionWeb cache, races, pointer", () => {
  it("E10 never touches the CLI cache", async () => {
    const cliAsset = "wordcraft-cli-0.8.0-linux-x86_64.tar.gz";
    const cli = makeTarGz({ "top/bin/wordcraft-cli": STUB_BINARY });
    const s = await setup({ [ZIP]: webZip(), [cliAsset]: cli });
    const base = { env: s.envWith({ WORDCRAFT_VERSION: "0.8.0" }), platform: "linux" as const, arch: "x64", glibcVersion: () => "2.36", apiBase: s.fx.url, log: () => {} };
    const first = await provision(APP, base);
    const cliDir = path.join(s.home, "wordcraft");
    const before = treeDigest(cliDir);
    const web = await provisionWeb(APP, s.opts());
    expect(web.dir.startsWith(`${s.home}/wordcraft-web/`)).toBe(true);
    expect(treeDigest(cliDir)).toBe(before);
    const second = await provision(APP, base);
    expect(second.cacheHit).toBe(true);
    expect(second.binary).toBe(first.binary);
  });

  it("E11 concurrent in-process calls download once", async () => {
    const s = await setup(undefined, undefined, { assetDelayMs: 100 });
    const [a, b] = await Promise.all([provisionWeb(APP, s.opts()), provisionWeb(APP, s.opts())]);
    expect(a.dir).toBe(b.dir);
    expect(s.downloads()).toHaveLength(1);
    const c = await provisionWeb(APP, s.opts());
    expect(c.cacheHit).toBe(true);
    expect(s.downloads()).toHaveLength(1);
  });

  it("E11 EEXIST on the final rename: another process won — verify and reuse its tree", async () => {
    const s = await setup();
    const winner = path.join(s.appRoot, "0.8.0-s1");
    const r = await provisionWeb(
      APP,
      s.opts({
        postInstall: () => {
          fs.mkdirSync(winner, { recursive: true });
          fs.writeFileSync(path.join(winner, "index.html"), "WINNER");
        },
      }),
    );
    expect(r.cacheHit).toBe(false);
    expect(fs.readFileSync(path.join(r.dir, "index.html"), "utf8")).toBe("WINNER");
    expect(fs.realpathSync(r.current)).toBe(fs.realpathSync(winner));
    expect(fs.readdirSync(s.appRoot).filter((n) => n.startsWith(".staging-"))).toEqual([]);
  });

  it("E11 a damaged cached tree (no index.html) is re-provisioned", async () => {
    const s = await setup();
    fs.mkdirSync(path.join(s.appRoot, "0.8.0-s1"), { recursive: true });
    const r = await provisionWeb(APP, s.opts());
    expect(r.cacheHit).toBe(false);
    expect(fs.existsSync(path.join(r.dir, "index.html"))).toBe(true);
  });

  it("E12 a new shim version installs a new tree, leaves the old one, and moves `current`", async () => {
    const s = await setup();
    const r1 = await provisionWeb(APP, s.opts({ shimVersion: 1 }));
    const r2 = await provisionWeb(APP, s.opts({ shimVersion: 2 }));
    expect(path.basename(r1.dir)).toBe("0.8.0-s1");
    expect(path.basename(r2.dir)).toBe("0.8.0-s2");
    expect(fs.existsSync(path.join(r1.dir, "index.html"))).toBe(true);
    expect(fs.realpathSync(r2.current)).toBe(fs.realpathSync(r2.dir));
    expect(r2.shimVersion).toBe(2);
  });

  it("E12 postInstall runs once on the staging tree before the rename; its files ship in the final tree", async () => {
    const s = await setup();
    const seen: { dir: string; version: string; shimVersion: number; app: string; hadIndex: boolean }[] = [];
    const r = await provisionWeb(
      APP,
      s.opts({
        shimVersion: 3,
        postInstall: (c) => {
          seen.push({ dir: c.dir, version: c.version, shimVersion: c.shimVersion, app: c.app, hadIndex: fs.existsSync(path.join(c.dir, "index.html")) });
          fs.writeFileSync(path.join(c.dir, "craft-build.json"), JSON.stringify({ shimVersion: c.shimVersion }));
        },
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ version: "0.8.0", shimVersion: 3, app: "wordcraft", hadIndex: true });
    expect(seen[0].dir).not.toBe(r.dir);
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, "craft-build.json"), "utf8"))).toEqual({ shimVersion: 3 });
    await provisionWeb(APP, s.opts({ shimVersion: 3, postInstall: () => void seen.push(seen[0]) }));
    expect(seen).toHaveLength(1); // cache hit: no second post-install
  });

  it("E12 a failing postInstall installs nothing", async () => {
    const s = await setup();
    const e = await errOf(
      provisionWeb(
        APP,
        s.opts({
          postInstall: () => {
            throw new Error("boom");
          },
        }),
      ),
    );
    expect(e.code).toBe("extract-failed");
    expect(e.message).toContain("boom");
    expect(noInstalled(s.appRoot)).toBe(true);
  });

  it("sweeps stale staging dirs under <root>/<app>-web (>1h) and keeps fresh ones", async () => {
    const s = await setup();
    fs.mkdirSync(path.join(s.appRoot, ".staging-old"), { recursive: true });
    fs.mkdirSync(path.join(s.appRoot, ".staging-new"), { recursive: true });
    const t = (Date.now() - 2 * 3_600_000) / 1000;
    fs.utimesSync(path.join(s.appRoot, ".staging-old"), t, t);
    await provisionWeb(APP, s.opts());
    expect(fs.existsSync(path.join(s.appRoot, ".staging-old"))).toBe(false);
    expect(fs.existsSync(path.join(s.appRoot, ".staging-new"))).toBe(true);
  });

  it("X6 win32 swap: `current` is absent (503) only inside the window and never resolves to a partial tree", async () => {
    const s = await setup();
    const win = (o: Partial<ProvisionWebOptions> = {}) => s.opts({ platform: "win32", ...o });
    const r1 = await provisionWeb(APP, win({ shimVersion: 1 }));
    const current = path.join(s.appRoot, "current");
    expect(fs.realpathSync(current)).toBe(fs.realpathSync(r1.dir));
    const states: (string | null)[] = [];
    const sample = () => {
      try {
        states.push(fs.realpathSync(current));
      } catch {
        states.push(null);
      }
    };
    const r2 = await provisionWeb(APP, win({ shimVersion: 2, onSwapWindow: sample }));
    sample();
    expect(states).toEqual([null, fs.realpathSync(r2.dir)]);
    expect(fs.existsSync(path.join(fs.realpathSync(current), "index.html"))).toBe(true);
    expect(fs.readdirSync(s.appRoot).filter((n) => n.startsWith(".staging-"))).toEqual([]);
  });

  it("POSIX swap never has an absent `current` (symlink + rename)", async () => {
    const s = await setup();
    await provisionWeb(APP, s.opts({ shimVersion: 1 }));
    const seen: boolean[] = [];
    const r2 = await provisionWeb(APP, s.opts({ shimVersion: 2, onSwapWindow: () => seen.push(true) }));
    expect(seen).toEqual([]); // window hook is win32-only
    expect(fs.readlinkSync(path.join(s.appRoot, "current"))).toBe(path.basename(r2.dir));
  });
});

describe("provisionWeb report and failures", () => {
  it("E14 fresh install report", async () => {
    const s = await setup();
    const r = await provisionWeb(APP, s.opts({ shimVersion: 4 }));
    expect(r).toMatchObject({ app: "wordcraft", version: "0.8.0", source: "registry", asset: ZIP, cacheHit: false, shimVersion: 4 });
    expect(path.isAbsolute(r.dir)).toBe(true);
    expect(r.dir).toBe(path.join(s.appRoot, "0.8.0-s4"));
    expect(r.current).toBe(path.join(s.appRoot, "current"));
    expect(typeof r.durationMs).toBe("number");
    expect(s.logs.join("\n")).toContain(ZIP);
  });

  it("E14b a build zipped under one top-level directory is flattened to the install root", async () => {
    const s = await setup({
      [ZIP]: webZip({
        "wordcraft-web-0.8.0/index.html": INDEX,
        "wordcraft-web-0.8.0/app_bg.wasm": "wasm-bytes",
        "wordcraft-web-0.8.0/sub/x.js": "x",
      }),
    });
    const r = await provisionWeb(APP, s.opts());
    expect(fs.existsSync(path.join(r.dir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(r.dir, "sub", "x.js"))).toBe(true);
    expect(fs.existsSync(path.join(r.dir, "wordcraft-web-0.8.0"))).toBe(false);
  });

  it("X1 checksum mismatch fails closed: download deleted, nothing installed", async () => {
    const s = await setup(undefined, undefined, { sums: `${"0".repeat(64)}  ${ZIP}\n` });
    const e = await errOf(provisionWeb(APP, s.opts()));
    expect(e.code).toBe<WebErrorCode>("checksum-mismatch");
    expect(noInstalled(s.appRoot)).toBe(true);
    expect(fs.readdirSync(s.appRoot).filter((n) => n.startsWith(".staging-"))).toEqual([]);
  });

  it("X1b missing SHA256SUMS.txt fails closed", async () => {
    const s = await setup(undefined, undefined, { sums: null });
    const e = await errOf(provisionWeb(APP, s.opts()));
    expect(e.code).toBe("release-unavailable");
    expect(noInstalled(s.appRoot)).toBe(true);
  });

  it("an unreachable GitHub is `offline`; a missing asset is `release-unavailable`", async () => {
    const s = await setup();
    const e = await errOf(provisionWeb(APP, s.opts({ apiBase: "http://127.0.0.1:1" })));
    expect(e.code).toBe<WebErrorCode>("offline");
    const s2 = await setup({ "other.zip": webZip() });
    expect((await errOf(provisionWeb(APP, s2.opts()))).code).toBe("release-unavailable");
  });

  it("rejects a non-positive shimVersion", async () => {
    const s = await setup();
    await expect(provisionWeb(APP, s.opts({ shimVersion: 0 }))).rejects.toThrow("shimVersion");
  });
});

// See change: track-latest-craft-web-version (D1, D2).
describe("provisionWeb latest channel", () => {
  const ZIP9 = "wordcraft-web-0.9.0.zip";
  const latestCalls = (s: Awaited<ReturnType<typeof setup>>) => s.fx.requests.filter((q) => q.url.endsWith("/releases/latest")).length;

  it("channel latest installs the latest web build, then serves it from the 24 h cache", async () => {
    const s = await setup({ [ZIP9]: webZip() }, "v0.9.0");
    const r = await provisionWeb(APP, s.opts({ channel: "latest" }));
    expect(r).toMatchObject({ version: "0.9.0", source: "latest", asset: ZIP9, cacheHit: false });
    expect(s.fx.requests.some((q) => q.url.includes("/releases/tags/"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(s.appRoot, "latest.json"), "utf8")).tag).toBe("v0.9.0");
    const r2 = await provisionWeb(APP, s.opts({ channel: "latest" }));
    expect(r2).toMatchObject({ version: "0.9.0", source: "latest-cached", cacheHit: true });
    expect(latestCalls(s)).toBe(1);
  });

  it("WEB_VERSION=latest (any case) selects the latest channel", async () => {
    const s = await setup({ [ZIP9]: webZip() }, "v0.9.0");
    const r = await provisionWeb(APP, s.opts({ env: s.envWith({ WORDCRAFT_WEB_VERSION: " Latest " }) }));
    expect(r).toMatchObject({ version: "0.9.0", source: "latest" });
  });

  it("an explicit WEB_VERSION pin beats the latest channel", async () => {
    const s = await setup();
    const r = await provisionWeb(APP, s.opts({ channel: "latest", env: s.envWith({ WORDCRAFT_WEB_VERSION: "0.8.0" }) }));
    expect(r).toMatchObject({ version: "0.8.0", source: "env-version" });
    expect(latestCalls(s)).toBe(0);
  });

  it("channel pinned (default) never asks for latest", async () => {
    const s = await setup();
    const r = await provisionWeb(APP, s.opts({ channel: "pinned" }));
    expect(r.source).toBe("registry");
    expect(latestCalls(s)).toBe(0);
  });

  it("a latest release without a web asset falls back to the registry pin, warns, and is not cached", async () => {
    const s = await setup({ "wordcraft-cli-0.9.0.tar.gz": Buffer.from("x") }, "v0.9.0");
    const e = await errOf(provisionWeb(APP, s.opts({ channel: "latest" })));
    // The fixture only serves tag v0.9.0, so the registry fallback (v0.8.0) is unavailable — proving it was chosen.
    expect(e.code).toBe<WebErrorCode>("release-unavailable");
    expect(s.fx.requests.map((q) => q.url)).toContain("/repos/storytold/wordcraft/releases/tags/v0.8.0");
    expect(s.logs.some((l) => /latest/.test(l) && /0\.8\.0/.test(l))).toBe(true);
    expect(fs.existsSync(path.join(s.appRoot, "latest.json"))).toBe(false);
  });

  it("a failed latest lookup uses the newest installed tree for the current shim, with no download", async () => {
    const s = await setup({ [ZIP9]: webZip() }, "v0.9.0", { latestStatus: 500 });
    for (const key of ["0.8.5-s1", "0.9.0-s1", "1.0.0-s2"]) {
      fs.mkdirSync(path.join(s.appRoot, key), { recursive: true });
      fs.writeFileSync(path.join(s.appRoot, key, "index.html"), INDEX);
    }
    const r = await provisionWeb(APP, s.opts({ channel: "latest" }));
    expect(r).toMatchObject({ version: "0.9.0", source: "fallback-installed", cacheHit: true });
    expect(s.downloads()).toHaveLength(0);
  });

  it("latestWebVersion is metadata-only and honours the cache", async () => {
    const s = await setup({ [ZIP9]: webZip() }, "v0.9.0");
    expect(await latestWebVersion(APP, s.opts())).toBe("0.9.0");
    expect(await latestWebVersion(APP, s.opts())).toBe("0.9.0");
    expect(latestCalls(s)).toBe(1);
    expect(s.downloads()).toHaveLength(0);
    const s2 = await setup({ "other.zip": webZip() }, "v0.9.0");
    expect(await latestWebVersion(APP, s2.opts())).toBeUndefined();
    const s3 = await setup(undefined, undefined, { latestStatus: 500 });
    expect(await latestWebVersion(APP, s3.opts())).toBeUndefined();
  });
});
