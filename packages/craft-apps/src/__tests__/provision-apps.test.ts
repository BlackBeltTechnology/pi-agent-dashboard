import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheRoot, craftRoot, craftSource, provision } from "../provision.js";
import { getApp } from "../registry.js";
import { cleanupTmp, type Fixture, makeTarGz, STUB_BINARY, startFixture, tmpDir } from "./helpers/fixtures.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  cleanupTmp();
});

const logs: string[] = [];
const base = (home: string, extra: Record<string, unknown> = {}) => ({
  env: { CRAFT_HOME: home } as NodeJS.ProcessEnv,
  platform: "linux" as const,
  arch: "x64",
  glibcVersion: () => "2.99",
  log: (m: string) => logs.push(m),
  ...extra,
});
const asset = (id: string, cliOnly = false) => `${id}${cliOnly ? "-cli" : ""}-0.7.0-linux-x86_64.tar.gz`;
const archive = (id: string, top: string) => makeTarGz({ [`${top}/bin/${id}-cli`]: STUB_BINARY, [`${top}/bin/${id}`]: STUB_BINARY });

async function fixture(id: string, assets: Record<string, Buffer>) {
  const fx = await startFixture({ repo: `storytold/${id}`, assets });
  fixtures.push(fx);
  return fx;
}

