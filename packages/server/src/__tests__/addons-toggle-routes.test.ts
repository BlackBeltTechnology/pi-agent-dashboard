/**
 * POST /api/addons/:featureId/toggle route tests.
 * See change: addons-hub-feature-catalog (test-plan #E8–#E19, #X1–#X10).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPluginsEnabled } from "../routes/plugin-activation-routes.js";
import { AddonsEnv, FILTERED } from "./addons-fixture.js";

const GOAL_PKG = "@ricoyudog/pi-goal-hermes";
const GOAL_SRC = `npm:${GOAL_PKG}`;
const FIRST_PARTY = (id: string) => `@blackbelt-technology/pi-dashboard-${id}-plugin`;

let env: AddonsEnv;
afterEach(async () => {
  await env?.cleanup();
});

/** Goal feature: first-party plugin + `pi-goal-hermes` package. */
function goalEnv(name: string, packages: unknown[] = [GOAL_SRC], opts: { enabled?: boolean } = {}) {
  env = new AddonsEnv(name);
  env.addPlugin({ id: "goal", packageName: FIRST_PARTY("goal"), requires: [GOAL_PKG], bridge: true, enabled: opts.enabled });
  env.addPackage(GOAL_SRC, { name: GOAL_PKG });
  env.writeSettings({ keep: "me", packages });
  return env;
}

const pluginEnabled = (id: string) => env.readPluginConfig()[id]?.enabled;
const snapshot = () => ({
  settings: fs.readFileSync(env.settingsFile, "utf-8"),
  config: fs.existsSync(env.configFile) ? fs.readFileSync(env.configFile, "utf-8") : "",
  restore: fs.existsSync(env.restoreFile) ? fs.readFileSync(env.restoreFile, "utf-8") : "",
});

describe("disable / enable (restore)", () => {
  // test-plan #E8
  it("disable Goal rewrites its entry in place into the all-empty filter form", async () => {
    goalEnv("e8", ["npm:a", GOAL_SRC, "npm:b"]);
    env.addPackage("npm:a", { name: "a" });
    env.addPackage("npm:b", { name: "b" });
    await env.makeApp();

    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.restartRequired).toBe(true);
    const s = env.readSettings();
    expect(s.packages[0]).toBe("npm:a");
    expect(s.packages[1]).toEqual(FILTERED(GOAL_SRC));
    expect(s.packages[2]).toBe("npm:b");
    expect(s.keep).toBe("me");
    expect(pluginEnabled("goal")).toBe(false);
    const rec = Object.values(env.readRestore()?.records ?? {});
    expect(rec).toHaveLength(1);
    expect(rec[0].original).toBe(GOAL_SRC);
    expect(rec[0].filtered).toEqual(FILTERED(GOAL_SRC));
  });

  // test-plan #E9
  it("re-enable restores the exact previous entry and removes the record", async () => {
    const original = { source: GOAL_SRC, skills: ["!skills/legacy"] };
    goalEnv("e9", [original]);
    await env.makeApp();
    await env.toggle("plugin:goal", { enabled: false });
    const on = await env.toggle("plugin:goal", { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.restored).toEqual([GOAL_SRC]);
    expect(env.readSettings().packages[0]).toEqual(original);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
    expect(pluginEnabled("goal")).toBe(true);
  });

  // test-plan #E10
  describe("enable rule table", () => {
    async function offThen(mutate: () => void) {
      goalEnv("e10", [GOAL_SRC]);
      await env.makeApp();
      await env.toggle("plugin:goal", { enabled: false });
      mutate();
      return env.toggle("plugin:goal", { enabled: true });
    }
    it("record + entry = filtered → restored, record deleted", async () => {
      const res = await offThen(() => {});
      expect(res.body.restored).toEqual([GOAL_SRC]);
      expect(env.readSettings().packages[0]).toBe(GOAL_SRC);
      expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
    });
    it("record + entry = original (interrupted enable) → record deleted, reported restored", async () => {
      const res = await offThen(() => env.writeSettings({ packages: [GOAL_SRC] }));
      expect(res.body.restored).toEqual([GOAL_SRC]);
      expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
    });
    it("record + hand-edited entry → unchanged, restoreSkipped edited, record kept", async () => {
      const edited = { source: GOAL_SRC, extensions: [], skills: ["only"], prompts: [], themes: [] };
      const res = await offThen(() => env.writeSettings({ packages: [edited] }));
      expect(res.body.restoreSkipped).toEqual([{ source: GOAL_SRC, reason: "edited" }]);
      expect(env.readSettings().packages[0]).toEqual(edited);
      expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(1);
    });
    it("no record + all-empty form → unchanged, restoreSkipped no-record", async () => {
      goalEnv("e10c", [FILTERED(GOAL_SRC)], { enabled: false });
      await env.makeApp();
      const res = await env.toggle("plugin:goal", { enabled: true });
      expect(res.body.restoreSkipped).toEqual([{ source: GOAL_SRC, reason: "no-record" }]);
      expect(env.readSettings().packages[0]).toEqual(FILTERED(GOAL_SRC));
    });
    it("no record + plain string → unchanged, nothing reported", async () => {
      goalEnv("e10d", [GOAL_SRC], { enabled: false });
      await env.makeApp();
      const res = await env.toggle("plugin:goal", { enabled: true });
      expect(res.body.restoreSkipped).toEqual([]);
      expect(env.readSettings().packages[0]).toBe(GOAL_SRC);
    });
  });

  // test-plan #E11
  it("a second off keeps settings and restore files byte-identical", async () => {
    goalEnv("e11");
    await env.makeApp();
    await env.toggle("plugin:goal", { enabled: false });
    const before = snapshot();
    const again = await env.toggle("plugin:goal", { enabled: false });
    expect(again.status).toBe(200);
    expect(again.body.filtered).toEqual([]);
    const after = snapshot();
    expect(after.settings).toBe(before.settings);
    expect(after.restore).toBe(before.restore);
  });
});

