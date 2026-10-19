/**
 * Add-ons hub folder mode: `GET /api/addons/catalog?scope=local&cwd=` and
 * `POST /api/addons/:id/toggle` with `scope: "local"`.
 * See change: addons-hub-folder-view (test-plan #E1–#E15, #P1, #X1–#X5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real trust store reads the real `~/.pi/agent`; the follow-up decision must not write it.
const persistTrustDecision = vi.fn(async () => {});
vi.mock("../pi/resource-toggle-trust.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pi/resource-toggle-trust.js")>();
  return { ...actual, persistTrustDecision: (...a: unknown[]) => (persistTrustDecision as (...x: unknown[]) => unknown)(...a) };
});

import { __resetTrustChallenges, registerResourceActivationRoutes } from "../routes/resource-activation-routes.js";
import { AddonsEnv } from "./addons-fixture.js";

const WEB = "npm:pi-web-access";
const WEB_ID = "pkg:npm:pi-web-access";
const GOAL_PKG = "@ricoyudog/pi-goal-hermes";
const GOAL_SRC = `npm:${GOAL_PKG}`;
const delta = (source: string) => ({ source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] });

let env: AddonsEnv;
afterEach(async () => {
  await env?.cleanup();
  __resetTrustChallenges();
  persistTrustDecision.mockClear();
});

const feat = (features: any[], id: string) => features.find((f) => f.id === id);
const state = async (cwd: string, id = WEB_ID) => feat((await env.folderCatalog(cwd)).body.features, id)?.folderState;

/** One global package feature `pkg:npm:pi-web-access` + a trusted folder. */
async function webEnv(name: string, opts: Parameters<AddonsEnv["makeApp"]>[0] = {}) {
  env = new AddonsEnv(name);
  env.addPackage(WEB, { name: "pi-web-access" });
  env.writeSettings({ keep: "me", packages: [WEB] });
  const cwd = env.makeFolder("repo");
  await env.makeApp(opts);
  return cwd;
}

