/**
 * Route tests for `GET /api/plugins` and `POST /api/plugins/:id/toggle`.
 *
 * See change: add-plugin-activation-ui.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearDiscoveryCache,
  clearLoadedSnapshots,
  clearStatusStore,
  discoverPlugins,
  getPluginStatusStore,
  loadServerEntries,
  registerPluginAssetsRoute,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isServerTrusted } from "../auth/plugin-server-trust.js";
import { grantClientTrust, grantServerTrust, readTrustedPlugins } from "../auth/plugin-trust-store.js";
import { createPluginDiscoveryWiring } from "../plugin-discovery-wiring.js";
import { getRuntimeClientRegistry, installRuntimeClientRegistry, logRuntimeAdmissions, resetRuntimeClientRegistry } from "../plugin-runtime-clients.js";
import { registerPluginActivationRoutes, setPluginsEnabled } from "../routes/plugin-activation-routes.js";
import { registerPluginRuntimeClientRoutes } from "../routes/plugin-runtime-client-routes.js";
import { toHealthPlugins } from "../routes/system-routes.js";

const HOME_OVERRIDE = path.join(os.tmpdir(), "pi-dashboard-activation-test-" + process.pid);

function makeRepoRootWithPlugin(id: string, displayName: string, opts: { enabledInConfig?: boolean } = {}) {
  const repoRoot = path.join(os.tmpdir(), `activation-routes-test-${id}-${Date.now()}`);
  const pkgDir = path.join(repoRoot, "packages", id);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: `@test/${id}`,
      version: "0.0.0",
      "pi-dashboard-plugin": { id, displayName, claims: [] },
    }),
  );

  if (opts.enabledInConfig !== undefined) {
    fs.mkdirSync(path.join(HOME_OVERRIDE, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(
      path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"),
      JSON.stringify({ plugins: { [id]: { enabled: opts.enabledInConfig } } }, null, 2),
    );
  }
  return repoRoot;
}

function makeRepoRootWithPluginPair(
  rootSuffix: string,
  a: { id: string; displayName: string; enabledInConfig?: boolean },
  b: { id: string; displayName: string; dependsOn: string[]; enabledInConfig?: boolean },
) {
  const repoRoot = path.join(os.tmpdir(), `activation-routes-test-${rootSuffix}-${Date.now()}`);
  for (const p of [a, b]) {
    const pkgDir = path.join(repoRoot, "packages", p.id);
    fs.mkdirSync(pkgDir, { recursive: true });
    const manifest: Record<string, unknown> = { id: p.id, displayName: p.displayName, claims: [] };
    if ("dependsOn" in p && p.dependsOn) manifest.dependsOn = p.dependsOn;
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: `@test/${p.id}`,
        version: "0.0.0",
        "pi-dashboard-plugin": manifest,
      }),
    );
  }
  const cfgPlugins: Record<string, { enabled: boolean }> = {};
  if (a.enabledInConfig !== undefined) cfgPlugins[a.id] = { enabled: a.enabledInConfig };
  if (b.enabledInConfig !== undefined) cfgPlugins[b.id] = { enabled: b.enabledInConfig };
  if (Object.keys(cfgPlugins).length > 0) {
    fs.mkdirSync(path.join(HOME_OVERRIDE, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(
      path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"),
      JSON.stringify({ plugins: cfgPlugins }, null, 2),
    );
  }
  return repoRoot;
}

let originalHome: string | undefined;
async function makeApp(repoRoot: string, broadcasts: unknown[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerPluginActivationRoutes(app, {
    networkGuard: async () => undefined,
    broadcast: (m) => broadcasts.push(m),
    repoRoot,
  });
  await app.ready();
  return app;
}

describe("/api/plugins", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
  });
  afterEach(async () => {
    await app?.close();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  });

  it("returns every discovered plugin with manifest summary + status", async () => {
    const repoRoot = makeRepoRootWithPlugin("act-a", "Act A");
    // Seed status so the row carries the runtime view too.
    getPluginStatusStore().setStatus({
      id: "act-a",
      displayName: "Act A",
      enabled: true,
      loaded: true,
      claims: 0,
    });
    app = await makeApp(repoRoot);

    const res = await app.inject({ method: "GET", url: "/api/plugins" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; plugins: any[] };
    expect(body.success).toBe(true);
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].id).toBe("act-a");
    expect(body.plugins[0].displayName).toBe("Act A");
    expect(body.plugins[0].status.enabled).toBe(true);
  });

  // See change: promote-model-roles-settings (test-plan #E10).
  it("projects claim nav + row firstParty (npm scope, not priority)", async () => {
    const repoRoot = path.join(os.tmpdir(), `activation-routes-test-nav-${Date.now()}`);
    const nav = { group: "models", label: "Model roles", description: "Pick." };
    const write = (dir: string, pkg: Record<string, unknown>) => {
      const pkgDir = path.join(repoRoot, "packages", dir);
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg));
    };
    write("roles", {
      name: "@blackbelt-technology/pi-dashboard-roles-plugin",
      "pi-dashboard-plugin": {
        id: "roles",
        displayName: "Roles",
        claims: [
          { slot: "settings-section", component: "RolesSettings", nav },
          { slot: "settings-section", component: "Other" },
        ],
      },
    });
    write("acme", {
      name: "acme-dashboard-x",
      "pi-dashboard-plugin": {
        id: "acme",
        displayName: "Acme",
        priority: 100,
        claims: [{ slot: "settings-section", component: "AcmeSettings", nav }],
      },
    });
    write("nameless", {
      "pi-dashboard-plugin": { id: "nameless", displayName: "Nameless", claims: [] },
    });
    app = await makeApp(repoRoot);

    const res = await app.inject({ method: "GET", url: "/api/plugins" });
    const byId = new Map((res.json() as { plugins: any[] }).plugins.map((r) => [r.id, r]));
    expect(byId.get("roles").firstParty).toBe(true);
    expect(byId.get("roles").claims[0].nav).toEqual(nav);
    expect("nav" in byId.get("roles").claims[1]).toBe(false);
    expect(byId.get("acme").firstParty).toBe(false);
    expect(byId.get("acme").claims[0].nav).toEqual(nav);
    expect(byId.get("nameless").firstParty).toBe(false);
  });
});

describe("POST /api/plugins/:id/toggle", () => {
  let app: FastifyInstance;
  let broadcasts: unknown[];
  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    broadcasts = [];
  });
  afterEach(async () => {
    await app?.close();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  });

  it("persists enabled=false to config.json and broadcasts plugin_config_update", async () => {
    const repoRoot = makeRepoRootWithPlugin("act-b", "Act B");
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/act-b/toggle",
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; restartRequired: boolean };
    expect(body.restartRequired).toBe(true);

    const cfgPath = path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.plugins["act-b"].enabled).toBe(false);

    expect(broadcasts).toHaveLength(2);
    expect((broadcasts[0] as any).type).toBe("plugin_config_update");
    expect((broadcasts[0] as any).id).toBe("act-b");
    expect((broadcasts[1] as any).type).toBe("plugins_changed");
  });

  it("returns 404 for unknown plugin id", async () => {
    const repoRoot = makeRepoRootWithPlugin("act-c", "Act C");
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/no-such/toggle",
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    // config.json should not have been created
    const cfgPath = path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json");
    expect(fs.existsSync(cfgPath)).toBe(false);
  });

  it("returns 400 when body.enabled is not a boolean", async () => {
    const repoRoot = makeRepoRootWithPlugin("act-d", "Act D");
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/act-d/toggle",
      payload: { enabled: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---- Dependency-graph cascade tests (Robert's Layer 2 spec) ------------

  it("enabling a plugin with a missing dep returns 409 + blockers", async () => {
    const repoRoot = makeRepoRootWithPluginPair(
      "cascade-blocker",
      { id: "orphan-a", displayName: "Orphan A" },
      { id: "orphan-b", displayName: "Orphan B", dependsOn: ["missing-x"], enabledInConfig: false },
    );
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/orphan-b/toggle",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { success: boolean; reason: string; blockers: string[] };
    expect(body.reason).toBe("blockers");
    expect(body.blockers).toEqual(["missing-x"]);
  });

  it("enabling cascades disabled deps and writes atomically", async () => {
    const repoRoot = makeRepoRootWithPluginPair(
      "cascade-enable",
      { id: "cas-a", displayName: "Cas A", enabledInConfig: false },
      { id: "cas-b", displayName: "Cas B", dependsOn: ["cas-a"], enabledInConfig: false },
    );
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/cas-b/toggle",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; cascade: { enable: string[] } };
    expect(body.cascade.enable).toEqual(["cas-a"]);

    const cfg = JSON.parse(
      fs.readFileSync(path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"), "utf-8"),
    );
    expect(cfg.plugins["cas-a"].enabled).toBe(true);
    expect(cfg.plugins["cas-b"].enabled).toBe(true);

    // One plugin_config_update per affected id, then one plugins_changed.
    const updates = broadcasts.filter((m) => (m as { type: string }).type === "plugin_config_update");
    expect(updates.map((m) => (m as { id: string }).id).sort()).toEqual(["cas-a", "cas-b"]);
    expect((broadcasts.at(-1) as { type: string }).type).toBe("plugins_changed");
    expect(broadcasts.filter((m) => (m as { type: string }).type === "plugins_changed")).toHaveLength(1);
  });

  it("disabling cascades enabled dependents and writes atomically", async () => {
    const repoRoot = makeRepoRootWithPluginPair(
      "cascade-disable",
      { id: "dis-a", displayName: "Dis A", enabledInConfig: true },
      { id: "dis-b", displayName: "Dis B", dependsOn: ["dis-a"], enabledInConfig: true },
    );
    app = await makeApp(repoRoot, broadcasts);

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/dis-a/toggle",
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; cascade: { disable: string[] } };
    expect(body.cascade.disable).toEqual(["dis-b"]);

    const cfg = JSON.parse(
      fs.readFileSync(path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"), "utf-8"),
    );
    expect(cfg.plugins["dis-a"].enabled).toBe(false);
    expect(cfg.plugins["dis-b"].enabled).toBe(false);
  });
});

// See change: addons-hub-feature-catalog (task 4.1, test-plan #E32): the
// extracted `setPluginsEnabled` keeps the route's contract and adds dry run +
// rollback for the Add-ons hub toggle.
describe("setPluginsEnabled (shared by the hub toggle)", () => {
  const cfgFile = () => path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json");
  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
  });
  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  });

  function pair(suffix: string) {
    return makeRepoRootWithPluginPair(
      suffix,
      { id: `${suffix}-a`, displayName: "A", enabledInConfig: true },
      { id: `${suffix}-b`, displayName: "B", dependsOn: [`${suffix}-a`], enabledInConfig: true },
    );
  }

  it("dry run returns the cascade and writes nothing", () => {
    const repoRoot = pair("spe-dry");
    const before = fs.readFileSync(cfgFile(), "utf-8");
    const broadcasts: unknown[] = [];
    const r = setPluginsEnabled("spe-dry-a", false, { broadcast: (m) => broadcasts.push(m), repoRoot }, { dryRun: true });
    expect(r.ok && r.flips.map((f) => f.id)).toEqual(["spe-dry-a", "spe-dry-b"]);
    expect(fs.readFileSync(cfgFile(), "utf-8")).toBe(before);
    expect(broadcasts).toHaveLength(0);
  });

  it("rollback puts the previous plugin config back and re-broadcasts", () => {
    const repoRoot = pair("spe-rb");
    const broadcasts: unknown[] = [];
    const r = setPluginsEnabled("spe-rb-a", false, { broadcast: (m) => broadcasts.push(m), repoRoot });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(fs.readFileSync(cfgFile(), "utf-8")).plugins["spe-rb-b"].enabled).toBe(false);
    r.rollback();
    const cfg = JSON.parse(fs.readFileSync(cfgFile(), "utf-8"));
    expect(cfg.plugins["spe-rb-a"].enabled).toBe(true);
    expect(cfg.plugins["spe-rb-b"].enabled).toBe(true);
    expect(broadcasts).toHaveLength(6); // (2 updates + 1 plugins_changed) on toggle, again on rollback
    expect(broadcasts.filter((m) => (m as { type: string }).type === "plugins_changed")).toHaveLength(2);
  });

  it("unknown id → 404 result, blockers → 409 result", () => {
    const repoRoot = pair("spe-err");
    const deps = { broadcast: () => {}, repoRoot };
    expect(setPluginsEnabled("nope", true, deps)).toMatchObject({ ok: false, status: 404 });
  });
});

// ── Phase 4B: toggle broadcasts, never-loaded re-enable, GET rows (tests 8.75e, 8.77, 8.78, 8.80, 8.82) ──

const typeOf = (m: unknown) => (m as { type: string }).type;

describe("toggle broadcast order + re-enable restart (E62, E58e)", () => {
  let app: FastifyInstance;
  let broadcasts: unknown[];
  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    broadcasts = [];
  });
  afterEach(async () => {
    await app?.close();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
  });

  it("E62: toggle demo off → plugin_config_update(demo) then exactly one plugins_changed; 200 restartRequired", async () => {
    app = await makeApp(makeRepoRootWithPlugin("demo", "Demo"), broadcasts);
    const res = await app.inject({ method: "POST", url: "/api/plugins/demo/toggle", payload: { enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, restartRequired: true });
    expect(JSON.parse(fs.readFileSync(path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"), "utf-8")).plugins.demo.enabled).toBe(false);
    expect(broadcasts.map(typeOf)).toEqual(["plugin_config_update", "plugins_changed"]);
    expect((broadcasts[0] as { id: string }).id).toBe("demo");
  });

  it("E62: nonexistent → 404, config bytes unchanged, no broadcast", async () => {
    app = await makeApp(makeRepoRootWithPlugin("demo", "Demo", { enabledInConfig: true }), broadcasts);
    const cfgPath = path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json");
    const before = fs.readFileSync(cfgPath, "utf-8");
    const res = await app.inject({ method: "POST", url: "/api/plugins/nonexistent/toggle", payload: { enabled: false } });
    expect(res.statusCode).toBe(404);
    expect(fs.readFileSync(cfgPath, "utf-8")).toBe(before);
    expect(broadcasts).toEqual([]);
  });

  it("E62: toggle quota off with dependent quota-ui → one update per id, one plugins_changed, cascade.disable", async () => {
    const repoRoot = makeRepoRootWithPluginPair(
      "e62-cascade",
      { id: "quota", displayName: "Quota", enabledInConfig: true },
      { id: "quota-ui", displayName: "Quota UI", dependsOn: ["quota"], enabledInConfig: true },
    );
    app = await makeApp(repoRoot, broadcasts);
    const res = await app.inject({ method: "POST", url: "/api/plugins/quota/toggle", payload: { enabled: false } });
    expect(res.json()).toMatchObject({ restartRequired: true, cascade: { disable: ["quota-ui"] } });
    expect(broadcasts.filter((m) => typeOf(m) === "plugin_config_update").map((m) => (m as { id: string }).id).sort()).toEqual(["quota", "quota-ui"]);
    expect(broadcasts.filter((m) => typeOf(m) === "plugins_changed")).toHaveLength(1);
    expect(typeOf(broadcasts.at(-1))).toBe("plugins_changed");
  });

  it("E58(e): a discovered never-loaded plugin toggled on → 200 restartRequired, entry not loaded, row flagged in the broadcast snapshot", async () => {
    const repoRoot = makeRepoRootWithPlugin("late", "Late", { enabledInConfig: false });
    // Disabled at boot: the loader recorded it enabled:false / loaded:false and never ran its entry.
    getPluginStatusStore().setStatus({ id: "late", displayName: "Late", enabled: false, loaded: false, claims: 0, source: "workspace" });
    app = await makeApp(repoRoot, broadcasts);
    const res = await app.inject({ method: "POST", url: "/api/plugins/late/toggle", payload: { enabled: true } });
    expect(res.json()).toMatchObject({ success: true, restartRequired: true });
    expect(getPluginStatusStore().getStatus("late")).toMatchObject({ loaded: false, restartRequired: true });
    const snapshot = (broadcasts.find((m) => typeOf(m) === "plugins_changed") as { plugins: PluginStatus[] }).plugins;
    expect(snapshot.find((p) => p.id === "late")).toMatchObject({ loaded: false, restartRequired: true });
  });

  it("an already-loaded plugin toggled on/off is not flagged by the re-enable rule", async () => {
    getPluginStatusStore().setStatus({ id: "live", displayName: "Live", enabled: true, loaded: true, claims: 0 });
    app = await makeApp(makeRepoRootWithPlugin("live", "Live", { enabledInConfig: true }), broadcasts);
    await app.inject({ method: "POST", url: "/api/plugins/live/toggle", payload: { enabled: true } });
    expect(getPluginStatusStore().getStatus("live")?.restartRequired).toBeUndefined();
  });

  it("restore path (rollback) also broadcasts one plugins_changed and unflags what the toggle flagged", () => {
    const repoRoot = makeRepoRootWithPlugin("rb", "Rb", { enabledInConfig: false });
    process.env.HOME = HOME_OVERRIDE;
    getPluginStatusStore().setStatus({ id: "rb", displayName: "Rb", enabled: false, loaded: false, claims: 0 });
    const r = setPluginsEnabled("rb", true, { broadcast: (m) => broadcasts.push(m), repoRoot });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getPluginStatusStore().getStatus("rb")?.restartRequired).toBe(true);
    r.rollback();
    expect(getPluginStatusStore().getStatus("rb")?.restartRequired).toBeUndefined();
    expect(broadcasts.map(typeOf)).toEqual(["plugin_config_update", "plugins_changed", "plugin_config_update", "plugins_changed"]);
  });
});

describe("GET /api/plugins rows (E59, E60, E64)", () => {
  let app: FastifyInstance;
  let tmpProj: string;
  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), "act-routes-proj-"));
  });
  afterEach(async () => {
    await app?.close();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  function localPlugin(cwd: string, id: string): void {
    const dir = path.join(cwd, ".pi", "npm", "node_modules", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: id, "pi-dashboard-plugin": { id, displayName: id, claims: [] } }));
    fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [`npm:${id}`] }));
  }
  function wiringFor(cwds: string[], pc: unknown[]) {
    return createPluginDiscoveryWiring({
      loadDeps: { createContext: () => ({}) as never, isEnabled: () => true, repoRoot: path.join(tmpProj, "none"), discovery: { piPackages: false } },
      readDeclaredBundledIds: () => undefined,
      listActiveCwds: () => cwds,
      broadcastPluginsChanged: (p) => pc.push(p),
    });
  }
  const getRows = async () => ((await app.inject({ method: "GET", url: "/api/plugins" })).json() as { plugins: any[] }).plugins;

  it("E59(a): a local-detected plugin shows as one never-loaded row with the install-globally copy", async () => {
    const cwd = path.join(tmpProj, "A");
    localPlugin(cwd, "quota");
    const pc: unknown[] = [];
    const w = wiringFor([cwd], pc);
    app = await makeApp(makeRepoRootWithPlugin("other", "Other"));
    w.onSessionRegistered(cwd);
    const rows = await getRows();
    const quota = rows.filter((r) => r.id === "quota");
    expect(quota).toHaveLength(1);
    expect(quota[0].status).toMatchObject({
      id: "quota",
      source: "local-detected",
      enabled: false,
      loaded: false,
      error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable.",
    });
    expect(quota[0].hasServer).toBe(false);
    expect(quota[0].dependents).toEqual([]);
  });

  it("E59(b): the same id also global and loaded → one row, local copy folded into shadowed", async () => {
    const cwd = path.join(tmpProj, "A");
    localPlugin(cwd, "quota");
    const w = wiringFor([cwd], []);
    app = await makeApp(makeRepoRootWithPlugin("quota", "Quota"));
    getPluginStatusStore().setStatus({ id: "quota", displayName: "Quota", enabled: true, loaded: true, claims: 0, source: "workspace" });
    w.onSessionRegistered(cwd);
    const rows = (await getRows()).filter((r) => r.id === "quota");
    expect(rows).toHaveLength(1);
    expect(rows[0].status.shadowed).toEqual([{ source: "local-detected", packageDir: path.join(cwd, ".pi", "npm", "node_modules", "quota") }]);
  });

  it("E60(a): session end → no row in GET /api/plugins, exactly one plugins_changed without it", async () => {
    const cwd = path.join(tmpProj, "A");
    localPlugin(cwd, "quota");
    const cwds = [cwd];
    const pc: PluginStatus[][] = [];
    const w = wiringFor(cwds, pc);
    app = await makeApp(makeRepoRootWithPlugin("other", "Other"));
    w.onSessionRegistered(cwd);
    expect((await getRows()).some((r) => r.id === "quota")).toBe(true);
    cwds.length = 0;
    w.onSessionEnded();
    expect((await getRows()).some((r) => r.id === "quota")).toBe(false);
    expect(pc).toHaveLength(2);
    expect(pc[1].some((p) => p.id === "quota")).toBe(false);
  });

  it("E60(b): two sessions share the cwd; one ends → row kept, 0 extra plugins_changed", async () => {
    const cwd = path.join(tmpProj, "A");
    localPlugin(cwd, "quota");
    const cwds = [cwd, cwd];
    const pc: unknown[] = [];
    const w = wiringFor(cwds, pc);
    app = await makeApp(makeRepoRootWithPlugin("other", "Other"));
    w.onSessionRegistered(cwd);
    cwds.pop();
    w.onSessionEnded();
    expect((await getRows()).some((r) => r.id === "quota")).toBe(true);
    expect(pc).toHaveLength(1);
  });

  it("E64: a removed-but-loaded plugin keeps a restartRequired row; an unrelated store id without discovery is not listed", async () => {
    app = await makeApp(makeRepoRootWithPlugin("here", "Here"));
    const store = getPluginStatusStore();
    store.setStatus({ id: "gone", displayName: "Gone", enabled: true, loaded: true, claims: 1, restartRequired: true, source: "installed" });
    store.setStatus({ id: "ghost", displayName: "Ghost", enabled: true, loaded: false, claims: 0 });
    const rows = await getRows();
    expect(rows.map((r) => r.id).sort()).toEqual(["gone", "here"]);
    expect(rows.find((r) => r.id === "gone").status).toMatchObject({ loaded: true, restartRequired: true });
  });

  it("E64: dependents per row (quota → [quota-ui]), including the removed-but-loaded row", async () => {
    const repoRoot = makeRepoRootWithPluginPair(
      "e64",
      { id: "quota", displayName: "Quota" },
      { id: "quota-ui", displayName: "Quota UI", dependsOn: ["quota"] },
    );
    app = await makeApp(repoRoot);
    getPluginStatusStore().setStatus({ id: "gone", displayName: "Gone", enabled: true, loaded: true, claims: 0, restartRequired: true });
    const byId = new Map((await getRows()).map((r) => [r.id, r]));
    expect(byId.get("quota").dependents).toEqual(["quota-ui"]);
    expect(byId.get("quota-ui").dependents).toEqual([]);
    expect(byId.get("gone").dependents).toEqual([]);
    expect(typeof byId.get("quota").packageDir).toBe("string");
  });

  it("E64: unauthenticated non-loopback → same refusal as the guarded POST config route", async () => {
    const refuse = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.code(403).send({ error: "forbidden" });
    };
    const guarded = Fastify({ logger: false });
    registerPluginActivationRoutes(guarded, { networkGuard: refuse as never, broadcast: () => {}, repoRoot: makeRepoRootWithPlugin("g", "G") });
    guarded.post("/api/config/plugins/:id", { preHandler: refuse as never }, async () => ({ ok: true }));
    await guarded.ready();
    app = guarded;
    const a = await guarded.inject({ method: "GET", url: "/api/plugins" });
    const b = await guarded.inject({ method: "POST", url: "/api/config/plugins/g", payload: {} });
    expect(a.statusCode).toBe(403);
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.body).toBe(b.body);
  });
});

// decouple-plugins-from-core task 6.7 — test-plan #E76 / #E77: admission and one refusal reason.
describe("runtime client admission through status + listing (E76, E77)", () => {
  let app: FastifyInstance;
  let repoRoot: string;
  const SHA = "d".repeat(64);

  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.mkdirSync(path.join(HOME_OVERRIDE, ".pi", "dashboard"), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    repoRoot = path.join(os.tmpdir(), `runtime-admit-${process.pid}-${Date.now()}`);
  });
  afterEach(async () => {
    await app?.close();
    resetRuntimeClientRegistry();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function mk(id: string, extra: Record<string, unknown> = {}) {
    const dir = path.join(repoRoot, "packages", id);
    fs.mkdirSync(path.join(dir, "dist", "client"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "client", "index.js"), `export default "${id}";\n`);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: id,
        version: "1.0.0",
        "pi-dashboard-plugin": { id, displayName: id, claims: [], client: "./src/c.tsx", clientBundle: "./dist/client/index.js", hostApi: "^1.0.0", ...extra },
      }),
    );
  }
  const seed = (id: string, over: Partial<PluginStatus> = {}) =>
    getPluginStatusStore().setStatus({ id, displayName: id, enabled: true, loaded: true, claims: 0, ...over });
  const config = (plugins: Record<string, unknown> = {}) =>
    fs.writeFileSync(path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json"), JSON.stringify({ plugins }));

  async function boot(declared: string[] | undefined) {
    const reg = installRuntimeClientRegistry({ repoRoot, declaredIds: () => declared });
    app = await makeApp(repoRoot);
    const res = await app.inject({ method: "GET", url: "/api/plugins" });
    const rows = new Map<string, any>((res.json().plugins as any[]).map((r) => [r.id, r]));
    return { reg, client: (id: string) => rows.get(id)?.status?.client, listed: () => reg.getAdmittedRuntimePlugins().map((p) => p.id) };
  }

  it.each([
    ["untrusted", () => { mk("ext"); config(); }, ["flows"]],
    ["pin-mismatch", () => { mk("ext"); config(); grantClientTrust("ext", SHA); }, ["flows"]],
    ["host-api", () => { mk("ext", { hostApi: "^2.0.0" }); config(); }, ["flows"]],
    ["no-bundle", () => { mk("ext", { clientBundle: undefined }); config(); }, ["flows"]],
    ["build-undeclared", () => { mk("ext"); config(); }, undefined],
    ["disabled", () => { mk("ext"); config({ ext: { enabled: false } }); }, ["flows"]],
    ["missing-dep", () => { mk("quota"); mk("ext", { dependsOn: ["quota"] }); config({ quota: { enabled: false } }); seed("quota", { enabled: false, loaded: false }); }, ["flows"]],
  ] as const)("E76 %s: that exact reason, absent from the listing", async (reason, setup, declared) => {
    setup();
    seed("ext");
    const { client, listed } = await boot(declared as string[] | undefined);
    expect(client("ext")).toMatchObject({ delivery: "refused", refusedReason: reason });
    expect(listed()).not.toContain("ext");
  });

  it("E76 all-pass: runtime + sha256 in the guarded status, listed; health strips the hash", async () => {
    mk("ext");
    config();
    seed("ext");
    const probe = installRuntimeClientRegistry({ repoRoot, declaredIds: () => ["flows"] });
    const sha = probe.currentContentHash("ext") as string;
    grantClientTrust("ext", sha);
    const { client, listed, reg } = await boot(["flows"]);
    expect(client("ext")).toEqual({ delivery: "runtime", sha256: sha });
    expect(listed()).toEqual(["ext"]);
    expect(reg.getAdmittedAssetRoot("ext", sha)).toBeTruthy();
    const health = toHealthPlugins(getPluginStatusStore().listAll()).find((p) => p.id === "ext");
    expect(health?.client).toEqual({ delivery: "runtime" });
  });

  it("E77(e) a {id, server:true} entry without clientSha256 reports untrusted and is not listed", async () => {
    mk("ext");
    config();
    seed("ext");
    grantServerTrust("ext");
    const { client, listed } = await boot(["flows"]);
    expect(client("ext")).toMatchObject({ delivery: "refused", refusedReason: "untrusted" });
    expect(listed()).toEqual([]);
  });

  it("E77(a) untrusted + disabled + missing-dep → exactly disabled", async () => {
    mk("quota");
    mk("ext", { dependsOn: ["quota"] });
    config({ ext: { enabled: false }, quota: { enabled: false } });
    seed("ext", { enabled: false, loaded: false });
    seed("quota", { enabled: false, loaded: false });
    const { client } = await boot(["flows"]);
    expect(client("ext")?.refusedReason).toBe("disabled");
  });

  it("E77(d) missing-dep + pin-mismatch → missing-dep", async () => {
    mk("quota");
    mk("ext", { dependsOn: ["quota"] });
    config({ quota: { enabled: false } });
    seed("ext");
    seed("quota", { enabled: false, loaded: false });
    grantClientTrust("ext", SHA);
    const { client } = await boot(["flows"]);
    expect(client("ext")?.refusedReason).toBe("missing-dep");
  });

  it("a bundled id reports delivery bundled and is never listed; clients need no install", async () => {
    mk("flows");
    config();
    seed("flows");
    const { client, listed } = await boot(["flows"]);
    expect(client("flows")).toEqual({ delivery: "bundled" });
    expect(listed()).toEqual([]);
    expect(getRuntimeClientRegistry()).toBeDefined();
  });
});

// ── decouple-plugins-from-core 6.11 / 6.12 / 6.20 — listing, trust endpoints, admission log ──────────────────

describe("runtime-client routes: listing, trust grant / revoke, admission log (E85, E81, E79, E61, E92)", () => {
  let app: FastifyInstance;
  let repoRoot: string;
  const broadcasts: any[] = [];
  const lines: string[] = [];
  const configFile = () => path.join(HOME_OVERRIDE, ".pi", "dashboard", "config.json");
  const readConfig = () => JSON.parse(fs.readFileSync(configFile(), "utf-8")) as Record<string, any>;
  const writeConfig = (cfg: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
  };

  beforeEach(() => {
    clearDiscoveryCache();
    clearStatusStore();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    repoRoot = path.join(os.tmpdir(), `runtime-routes-${process.pid}-${Date.now()}`);
    broadcasts.length = 0;
    lines.length = 0;
    writeConfig({});
  });
  afterEach(async () => {
    await app?.close();
    resetRuntimeClientRegistry();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function mk(id: string, extra: Record<string, unknown> = {}) {
    const dir = path.join(repoRoot, "packages", id);
    fs.mkdirSync(path.join(dir, "dist", "client"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "client", "index.js"), `export default "${id}";\n`);
    fs.writeFileSync(path.join(dir, "dist", "client", "y.js"), "export default 2;\n");
    fs.writeFileSync(path.join(dir, "dist", "client", "s.css"), "body{}\n");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: id,
        version: "1.0.0",
        "pi-dashboard-plugin": { id, displayName: id, claims: [], client: "./src/c.tsx", clientBundle: "./dist/client/index.js", hostApi: "^1.0.0", ...extra },
      }),
    );
  }
  const seed = (id: string) => getPluginStatusStore().setStatus({ id, displayName: id, enabled: true, loaded: true, claims: 0 });

  async function boot(opts: { refresh?: () => Promise<void>; declared?: string[] } = {}) {
    const reg = installRuntimeClientRegistry({ repoRoot, declaredIds: () => opts.declared ?? ["flows"] });
    app = Fastify({ logger: false });
    registerPluginRuntimeClientRoutes(app, {
      networkGuard: async () => undefined,
      broadcast: (m) => broadcasts.push(m),
      refreshDiscovery: opts.refresh ?? (async () => {}),
      log: { info: (m) => lines.push(m) },
      repoRoot,
    });
    registerPluginAssetsRoute(app, { getRegistry: getRuntimeClientRegistry });
    await app.ready();
    return reg;
  }
  const changed = () => broadcasts.filter((m) => m.type === "plugins_changed");

  it("E85: the listing carries admitted plugins only — five route fields, module / entry / style URLs, event types, no i18n URL", async () => {
    mk("ext", {
      claims: [
        { slot: "shell-overlay-route", component: "Board", path: "/ext/:sid", depth: 2, parentPath: "/session/:sid", presentation: "page", sessionParam: "sid" },
        { slot: "settings-section", component: "Lazy", module: "./dist/client/y.js" },
      ],
      i18nCatalog: "catalog",
      clientStyles: "./dist/client/s.css",
      eventTypes: ["ext:ping"],
    });
    mk("refused");
    seed("ext");
    seed("refused");
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    grantClientTrust("ext", sha);
    const res = await app.inject({ method: "GET", url: "/api/plugins/runtime-clients" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { plugins: any[] };
    expect(body.plugins.map((p) => p.id)).toEqual(["ext"]);
    const ext = body.plugins[0];
    const base = `/plugin-assets/ext/${sha}/`;
    expect(ext.entry).toBe(`${base}index.js`);
    expect(ext.styles).toBe(`${base}s.css`);
    expect(ext.sha256).toBe(sha);
    expect(ext.eventTypes).toEqual(["ext:ping"]);
    expect(ext.i18nCatalog).toBe("catalog"); // an export NAME of the entry module
    expect(ext.claims[0]).toMatchObject({ slot: "shell-overlay-route", path: "/ext/:sid", depth: 2, parentPath: "/session/:sid", presentation: "page", sessionParam: "sid" });
    expect(ext.claims[1].module).toBe(`${base}y.js`);
    expect(ext.routes).toEqual([{ pattern: "/ext/:sid", depth: 2, parentPath: "/session/:sid" }]);
    for (const url of [ext.entry, ext.styles, ext.claims[1].module]) {
      expect(url.startsWith(base)).toBe(true);
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    }
    expect(JSON.stringify(body)).not.toMatch(/i18n[^"]*\.(json|js)/i);
    expect(JSON.stringify(body)).not.toContain("refused");
  });

  it("E81: a local grant with the current sha writes the entry, logs id + action + 12-hex prefix and broadcasts one plugins_changed", async () => {
    mk("ext");
    seed("ext");
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    const res = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload: { sha256: sha } });
    expect(res.statusCode).toBe(200);
    expect(readConfig().auth.trustedPlugins).toEqual([{ id: "ext", clientSha256: sha }]);
    expect(changed()).toHaveLength(1);
    const grant = lines.find((l) => l.includes("[plugin-trust]"));
    expect(grant).toContain("id=ext");
    expect(grant).toContain("action=grant-client");
    expect(grant).toMatch(/sha=[0-9a-f]{12}(\s|$)/);
    expect(lines.join("\n")).not.toContain(sha);
    expect(reg.getAdmittedAssetRoot("ext", sha)).toBeTruthy();
  });

  it("E81: a stale sha is 409 and leaves config + broadcasts untouched", async () => {
    mk("ext");
    seed("ext");
    await boot();
    const res = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload: { sha256: "0".repeat(64) } });
    expect(res.statusCode).toBe(409);
    expect(readConfig().auth).toBeUndefined();
    expect(changed()).toHaveLength(0);
  });

  it("E81: a remote caller's POST is refused (non-2xx), config unchanged", async () => {
    mk("ext");
    seed("ext");
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    const res = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", remoteAddress: "203.0.113.5", payload: { sha256: sha } });
    expect(res.statusCode).toBe(403);
    expect(readConfig().auth).toBeUndefined();
    expect(changed()).toHaveLength(0);
  });

  it("E81: malformed bodies are 400; an unknown plugin is 404", async () => {
    mk("ext");
    seed("ext");
    await boot();
    for (const payload of [{}, { sha256: "nope" }, { server: false }, { server: true, sha256: "a".repeat(64) }]) {
      expect((await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: "/api/plugins/ghost/trust", payload: { server: true } })).statusCode).toBe(404);
    // server trust only applies to a pi-package plugin with a server entry
    expect((await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload: { server: true } })).statusCode).toBe(400);
  });

  it("E79: a grant keeps every other auth key byte-equal and the legacy capabilityRoutePlugins list", async () => {
    mk("ext");
    seed("ext");
    const auth = { capabilityRoutePlugins: ["wall"], bypassHosts: ["10.0.0.0/8"], providers: { github: { clientId: "x" } }, futureKey: { nested: [1, 2] } };
    writeConfig({ theme: "dark", auth });
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    expect((await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload: { sha256: sha } })).statusCode).toBe(200);
    const cfg = readConfig();
    expect(cfg.theme).toBe("dark");
    expect(cfg.auth).toEqual({ ...auth, trustedPlugins: [{ id: "ext", clientSha256: sha }] });
  });

  it("E81: DELETE removes the whole entry; a second DELETE is an idempotent 200", async () => {
    mk("ext");
    seed("ext");
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    grantClientTrust("ext", sha);
    grantServerTrust("ext");
    const res = await app.inject({ method: "DELETE", url: "/api/plugins/ext/trust" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, removed: true });
    expect(readConfig().auth).toBeUndefined();
    expect(changed()).toHaveLength(1);
    expect(lines.find((l) => l.includes("action=revoke"))).toMatch(/id=ext .*sha=[0-9a-f]{12}$/);
    expect(reg.getAdmittedAssetRoot("ext", sha)).toBeUndefined();
    expect((await app.inject({ method: "DELETE", url: "/api/plugins/ext/trust" })).json()).toMatchObject({ removed: false });
  });

  it("E92: a refused plugin logs one structured line per refresh/trust cycle: id, source, delivery, reason, 12-hex prefix only", async () => {
    mk("ext");
    seed("ext");
    const reg = await boot();
    const sha = reg.currentContentHash("ext") as string;
    // pin a DIFFERENT hash → pin-mismatch, hash still known to the registry
    grantClientTrust("ext", "f".repeat(64));
    getPluginStatusStore().setStatus({ ...(getPluginStatusStore().getStoredStatus("ext") as PluginStatus), source: "workspace" });
    const marker = "BEARER-SECRET-123";
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/ext/trust",
      headers: { authorization: `Bearer ${marker}` },
      payload: { sha256: "1".repeat(64), note: "BODY-SUBSTRING-XYZ" },
    });
    expect(res.statusCode).toBe(409); // stale: no write, no admission line for a rejected request
    logRuntimeAdmissions({ info: (m) => lines.push(m) }, "refresh");
    const admission = lines.filter((l) => l.includes("[plugin-runtime] admission"));
    expect(admission).toHaveLength(1);
    expect(admission[0]).toContain("trigger=refresh");
    expect(admission[0]).toContain("id=ext");
    expect(admission[0]).toContain("source=workspace");
    expect(admission[0]).toContain("delivery=refused");
    expect(admission[0]).toContain("reason=pin-mismatch");
    expect(admission[0]).toMatch(new RegExp(`sha=${sha.slice(0, 12)}$`));
    const all = lines.join("\n");
    expect(all).not.toContain(sha);
    expect(all).not.toMatch(/[0-9a-f]{64}/);
    expect(all).not.toContain(marker);
    expect(all).not.toContain("BODY-SUBSTRING-XYZ");
    // a successful trust change logs the new verdict
    lines.length = 0;
    const ok = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", payload: { sha256: sha } });
    expect(ok.statusCode).toBe(200);
    const after = lines.filter((l) => l.includes("[plugin-runtime] admission"));
    expect(after).toHaveLength(1);
    expect(after[0]).toContain("trigger=trust");
    expect(after[0]).toContain("delivery=runtime");
  });
});

// E61 (c)–(e): the trust endpoint grants pi-package server trust, additively, through the real discovery wiring.
describe("pi-package server trust through the endpoint (E61 c–e, E81)", () => {
  let tmpRoot: string;
  let app: FastifyInstance;
  let wiring: ReturnType<typeof createPluginDiscoveryWiring>;
  const broadcasts: any[] = [];

  beforeEach(async () => {
    clearDiscoveryCache();
    clearStatusStore();
    clearLoadedSnapshots();
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.mkdirSync(path.join(HOME_OVERRIDE, ".pi", "dashboard"), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = HOME_OVERRIDE;
    // Server entries are imported by file URL; vite-node only resolves them under node_modules.
    tmpRoot = path.join(os.tmpdir(), `pkg-trust-${process.pid}-${Date.now()}`);
    const agentDir = path.join(tmpRoot, "node_modules", "agent");
    const dir = path.join(agentDir, "npm", "node_modules", "pi-ok");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "server.mjs"), `export default () => { (globalThis.__trustSpy ||= []).push("ok"); };\n`);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "pi-ok", version: "1.0.0", "pi-dashboard-plugin": { id: "okplug", displayName: "ok", claims: [], server: "./server.mjs", hostApi: "^1.0.0" } }),
    );
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-ok"] }));
    (globalThis as { __trustSpy?: string[] }).__trustSpy = [];
    broadcasts.length = 0;
    const loadDeps = {
      createContext: () => ({}) as never,
      isEnabled: () => true,
      repoRoot: path.join(tmpRoot, "root"),
      discovery: { piPackages: { agentDir, npmRoot: path.join(tmpRoot, "no-global") } },
      isServerTrusted,
    };
    wiring = createPluginDiscoveryWiring({
      loadDeps,
      readDeclaredBundledIds: () => undefined,
      listActiveCwds: () => [],
      broadcastPluginsChanged: (plugins) => broadcasts.push({ type: "plugins_changed", plugins }),
    });
    await loadServerEntries(loadDeps);
    app = Fastify({ logger: false });
    registerPluginRuntimeClientRoutes(app, {
      networkGuard: async () => undefined,
      broadcast: (m) => broadcasts.push(m),
      refreshDiscovery: () => wiring.refreshPluginDiscovery(),
      log: { info: () => {} },
      repoRoot: path.join(tmpRoot, "root"),
      discovery: loadDeps.discovery,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app?.close();
    delete (globalThis as { __trustSpy?: string[] }).__trustSpy;
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  const spy = () => (globalThis as { __trustSpy?: string[] }).__trustSpy ?? [];
  const row = () => getPluginStatusStore().getStatus("okplug");

  it("(a) before any grant the entry is refused server-untrusted and its sentinel is not written", () => {
    expect(row()).toMatchObject({ loaded: false, error: "server-untrusted", source: "pi-package" });
    expect(spy()).toEqual([]);
  });

  it("(d) a REMOTE operate caller cannot grant: refused, entry still untrusted", async () => {
    const res = await app.inject({ method: "POST", url: "/api/plugins/okplug/trust", remoteAddress: "203.0.113.5", payload: { server: true } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(readTrustedPlugins()).toEqual([]);
    expect(spy()).toEqual([]);
    expect(row()?.loaded).toBe(false);
  });

  it("(c) a local {server:true} grant loads the entry additively — one plugins_changed, entry run exactly once, no restart", async () => {
    const res = await app.inject({ method: "POST", url: "/api/plugins/okplug/trust", payload: { server: true } });
    expect(res.statusCode).toBe(200);
    expect(readTrustedPlugins()).toEqual([{ id: "okplug", server: true }]);
    expect(spy()).toEqual(["ok"]);
    expect(row()).toMatchObject({ loaded: true });
    expect(row()?.restartRequired).toBeUndefined();
    expect(broadcasts.filter((m) => m.type === "plugins_changed")).toHaveLength(1);
  });

  it("(e) revoking after the load flags restartRequired and drops the whole entry", async () => {
    await app.inject({ method: "POST", url: "/api/plugins/okplug/trust", payload: { server: true } });
    broadcasts.length = 0;
    const res = await app.inject({ method: "DELETE", url: "/api/plugins/okplug/trust" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ removed: true, restartRequired: true });
    expect(readTrustedPlugins()).toEqual([]);
    expect(row()).toMatchObject({ loaded: true, restartRequired: true });
    const [last] = broadcasts.filter((m) => m.type === "plugins_changed").slice(-1);
    expect(last.plugins.find((p: PluginStatus) => p.id === "okplug")?.restartRequired).toBe(true);
  });
});