describe("cascade, keptOn, requiredBy", () => {
  // test-plan #E12
  it("keeps a package an enabled plugin requires on; owner becomes partial", async () => {
    env = new AddonsEnv("e12");
    env.addPlugin({ id: "a", packageName: "p" });
    env.addPlugin({ id: "b", requires: ["p"] });
    env.addPackage("npm:p", { name: "p" });
    env.writeSettings({ packages: ["npm:p"] });
    await env.makeApp();
    const res = await env.toggle("plugin:a", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.keptOn).toEqual([{ source: "npm:p", by: ["plugin:b"] }]);
    expect(res.body.filtered).toEqual([]);
    expect(env.readSettings().packages[0]).toBe("npm:p");
    const a = (await env.catalog()).body.features.find((f) => f.id === "plugin:a");
    expect(a.state).toBe("partial");
  });

  function appleEnv(name: string) {
    env = new AddonsEnv(name);
    env.addPlugin({ id: "mcp-client", packageName: "mcp-pkg" });
    env.addPlugin({ id: "apple-tools", packageName: "apple-pkg", dependsOn: ["mcp-client"] });
    env.addPackage("npm:mcp-pkg", { name: "mcp-pkg" });
    env.addPackage("npm:apple-pkg", { name: "apple-pkg" });
    env.writeSettings({ packages: ["npm:mcp-pkg", "npm:apple-pkg"] });
  }

  // test-plan #E13
  it("turning off a feature turns its dependents' features fully off", async () => {
    appleEnv("e13");
    await env.makeApp();
    const res = await env.toggle("plugin:mcp-client", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.cascaded).toEqual(["plugin:apple-tools"]);
    expect(pluginEnabled("mcp-client")).toBe(false);
    expect(pluginEnabled("apple-tools")).toBe(false);
    expect(env.readSettings().packages).toEqual([FILTERED("npm:mcp-pkg"), FILTERED("npm:apple-pkg")]);
  });

  // test-plan #E14
  it("turning on a dependent restores the cascaded features too", async () => {
    appleEnv("e14");
    await env.makeApp();
    await env.toggle("plugin:mcp-client", { enabled: false });
    const res = await env.toggle("plugin:apple-tools", { enabled: true });
    expect(res.status).toBe(200);
    expect(pluginEnabled("mcp-client")).toBe(true);
    expect(pluginEnabled("apple-tools")).toBe(true);
    expect(env.readSettings().packages).toEqual(["npm:mcp-pkg", "npm:apple-pkg"]);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
  });

  // test-plan #E15
  it("a pkg: feature with requiredBy filters the package, leaves plugins alone", async () => {
    env = new AddonsEnv("e15");
    env.addPlugin({ id: "a", requires: ["x"] });
    env.addPlugin({ id: "b", requires: ["x"] });
    env.addPackage("npm:x", { name: "x" });
    env.writeSettings({ packages: ["npm:x"] });
    await env.makeApp();
    const res = await env.toggle("pkg:npm:x", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.requiredBy).toEqual(["plugin:a", "plugin:b"]);
    expect(env.readSettings().packages[0]).toEqual(FILTERED("npm:x"));
    expect(pluginEnabled("a")).toBe(true);
    expect(pluginEnabled("b")).toBe(true);
  });
});

