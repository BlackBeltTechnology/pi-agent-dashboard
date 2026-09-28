/**
 * Route tests for `GET /api/plugins` and `POST /api/plugins/:id/toggle`.
 *
 * See change: add-plugin-activation-ui.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginActivationRoutes } from "../routes/plugin-activation-routes.js";
import {
  clearDiscoveryCache,
  clearStatusStore,
  discoverPlugins,
  getPluginStatusStore,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

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

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("plugin_config_update");
    expect((broadcasts[0] as any).id).toBe("act-b");
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

    // Two broadcasts, one per affected id.
    const ids = broadcasts.map((m) => (m as { id: string }).id).sort();
    expect(ids).toEqual(["cas-a", "cas-b"]);
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