describe("folder catalog: roll-up", () => {
  // test-plan #E1
  it("decision table: project entry × global toggle", async () => {
    const entries: Array<[string, unknown, string, string]> = [
      ["none/on", undefined, "on", "inherited"],
      ["normal/on", WEB, "on", "added-here"],
      ["all-empty/on", delta(WEB), "on", "off-here"],
      ["narrowing/on", { source: WEB, autoload: false, skills: ["-x"] }, "on", "partly-off-here"],
      ["none/off", undefined, "off", "off-globally"],
      ["normal/off", WEB, "off", "added-here"],
      ["all-empty/off", delta(WEB), "off", "off-here"],
      ["narrowing/off", { source: WEB, autoload: false, skills: ["-x"] }, "off", "partly-off-here"],
    ];
    for (const [label, entry, global, want] of entries) {
      env = new AddonsEnv("e1");
      env.addPackage(WEB, { name: "pi-web-access" });
      env.writeSettings({
        packages: [global === "off" ? { source: WEB, extensions: [], skills: [], prompts: [], themes: [] } : WEB],
      });
      env.addPlugin({ id: "ui", enabled: true });
      const cwd = env.makeFolder("repo");
      if (entry !== undefined) env.writeFolderSettings(cwd, { packages: [entry] });
      await env.makeApp();
      const body = (await env.folderCatalog(cwd)).body;
      expect(feat(body.features, WEB_ID)?.folderState, label).toBe(want);
      // a feature with no pi part
      expect(feat(body.features, "plugin:ui")?.folderState, label).toBe("dashboard-only");
      await env.cleanup();
    }
  });

  // test-plan #E2
  it("multi-package feature: one package off is partly-off-here, both off-here", async () => {
    env = new AddonsEnv("e2");
    env.addPlugin({ id: "goal", packageName: "@bb/goal-plugin", requires: [GOAL_PKG, "other-pkg"] });
    env.addPackage(GOAL_SRC, { name: GOAL_PKG });
    env.addPackage("npm:other-pkg", { name: "other-pkg" });
    env.writeSettings({ packages: [GOAL_SRC, "npm:other-pkg"] });
    const cwd = env.makeFolder("repo");
    env.writeFolderSettings(cwd, { packages: [delta(GOAL_SRC)] });
    await env.makeApp();
    expect(await state(cwd, "plugin:goal")).toBe("partly-off-here");
    env.writeFolderSettings(cwd, { packages: [delta(GOAL_SRC), delta("npm:other-pkg")] });
    expect(await state(cwd, "plugin:goal")).toBe("off-here");
  });

  // test-plan #E3
  it("a repo loading one extension of itself is added-here with a loading count", async () => {
    env = new AddonsEnv("e3");
    const repo = env.makeFolder("repo");
    fs.mkdirSync(path.join(repo, "exts"), { recursive: true });
    for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(repo, "exts", `${n}.ts`), "export default {};\n");
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "self-repo", version: "1.0.0", pi: { extensions: ["exts"] } }),
    );
    env.addPackage(repo, { dir: repo });
    env.writeSettings({ packages: [repo] });
    env.writeFolderSettings(repo, { packages: [{ source: "..", extensions: ["+exts/a.ts"] }] });
    await env.makeApp();
    const f = feat((await env.folderCatalog(repo)).body.features, `pkg:local:${repo}`);
    expect(f.folderState).toBe("added-here");
    expect(f.loading).toEqual({ loaded: 1, total: 3 });
  });

  // test-plan #E4
  it("missing project file → inherited; unparseable → settingsError and no folder state", async () => {
    const cwd = await webEnv("e4");
    const a = await env.folderCatalog(cwd);
    expect(a.status).toBe(200);
    expect(feat(a.body.features, WEB_ID).folderState).toBe("inherited");
    expect(a.body.folder.settingsError).toBeUndefined();

    env.writeFolderSettings(cwd, '{ "packages": [');
    const b = await env.folderCatalog(cwd);
    expect(b.status).toBe(200);
    expect(b.body.folder.settingsError).toBeTruthy();
    expect(feat(b.body.features, WEB_ID).folderState).toBe("inherited");
  });

  // test-plan #E5
  it("counts loose .pi resources and package-contributed agents", async () => {
    env = new AddonsEnv("e5");
    const pkgDir = env.addPackage(WEB, { name: "pi-web-access" });
    fs.mkdirSync(path.join(pkgDir, "agents"), { recursive: true });
    for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(pkgDir, "agents", `${n}.md`), `---\nname: ${n}\n---\nx`);
    env.writeSettings({ packages: [WEB] });
    const cwd = env.makeFolder("repo");
    const pi = path.join(cwd, ".pi");
    for (let i = 0; i < 29; i++) {
      fs.mkdirSync(path.join(pi, "skills", `s${i}`), { recursive: true });
      fs.writeFileSync(path.join(pi, "skills", `s${i}`, "SKILL.md"), `---\nname: s${i}\n---\nx`);
    }
    fs.mkdirSync(path.join(pi, "agents"), { recursive: true });
    for (const n of ["x", "y"]) fs.writeFileSync(path.join(pi, "agents", `${n}.md`), `---\nname: ${n}\n---\nx`);
    fs.mkdirSync(path.join(pi, "prompts"), { recursive: true });
    fs.writeFileSync(path.join(pi, "prompts", "p.md"), "hi");
    await env.makeApp();
    const res = await env.folderCatalog(cwd);
    expect(res.body.folder.looseCounts).toEqual({ skills: 29, agents: 2, prompts: 1, extensions: 0, themes: 0 });
    expect(feat(res.body.features, WEB_ID).packageAgents).toBe(3);
  });

  // test-plan #E6
  it("cwd must be absolute, normalised and admitted; an untrusted folder still reads", async () => {
    const cwd = await webEnv("e6");
    const get = (c: string) =>
      env.app!.inject({ method: "GET", url: `/api/addons/catalog?scope=local&cwd=${encodeURIComponent(c)}` });
    expect((await get("repo")).statusCode).toBe(400);
    expect((await get("/a/../b")).statusCode).toBe(400);
    const stranger = fs.mkdtempSync(path.join(os.tmpdir(), "addons-stranger-"));
    try {
      expect((await get(stranger)).statusCode).toBe(403);
    } finally {
      fs.rmSync(stranger, { recursive: true, force: true });
    }
    // trust is a write concern: the read of a known, untrusted folder is 200
    expect((await get(cwd)).statusCode).toBe(200);
    expect((await env.app!.inject({ method: "GET", url: "/api/addons/catalog?scope=bogus" })).statusCode).toBe(400);
  });

  it("restoreRecorded is true once the off packages have a record", async () => {
    const cwd = await webEnv("restore-flag");
    await env.folderToggle(WEB_ID, cwd, false);
    expect(feat((await env.folderCatalog(cwd)).body.features, WEB_ID).restoreRecorded).toBe(true);
    env.writeFolderSettings(cwd, { packages: [delta(WEB)] });
    fs.rmSync(env.restoreFile);
    expect(feat((await env.folderCatalog(cwd)).body.features, WEB_ID).restoreRecorded).toBe(false);
  });

  it("a folder-only package becomes an added-here feature with project scope", async () => {
    env = new AddonsEnv("folder-only");
    env.writeSettings({ packages: [] });
    const cwd = env.makeFolder("repo");
    env.addFolderPackage("npm:only-here", { name: "only-here" });
    env.writeFolderSettings(cwd, { packages: ["npm:only-here"] });
    await env.makeApp();
    const f = feat((await env.folderCatalog(cwd)).body.features, "pkg:npm:only-here");
    expect(f.folderState).toBe("added-here");
    expect(f.packages[0].scope).toBe("project");
  });
});