describe("stillLoadedIn", () => {
  // test-plan #E16
  it("lists folders whose own settings keep loading the package; writes no folder file", async () => {
    env = new AddonsEnv("e16");
    const local = path.join(env.home, "r4", ".pi", "vendor", "g");
    env.addPlugin({ id: "goal", requires: ["g", "lg"] });
    env.addPackage("npm:g", { name: "g" });
    env.addPackage(local, { name: "lg", dir: local });
    env.writeSettings({ packages: ["npm:g", local] });
    const dirs = ["r1", "r2", "r3", "r4", "r5"].map((d) => path.join(env.home, d));
    env.writeFolderSettings(dirs[0], { packages: ["npm:g"] });
    env.writeFolderSettings(dirs[1], { packages: [{ source: "npm:g", autoload: false }] });
    env.writeFolderSettings(dirs[2], { packages: [FILTERED("npm:g")] });
    env.writeFolderSettings(dirs[3], { packages: ["./vendor/g"] });
    env.writeFolderSettings(dirs[4], "{ nope");
    const mtimes = dirs.map((d) => fs.statSync(path.join(d, ".pi", "settings.json")).mtimeMs);
    await env.makeApp({ knownDirs: dirs });

    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.stillLoadedIn).toEqual([
      { source: "npm:g", folders: [dirs[0]] },
      { source: local, folders: [dirs[3]] },
    ]);
    expect(dirs.map((d) => fs.statSync(path.join(d, ".pi", "settings.json")).mtimeMs)).toEqual(mtimes);
  });
});

describe("dry run + confirm token", () => {
  // test-plan #E17
  it("dry run writes nothing; the real call with its token succeeds", async () => {
    goalEnv("e17");
    await env.makeApp();
    const before = snapshot();
    const dry = await env.toggle("plugin:goal", { enabled: false, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.filtered).toEqual([GOAL_SRC]);
    expect(typeof dry.body.confirmToken).toBe("string");
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(env.restoreFile)).toBe(false);

    const real = await env.toggle("plugin:goal", { enabled: false, confirmToken: dry.body.confirmToken });
    expect(real.status).toBe(200);
    expect(env.readSettings().packages[0]).toEqual(FILTERED(GOAL_SRC));
  });

  // test-plan #X9
  it("a changed situation after the dry run → 409 stale-confirmation, nothing written", async () => {
    env = new AddonsEnv("x9");
    env.addPlugin({ id: "a", packageName: "p" });
    env.addPlugin({ id: "b", requires: ["p"], enabled: false });
    env.addPackage("npm:p", { name: "p" });
    env.writeSettings({ packages: ["npm:p"] });
    await env.makeApp();
    const dry = await env.toggle("plugin:a", { enabled: false, dryRun: true });
    expect(dry.body.keptOn).toEqual([]);
    // plugin b (requires p) gets enabled afterwards
    fs.writeFileSync(env.configFile, JSON.stringify({ plugins: { a: { enabled: true }, b: { enabled: true } } }));
    const before = snapshot();
    const res = await env.toggle("plugin:a", { enabled: false, confirmToken: dry.body.confirmToken });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("stale-confirmation");
    expect(res.body.keptOn).toEqual([{ source: "npm:p", by: ["plugin:b"] }]);
    expect(snapshot()).toEqual(before);
  });
});

