import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, packFixturePlugins } from "../../qa/scripts/pack-fixture-plugin.mjs";

// See change: decouple-plugins-from-core (task 8.6).
describe("qa pack-fixture-plugin", () => {
  const out = mkdtempSync(join(tmpdir(), "qa-pack-"));
  const plugins = packFixturePlugins({ out });

  it("writes both packages with a pi-package manifest + server + bridge entry", () => {
    expect(plugins.map((p) => p.id).sort()).toEqual(Object.values(FIXTURE_IDS).sort());
    for (const p of plugins) {
      const pkg = JSON.parse(readFileSync(join(p.dir, "package.json"), "utf8"));
      expect(pkg.keywords).toContain("pi-package");
      expect(pkg["pi-dashboard-plugin"].id).toBe(p.id);
      expect(existsSync(join(p.dir, pkg["pi-dashboard-plugin"].server))).toBe(true);
      expect(existsSync(join(p.dir, pkg["pi-dashboard-plugin"].bridge))).toBe(true);
    }
  });

  it("ok server entry writes its sentinel when run; the throws variant throws", async () => {
    const ok = plugins.find((p) => p.id === FIXTURE_IDS.ok);
    const bad = plugins.find((p) => p.id === FIXTURE_IDS.throws);
    expect(existsSync(ok.sentinel)).toBe(false);
    (await import(join(ok.dir, "server.js"))).default();
    expect(existsSync(ok.sentinel)).toBe(true);
    await expect(import(join(bad.dir, "server.js"))).rejects.toThrow(/failed on load/);
  });

  it("is idempotent (re-pack replaces the directory)", () => {
    expect(() => packFixturePlugins({ out })).not.toThrow();
  });
});