describe("folder catalog: latency", () => {
  // test-plan #P1
  it("p95 < 300 ms with 50 features and 500 loose files", async () => {
    env = new AddonsEnv("p1");
    const sources: string[] = [];
    for (let i = 0; i < 50; i++) {
      env.addPackage(`npm:pkg-${i}`, { name: `pkg-${i}` });
      sources.push(`npm:pkg-${i}`);
    }
    env.writeSettings({ packages: sources });
    const cwd = env.makeFolder("repo");
    const pi = path.join(cwd, ".pi");
    for (const kind of ["skills", "prompts", "agents", "extensions"]) fs.mkdirSync(path.join(pi, kind), { recursive: true });
    for (let i = 0; i < 125; i++) {
      fs.writeFileSync(path.join(pi, "skills", `s${i}.md`), `---\nname: s${i}\n---\nx`);
      fs.writeFileSync(path.join(pi, "prompts", `p${i}.md`), "hi");
      fs.writeFileSync(path.join(pi, "agents", `a${i}.md`), `---\nname: a${i}\n---\nx`);
      fs.writeFileSync(path.join(pi, "extensions", `e${i}.ts`), "export default {};\n");
    }
    env.writeFolderSettings(cwd, { packages: [delta("npm:pkg-3"), { source: "npm:pkg-4", autoload: false, skills: ["-x"] }] });
    await env.makeApp();
    for (let i = 0; i < 3; i++) await env.folderCatalog(cwd);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const res = await env.folderCatalog(cwd);
      times.push(performance.now() - t);
      expect(res.status).toBe(200);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(300);
  });
});