describe("cross-app behaviour", () => {
  it("unknown app id fails without any network request and lists the 13 ids", async () => {
    const fx = await fixture("photocraft", {});
    const e = await provision("paintcraft", base(tmpDir(), { apiBase: fx.url })).catch((x: Error) => x);
    expect((e as Error).message).toContain("paintcraft");
    for (const id of ["photocraft", "gridcraft", "cadcraft"]) expect((e as Error).message).toContain(id);
    expect(fx.requests).toHaveLength(0);
  });

  it("pins are per app: another app's pin is not applied", async () => {
    const fx = await fixture("soundcraft", { [asset("soundcraft")]: archive("soundcraft", "soundcraft-0.7.0-linux-x86_64") });
    const home = tmpDir();
    const r = await provision("soundcraft", base(home, { apiBase: fx.url, env: { CRAFT_HOME: home, EFFECTCRAFT_VERSION: "9.9.9" } }));
    expect(r).toMatchObject({ app: "soundcraft", version: "0.7.0", source: "latest" });
  });

  it("CRAFT_HOME is the root; default is <pi agent dir>/tools; PHOTOCRAFT_HOME only moves photocraft", () => {
    const deps = (env: NodeJS.ProcessEnv) => ({ env, homedir: () => "/h" });
    expect(craftRoot(deps({}))).toBe(path.join("/h", ".pi", "agent", "tools"));
    expect(craftRoot(deps({ PI_CODING_AGENT_DIR: "/agent" }))).toBe(path.join("/agent", "tools"));
    expect(craftRoot(deps({ CRAFT_HOME: "/c" }))).toBe("/c");
    expect(cacheRoot(getApp("filmcraft"), deps({ CRAFT_HOME: "/c" }))).toBe(path.join("/c", "filmcraft"));
    expect(cacheRoot(getApp("photocraft"), deps({ PHOTOCRAFT_HOME: "/p", CRAFT_HOME: "/c" }))).toBe("/p");
    expect(cacheRoot(getApp("filmcraft"), deps({ PHOTOCRAFT_HOME: "/p" }))).toBe(path.join("/h", ".pi", "agent", "tools", "filmcraft"));
  });

  it("an existing PhotoCraft cache from the previous package is a cache hit (no download)", async () => {
    const fx = await fixture("photocraft", {});
    const agent = tmpDir();
    const dir = path.join(agent, "tools", "photocraft", "0.8.2", "photocraft-0.8.2-linux-x86_64", "bin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "photocraft-cli"), STUB_BINARY, { mode: 0o755 });
    const r = await provision("photocraft", base(agent, { apiBase: fx.url, env: { PI_CODING_AGENT_DIR: agent, PHOTOCRAFT_VERSION: "0.8.2" } }));
    expect(r).toMatchObject({ app: "photocraft", version: "0.8.2", cacheHit: true, source: "pin" });
    expect(fx.requests.filter((q) => q.url.startsWith("/download"))).toHaveLength(0);
  });

  it("Linux prefers a CLI-only tarball when the release has one, else falls back to the portable one", async () => {
    const withCli = await fixture("pdfcraft", {
      [asset("pdfcraft", true)]: archive("pdfcraft", "pdfcraft-cli-0.7.0-linux-x86_64"),
      [asset("pdfcraft")]: archive("pdfcraft", "pdfcraft-0.7.0-linux-x86_64"),
    });
    const r = await provision("pdfcraft", base(tmpDir(), { apiBase: withCli.url }));
    expect(r.asset).toBe(asset("pdfcraft", true));
    const portableOnly = await fixture("soundcraft", { [asset("soundcraft")]: archive("soundcraft", "soundcraft-0.7.0-linux-x86_64") });
    const r2 = await provision("soundcraft", base(tmpDir(), { apiBase: portableOnly.url }));
    expect(r2.asset).toBe(asset("soundcraft"));
  });

  it("a cache hit reports the asset that produced the install", async () => {
    const fx = await fixture("pdfcraft", { [asset("pdfcraft", true)]: archive("pdfcraft", "pdfcraft-cli-0.7.0-linux-x86_64") });
    const home = tmpDir();
    await provision("pdfcraft", base(home, { apiBase: fx.url }));
    const again = await provision("pdfcraft", base(home, { apiBase: fx.url, env: { CRAFT_HOME: home, PDFCRAFT_VERSION: "0.7.0" } }));
    expect(again).toMatchObject({ cacheHit: true, asset: asset("pdfcraft", true) });
  });

  it("different apps provisioned concurrently each get their own <root>/<app>/<version>/", async () => {
    const w = await fixture("wordcraft", { [asset("wordcraft")]: archive("wordcraft", "t1") });
    const d = await fixture("deckcraft", { [asset("deckcraft")]: archive("deckcraft", "t2") });
    const home = tmpDir();
    const [a, b] = await Promise.all([
      provision("wordcraft", base(home, { apiBase: w.url })),
      provision("deckcraft", base(home, { apiBase: d.url })),
    ]);
    expect(a.binary).toBe(path.join(home, "wordcraft", "0.7.0", "t1", "bin", "wordcraft-cli"));
    expect(b.binary).toBe(path.join(home, "deckcraft", "0.7.0", "t2", "bin", "deckcraft-cli"));
    expect(fs.existsSync(a.binary) && fs.existsSync(b.binary)).toBe(true);
  });

  it("fresh install report carries app, source, asset, cacheHit, binary and duration", async () => {
    const fx = await fixture("soundcraft", { [asset("soundcraft")]: archive("soundcraft", "t") });
    const r = await provision("soundcraft", base(tmpDir(), { apiBase: fx.url }));
    expect(r).toMatchObject({ app: "soundcraft", version: "0.7.0", source: "latest", asset: asset("soundcraft"), cacheHit: false });
    expect(path.isAbsolute(r.binary)).toBe(true);
    expect(typeof r.durationMs).toBe("number");
  });
});

describe("CRAFT_SOURCE", () => {
  it("defaults to managed; rejects unknown values", () => {
    expect(craftSource({})).toBe("managed");
    expect(craftSource({ CRAFT_SOURCE: "AUTO" })).toBe("auto");
    expect(() => craftSource({ CRAFT_SOURCE: "cloud" })).toThrow(/managed, launcher or auto/);
  });

  it("launcher source never downloads and fails naming the app, pi-craft launcher install and CRAFT_SOURCE=managed", async () => {
    const fx = await fixture("cadcraft", { [asset("cadcraft")]: archive("cadcraft", "t") });
    const home = tmpDir();
    const e = await provision(
      "cadcraft",
      base(home, { apiBase: fx.url, homedir: () => home, env: { CRAFT_HOME: home, CRAFT_SOURCE: "launcher", CRAFT_LAUNCHER_HOME: path.join(home, "none") } }),
    ).catch((x: Error) => x);
    const m = (e as Error).message;
    expect(m).toContain("CADCraft");
    expect(m).toContain("pi-craft launcher install");
    expect(m).toContain("CRAFT_SOURCE=managed");
    expect(fx.requests).toHaveLength(0);
  });

  it("launcher source uses a CLI found in the launcher install and reports source launcher", async () => {
    const home = tmpDir();
    const apps = path.join(home, "apps");
    const dir = path.join(apps, "CADCraft");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cadcraft-cli"), '#!/bin/sh\necho "cadcraft-cli 0.7.0"\n', { mode: 0o755 });
    const r = await provision("cadcraft", base(home, { env: { CRAFT_HOME: home, CRAFT_SOURCE: "launcher", CRAFT_LAUNCHER_HOME: apps }, homedir: () => home }));
    expect(r).toMatchObject({ app: "cadcraft", source: "launcher", asset: null, version: "0.7.0", cacheHit: false });
    expect(r.binary).toBe(path.join(dir, "cadcraft-cli"));
  });

  it("auto falls back to managed when the launcher has not installed the app", async () => {
    const fx = await fixture("figcraft", { [asset("figcraft")]: archive("figcraft", "t") });
    const home = tmpDir();
    const r = await provision(
      "figcraft",
      base(home, { apiBase: fx.url, homedir: () => home, env: { CRAFT_HOME: home, CRAFT_SOURCE: "auto", CRAFT_LAUNCHER_HOME: path.join(home, "none") } }),
    );
    expect(r).toMatchObject({ app: "figcraft", source: "latest", cacheHit: false });
  });

  it("a per-app override beats every source", async () => {
    const home = tmpDir();
    const bin = path.join(home, "fc");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    const r = await provision("filmcraft", base(home, { env: { CRAFT_HOME: home, CRAFT_SOURCE: "launcher", FILMCRAFT_BIN: bin } }));
    expect(r).toMatchObject({ app: "filmcraft", source: "override" });
  });

  it("an installed-but-CLI-less launcher app (macOS reality) is reported as desktop-only", async () => {
    const home = tmpDir();
    const apps = path.join(home, "Applications");
    fs.mkdirSync(path.join(apps, "FilmCraft.app", "Contents", "MacOS"), { recursive: true });
    fs.writeFileSync(path.join(apps, "FilmCraft.app", "Contents", "MacOS", "FilmCraft"), "gui", { mode: 0o755 });
    const e = await provision(
      "filmcraft",
      base(home, { platform: "darwin", homedir: () => home, env: { CRAFT_HOME: home, CRAFT_SOURCE: "launcher", CRAFT_LAUNCHER_HOME: apps } }),
    ).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/FilmCraft is installed by the Craft Launcher.*ships no filmcraft-cli \(desktop app only\)/);
  });
});

