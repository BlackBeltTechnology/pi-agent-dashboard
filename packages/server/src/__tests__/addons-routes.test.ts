/**
 * GET /api/addons/catalog route tests.
 * See change: addons-hub-feature-catalog (test-plan #E7, #E20 route half).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddonsEnv } from "./addons-fixture.js";

let env: AddonsEnv;
afterEach(async () => {
  await env?.cleanup();
});

describe("GET /api/addons/catalog", () => {
  // test-plan #E7
  it("orders core → displayName (case-insensitive) → id and adds no registry call", async () => {
    env = new AddonsEnv("order");
    env.addPlugin({ id: "z1", displayName: "zeta" });
    env.addPlugin({ id: "a2", displayName: "alpha" });
    env.addPlugin({ id: "a1", displayName: "Alpha" });
    // local package → the enricher's published-variant lookup is the ONLY npm call
    env.addPackage("/local/solo", { name: "solo-pkg", dir: `${env.home}/local-solo` });
    env.writeSettings({ packages: ["/local/solo"] });
    const lookupNpm = vi.fn(async () => ({ version: "1.2.3" }));
    await env.makeApp({ lookupNpm });

    const { status, body } = await env.catalog();
    expect(status).toBe(200);
    const ids = body.features.map((f) => f.id);
    expect(ids[0]).toBe("core:pi");
    expect(ids.filter((id) => id.startsWith("plugin:"))).toEqual(["plugin:a1", "plugin:a2", "plugin:z1"]);
    // one lookup for the one non-npm row, nothing added by the catalog
    expect(lookupNpm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("updateAvailable");
  });

  it("reports state from the settings entry (partial / off)", async () => {
    env = new AddonsEnv("state");
    env.addPlugin({ id: "goal", packageName: "@blackbelt-technology/pi-dashboard-goal-plugin", requires: ["@ricoyudog/pi-goal-hermes"], enabled: false });
    env.addPackage("npm:@ricoyudog/pi-goal-hermes", { name: "@ricoyudog/pi-goal-hermes" });
    env.writeSettings({ packages: ["npm:@ricoyudog/pi-goal-hermes"] });
    await env.makeApp();
    const goal = (await env.catalog()).body.features.find((f) => f.id === "plugin:goal");
    expect(goal.state).toBe("partial");
    expect(goal.origin).toBe("mixed");
    expect(goal.authorLabels).toEqual(["@ricoyudog"]);
  });

  // test-plan #E20 (route half): GC on catalog build
  it("deletes restore records whose entry is gone", async () => {
    env = new AddonsEnv("gc");
    env.addPlugin({ id: "goal", requires: ["g"] });
    env.addPackage("npm:g", { name: "g" });
    env.writeSettings({ packages: ["npm:g"] });
    await env.makeApp();
    const off = await env.toggle("plugin:goal", { enabled: false });
    expect(off.status).toBe(200);
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(1);
    // uninstall: entry + row disappear
    env.rows.length = 0;
    env.writeSettings({ packages: [] });
    await env.catalog();
    expect(Object.keys(env.readRestore()?.records ?? {})).toHaveLength(0);
  });
});