describe("folder toggle: write form", () => {
  // test-plan #E7
  it("turn off writes exactly the all-empty delta, global file untouched, one log line", async () => {
    const cwd = await webEnv("e7");
    const globalBefore = fs.readFileSync(env.settingsFile, "utf-8");
    const res = await env.folderToggle(WEB_ID, cwd, false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, changed: true, filtered: [WEB], keptOn: [] });
    expect(env.readFolderSettings(cwd).packages).toEqual([delta(WEB)]);
    expect(fs.readFileSync(env.settingsFile, "utf-8")).toBe(globalBefore);
    const lines = env.logs.info.filter((l) => l.includes("folder toggle"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(WEB_ID);
    expect(lines[0]).toContain(cwd);
    expect(lines[0]).toContain(WEB);
    expect(await state(cwd)).toBe("off-here");
  });

  // test-plan #E8
  it("a plugin feature off here writes only its package delta; the plugin stays enabled", async () => {
    env = new AddonsEnv("e8");
    env.addPlugin({ id: "goal", packageName: "@bb/goal-plugin", requires: [GOAL_PKG], bridge: true });
    env.addPackage(GOAL_SRC, { name: GOAL_PKG });
    env.writeSettings({ packages: [GOAL_SRC] });
    const cwd = env.makeFolder("repo");
    await env.makeApp();
    const res = await env.folderToggle("plugin:goal", cwd, false);
    expect(res.status).toBe(200);
    expect(res.body.filtered).toEqual([GOAL_SRC]);
    expect(res.body.keptOn).toEqual([]);
    expect(env.readFolderSettings(cwd).packages).toEqual([delta(GOAL_SRC)]);
    expect(env.readPluginConfig().goal?.enabled).toBe(true);
  });

  // test-plan #E9
  it.each([
    ["on", true],
    ["partial", true],
    ["off", false],
  ])("keptOn: requiring plugin B is %s", async (kind, kept) => {
    env = new AddonsEnv("e9");
    env.addPlugin({ id: "b", packageName: "@bb/b-plugin", requires: ["x"], enabled: kind !== "off" });
    env.addPlugin({ id: "c", packageName: "@bb/c-plugin", requires: ["x"], enabled: false });
    env.addPackage("npm:x", { name: "x" });
    const pkgs: unknown[] = ["npm:x"];
    if (kind === "partial") {
      env.addPackage("npm:@bb/b-plugin", { name: "@bb/b-plugin" });
      pkgs.push({ source: "npm:@bb/b-plugin", extensions: [], skills: [], prompts: [], themes: [] });
    }
    env.writeSettings({ packages: pkgs });
    const cwd = env.makeFolder("repo");
    await env.makeApp();
    const before = env.folderSettingsRaw(cwd);
    const res = await env.folderToggle("pkg:npm:x", cwd, false);
    expect(res.status).toBe(200);
    if (kept) {
      expect(res.body.changed).toBe(false);
      expect(res.body.keptOn).toEqual([{ source: "npm:x", by: ["plugin:b"] }]);
      expect(env.folderSettingsRaw(cwd)).toBe(before);
    } else {
      expect(res.body.changed).toBe(true);
      expect(env.readFolderSettings(cwd).packages).toEqual([delta("npm:x")]);
    }
  });
});

describe("folder toggle: record and restore", () => {
  const NARROW = { source: WEB, autoload: false, skills: ["-skills/a"] };

  // test-plan #E10
  it("off → off → on restores the exact narrowing entry", async () => {
    const cwd = await webEnv("e10");
    env.writeFolderSettings(cwd, { packages: [NARROW] });
    await env.folderToggle(WEB_ID, cwd, false);
    expect(env.readFolderSettings(cwd).packages).toEqual([delta(WEB)]);
    await env.folderToggle(WEB_ID, cwd, false);
    const recs = Object.values(env.readRestore()?.records ?? {});
    expect(recs).toHaveLength(1);
    expect(recs[0].original).toEqual(NARROW);
    const res = await env.folderToggle(WEB_ID, cwd, true);
    expect(res.body.restored).toEqual([WEB]);
    expect(env.readFolderSettings(cwd).packages).toEqual([NARROW]);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
  });

  it("off then on with no previous entry removes the entry and leaves the file as before", async () => {
    const cwd = await webEnv("e10b");
    env.writeFolderSettings(cwd, { other: 1, packages: ["npm:keep"] });
    await env.folderToggle(WEB_ID, cwd, false);
    await env.folderToggle(WEB_ID, cwd, true);
    expect(env.readFolderSettings(cwd)).toEqual({ other: 1, packages: ["npm:keep"] });
    expect(await state(cwd)).toBe("inherited");
  });

  // test-plan #E11
  it("a hand-written all-empty delta is notOwned; removeUnowned removes it; a normal entry never", async () => {
    const cwd = await webEnv("e11");
    env.writeFolderSettings(cwd, { packages: [delta(WEB)] });
    const a = await env.folderToggle(WEB_ID, cwd, true);
    expect(a.status).toBe(200);
    expect(a.body.notOwned).toEqual([{ source: WEB, reason: "no-record", entry: delta(WEB) }]);
    expect(env.readFolderSettings(cwd).packages).toEqual([delta(WEB)]);
    const b = await env.folderToggle(WEB_ID, cwd, true, { removeUnowned: true });
    expect(b.body.removed).toEqual([WEB]);
    expect(env.folderSettingsRaw(cwd)).not.toContain(WEB);

    env.writeFolderSettings(cwd, { packages: [WEB] });
    const c = await env.folderToggle(WEB_ID, cwd, true, { removeUnowned: true });
    expect(c.body.removed).toEqual([]);
    expect(env.readFolderSettings(cwd).packages).toEqual([WEB]);
  });

  // test-plan #E12
  it("an entry edited after off is not clobbered; removeUnowned removes it", async () => {
    const cwd = await webEnv("e12");
    await env.folderToggle(WEB_ID, cwd, false);
    const edited = { source: WEB, autoload: false, skills: [] };
    env.writeFolderSettings(cwd, { packages: [edited] });
    const a = await env.folderToggle(WEB_ID, cwd, true);
    expect(a.body.notOwned).toEqual([{ source: WEB, reason: "edited", entry: edited }]);
    expect(env.readFolderSettings(cwd).packages).toEqual([edited]);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
    const b = await env.folderToggle(WEB_ID, cwd, true, { removeUnowned: true });
    expect(b.body.removed).toEqual([WEB]);
    expect(env.folderSettingsRaw(cwd)).not.toContain(WEB);
  });

  // test-plan #E13
  it("4xx matrix", async () => {
    env = new AddonsEnv("e13");
    env.addPlugin({ id: "ui" });
    env.addPackage(WEB, { name: "pi-web-access" });
    env.addPackage("npm:gone", { name: "gone" });
    env.addPackage("npm:here", { name: "here" });
    env.writeSettings({
      packages: [WEB, { source: "npm:gone", extensions: [], skills: [], prompts: [], themes: [] }, "npm:here"],
    });
    const cwd = env.makeFolder("repo");
    env.writeFolderSettings(cwd, { packages: ["npm:here"] });
    await env.makeApp();
    const before = env.folderSettingsRaw(cwd);
    const cases: Array<[string, number]> = [
      ["plugin:ui", 400],
      ["pkg:npm:gone", 400],
      ["core:pi", 400],
      ["pkg:npm:here", 400],
      ["pkg:npm:nope", 404],
    ];
    for (const [id, status] of cases) expect((await env.folderToggle(id, cwd, false)).status, id).toBe(status);
    expect(env.folderSettingsRaw(cwd)).toBe(before);
    expect(env.readRestore()).toBeUndefined();
  });

  // test-plan #E14
  it("a relative global source is written as an absolute path", async () => {
    env = new AddonsEnv("e14");
    const ext = path.join(env.home, ".pi", "src", "my-ext");
    fs.mkdirSync(ext, { recursive: true });
    env.addPackage("../src/my-ext", { dir: ext, name: "my-ext" });
    env.writeSettings({ packages: [{ source: "../src/my-ext" }] });
    const cwd = env.makeFolder("repo");
    await env.makeApp();
    const id = `pkg:local:${ext}`;
    expect(feat((await env.folderCatalog(cwd)).body.features, id)).toBeTruthy();
    const res = await env.folderToggle(id, cwd, false);
    expect(res.status).toBe(200);
    expect(env.readFolderSettings(cwd).packages).toEqual([delta(ext)]);
    expect(await state(cwd, id)).toBe("off-here");
  });

  // test-plan #E15
  it("a symlinked folder reads the record it wrote (canonical key)", async () => {
    const cwd = await webEnv("e15");
    const link = path.join(env.home, "link");
    fs.symlinkSync(cwd, link);
    const narrow = { source: WEB, autoload: false, skills: ["-skills/a"] };
    env.writeFolderSettings(cwd, { packages: [narrow] });
    expect((await env.folderToggle(WEB_ID, link, false)).status).toBe(200);
    expect((await env.folderToggle(WEB_ID, cwd, true)).status).toBe(200);
    expect(env.readFolderSettings(cwd).packages).toEqual([narrow]);
  });
});

describe("folder toggle: trust and faults", () => {
  const prompt = (message: string) => async () => ({
    outcome: "prompt" as const,
    options: [{ id: "trust" as const, label: "Trust", trusted: true, updates: [] }],
    implicitlyTrusted: false,
    message,
  });

  // test-plan #X1
  it.each([
    ["default ask", "pi only applies a folder's .pi/settings.json when the folder is trusted."],
    ["inherited refusal", "A parent folder is recorded as not trusted."],
  ])("a needed trust decision is 403 trustRequired, writes nothing, registers the challenge (%s)", async (_l, message) => {
    const cwd = await webEnv("x1", { resolveTrust: prompt(message) });
    const res = await env.folderToggle(WEB_ID, cwd, false);
    expect(res.status).toBe(403);
    expect(res.body.data.trustRequired).toBe(true);
    expect(res.body.error).toBe(message);
    expect(env.folderSettingsRaw(cwd)).toBeUndefined();
    expect(env.readRestore()).toBeUndefined();

    // the existing trust endpoint accepts the follow-up decision for this folder
    const app = Fastify({ logger: false });
    registerResourceActivationRoutes(app, {
      networkGuard: async () => {},
      piGateway: {} as never,
      sessionManager: {} as never,
      dispatchReload: async () => "forwarded",
      registrySessions: () => [],
    });
    await app.ready();
    const trust = await app.inject({ method: "POST", url: "/api/resources/trust", payload: { cwd, optionId: "trust" } });
    await app.close();
    expect(trust.statusCode).toBe(200);
  });

  // test-plan #X2
  it("a refusal is 403 without trustRequired and writes nothing", async () => {
    const cwd = await webEnv("x2", {
      resolveTrust: async () => ({ outcome: "refused", error: "recorded as not trusted" }),
    });
    const res = await env.folderToggle(WEB_ID, cwd, false);
    expect(res.status).toBe(403);
    expect(res.body.data?.trustRequired).toBeUndefined();
    expect(env.folderSettingsRaw(cwd)).toBeUndefined();
  });

  // test-plan #X3
  it("unparseable project settings → 409, bytes unchanged, no record", async () => {
    const cwd = await webEnv("x3");
    env.writeFolderSettings(cwd, '{ "packages": [');
    const res = await env.folderToggle(WEB_ID, cwd, false);
    expect(res.status).toBe(409);
    expect(env.folderSettingsRaw(cwd)).toBe('{ "packages": [');
    expect(env.readRestore()).toBeUndefined();
  });

  // test-plan #X4
  it("a failed settings write leaves no record and the file unchanged", async () => {
    const cwd = await webEnv("x4", {
      writeSettingsText: () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    const narrow = { source: WEB, autoload: false, skills: ["-skills/a"] };
    env.writeFolderSettings(cwd, { packages: [narrow] });
    const before = env.folderSettingsRaw(cwd);
    const res = await env.folderToggle(WEB_ID, cwd, false);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(env.folderSettingsRaw(cwd)).toBe(before);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
  });

  // test-plan #X5
  it("two concurrent toggles in one folder both land", async () => {
    let first = true;
    env = new AddonsEnv("x5");
    env.addPackage("npm:a", { name: "a" });
    env.addPackage("npm:b", { name: "b" });
    env.writeSettings({ packages: ["npm:a", "npm:b"] });
    const cwd = env.makeFolder("repo");
    await env.makeApp({
      resolveTrust: async () => {
        if (first) {
          first = false;
          await new Promise((r) => setTimeout(r, 200));
        }
        return { outcome: "proceed" };
      },
    });
    const [ra, rb] = await Promise.all([
      env.folderToggle("pkg:npm:a", cwd, false),
      env.folderToggle("pkg:npm:b", cwd, false),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(env.readFolderSettings(cwd).packages).toEqual([delta("npm:a"), delta("npm:b")]);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(2);
  });

  it("scope local needs cwd and rejects dryRun", async () => {
    const cwd = await webEnv("scope");
    expect((await env.toggle(WEB_ID, { scope: "local", enabled: false })).status).toBe(400);
    expect((await env.folderToggle(WEB_ID, cwd, false, { dryRun: true })).status).toBe(400);
    expect((await env.toggle(WEB_ID, { scope: "bogus", enabled: false })).status).toBe(400);
  });
});