describe("review round 1 follow-ups", () => {
  it("prerelease cache directories count as installed (offline fallback + status)", async () => {
    const fx = await startFixture({ repo: "storytold/effectcraft", assets: {}, latestStatus: 403 });
    fixtures.push(fx);
    const home = tmpDir();
    const dir = path.join(home, "effectcraft", "0.10.0-beta.1", "top", "bin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "effectcraft-cli"), STUB_BINARY, { mode: 0o755 });
    const r = await provision("effectcraft", base(home, { apiBase: fx.url }));
    expect(r).toMatchObject({ version: "0.10.0-beta.1", source: "fallback-installed", cacheHit: true });
  });

  it("a version pin that the launcher source ignores is called out on stderr", async () => {
    const home = tmpDir();
    const apps = path.join(home, "apps");
    fs.mkdirSync(path.join(apps, "CADCraft"), { recursive: true });
    fs.writeFileSync(path.join(apps, "CADCraft", "cadcraft-cli"), '#!/bin/sh\necho "cadcraft-cli 0.7.0"\n', { mode: 0o755 });
    const logs: string[] = [];
    await provision("cadcraft", {
      ...base(home),
      homedir: () => home,
      log: (m) => logs.push(m),
      env: { CRAFT_HOME: home, CRAFT_SOURCE: "launcher", CRAFT_LAUNCHER_HOME: apps, CADCRAFT_VERSION: "0.6.0" },
    });
    expect(logs.join("\n")).toMatch(/CADCRAFT_VERSION=0\.6\.0 is ignored by the launcher source/);
  });
});