describe("validation + refusals", () => {
  // test-plan #E18
  it("rejects core, unknown and malformed requests without writing", async () => {
    goalEnv("e18");
    env.addPackage("npm:@blackbelt-technology/pi-dashboard-extension", { name: "@blackbelt-technology/pi-dashboard-extension" });
    env.writeSettings({ packages: [GOAL_SRC, "npm:@blackbelt-technology/pi-dashboard-extension"] });
    await env.makeApp();
    const before = snapshot();
    expect((await env.toggle("core:pi", { enabled: false })).status).toBe(400);
    expect((await env.toggle("core:dashboard-bridge", { enabled: false })).status).toBe(400);
    expect((await env.toggle("plugin:nope", { enabled: false })).status).toBe(404);
    expect((await env.toggle("plugin:goal", { enabled: "yes" })).status).toBe(400);
    expect(snapshot()).toEqual(before);
  });

  // test-plan #E19
  it("duplicate identity entries → 409 duplicate-entries, nothing written", async () => {
    goalEnv("e19", ["npm:x", "npm:x@1"]);
    env.rows.length = 0;
    env.addPlugin({ id: "goal", requires: ["x"] });
    env.addPackage("npm:x", { name: "x" });
    env.addPackage("npm:x@1", { name: "x" });
    env.writeSettings({ packages: ["npm:x", "npm:x@1"] });
    await env.makeApp();
    const before = snapshot();
    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("duplicate-entries");
    expect(snapshot()).toEqual(before);
  });

  // test-plan #X1
  it("unparseable settings → 409; plugin config and records untouched", async () => {
    goalEnv("x1", []);
    env.writeSettings('{ "packages": [');
    await env.makeApp();
    const before = snapshot();
    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(409);
    expect(snapshot()).toEqual(before);
    expect(pluginEnabled("goal")).toBe(true);
  });

  // test-plan #X2
  it("a running package operation → 409 busy, nothing written", async () => {
    goalEnv("x2");
    await env.makeApp();
    env.busy = true;
    const before = snapshot();
    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("busy");
    expect(snapshot()).toEqual(before);
  });

  // test-plan #X6
  it("enabling with a dependency that is not discovered → 409 blockers", async () => {
    env = new AddonsEnv("x6");
    env.addPlugin({ id: "apple-tools", packageName: "apple-pkg", dependsOn: ["mcp-client"], enabled: false });
    env.addPackage("npm:apple-pkg", { name: "apple-pkg" });
    env.writeSettings({ packages: [FILTERED("npm:apple-pkg")] });
    await env.makeApp();
    const before = snapshot();
    const res = await env.toggle("plugin:apple-tools", { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.blockers).toEqual(["mcp-client"]);
    expect(snapshot()).toEqual(before);
  });

  // test-plan #X7 (toggle half)
  it("a malformed restore file reads as empty: no-record, warning, no throw", async () => {
    goalEnv("x7", [FILTERED(GOAL_SRC)], { enabled: false });
    fs.mkdirSync(path.dirname(env.restoreFile), { recursive: true });
    fs.writeFileSync(env.restoreFile, "not json");
    await env.makeApp();
    const res = await env.toggle("plugin:goal", { enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.restoreSkipped).toEqual([{ source: GOAL_SRC, reason: "no-record" }]);
    expect(env.logs.warn.some((m) => m.includes("malformed"))).toBe(true);
  });
});

describe("failure + compensation", () => {
  const failOnReal: typeof setPluginsEnabled = (id, en, deps, opts) => {
    if (opts?.dryRun) return setPluginsEnabled(id, en, deps, opts);
    throw new Error("plugin step boom");
  };

  // test-plan #X3
  it("plugin step fails on off → entry restored, record deleted, 500", async () => {
    goalEnv("x3");
    await env.makeApp({ setPluginsEnabled: failOnReal });
    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(500);
    expect(env.readSettings().packages[0]).toBe(GOAL_SRC);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
  });

  // test-plan #X4
  it("restore step fails on on → plugin disabled again, 500", async () => {
    goalEnv("x4");
    let failWrites = false;
    await env.makeApp({
      writeSettingsText: (file, text) => {
        if (failWrites) throw new Error("disk full");
        fs.writeFileSync(file, text);
      },
    });
    expect((await env.toggle("plugin:goal", { enabled: false })).status).toBe(200);
    failWrites = true;
    const res = await env.toggle("plugin:goal", { enabled: true });
    expect(res.status).toBe(500);
    expect(pluginEnabled("goal")).toBe(false);
    expect(env.readSettings().packages[0]).toEqual(FILTERED(GOAL_SRC));
  });

  // test-plan #X5
  it("compensation fails → 500 consistent:false, record kept, one error line", async () => {
    goalEnv("x5");
    let writes = 0;
    await env.makeApp({
      setPluginsEnabled: failOnReal,
      writeSettingsText: (file, text) => {
        if (++writes > 1) throw new Error("disk gone");
        fs.writeFileSync(file, text);
      },
    });
    const res = await env.toggle("plugin:goal", { enabled: false });
    expect(res.status).toBe(500);
    expect(res.body.consistent).toBe(false);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(1);
    expect(env.logs.error).toHaveLength(1);
  });
});

describe("serialisation + logging", () => {
  // test-plan #X8
  it("concurrent hub toggles and a plugin toggle serialise without a lost write", async () => {
    goalEnv("x8");
    await env.makeApp({ withPluginRoutes: true });
    const app = env.app as NonNullable<typeof env.app>;
    const results = await Promise.all([
      env.toggle("plugin:goal", { enabled: false }),
      env.toggle("plugin:goal", { enabled: true }),
      app.inject({ method: "POST", url: "/api/plugins/goal/toggle", payload: { enabled: false } }),
    ]);
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(200);
    expect(results[2].statusCode).toBe(200);
    const entry = env.readSettings().packages[0];
    const records = Object.keys(env.readRestore()?.records ?? {});
    // hub ops run in call order: off then on → entry back to the original, no record left
    expect(entry).toBe(GOAL_SRC);
    expect(records).toHaveLength(0);
    expect(typeof pluginEnabled("goal")).toBe("boolean");
  });

  // test-plan #X10
  it("logs exactly one info line per real toggle and none for a dry run", async () => {
    goalEnv("x10");
    await env.makeApp();
    await env.toggle("plugin:goal", { enabled: false, dryRun: true });
    expect(env.logs.info).toHaveLength(0);
    await env.toggle("plugin:goal", { enabled: false });
    expect(env.logs.info).toHaveLength(1);
    const line = env.logs.info[0];
    expect(line).toContain("plugin:goal");
    expect(line).toContain("plugins=[goal]");
    expect(line).toContain(`filtered=[${GOAL_SRC}]`);
    expect(line).toContain("keptOn=[]");
    expect(line).toContain("stillLoadedIn=[]");
  });
});
