import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPiSettingsRoutes } from "../pi-settings-routes.js";

/**
 * Theme names in the pi settings read response: built-ins plus global/package
 * theme files by their declared `name`. See change: pi-settings-full-coverage
 * (test-plan #E20, #X6).
 */
describe("pi-settings themes", () => {
  let dir: string;
  let app: FastifyInstance;
  let scan: () => Promise<Pick<PiResourcesResult, "global" | "packages">>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-themes-"));
    writeFileSync(join(dir, "settings.json"), "{}");
    app = Fastify();
    registerPiSettingsRoutes(app, {
      networkGuard: async () => {},
      reloadConnectedSessions: () => 0,
      readDashboardConfig: () => ({}),
      fsDeps: { agentDirEnv: dir },
      scanThemes: () => scan(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const themeFile = (file: string, body: string): PiResource => {
    const filePath = join(dir, file);
    writeFileSync(filePath, body);
    return { name: file.replace(/\.json$/, ""), filePath, type: "theme", enabled: true };
  };
  const scope = (themes: PiResource[]) => ({ extensions: [], skills: [], prompts: [], themes, agents: [] });
  const pkg = (themes: PiResource[]) =>
    ({ name: "p", source: "npm:p", resources: scope(themes) }) as unknown as PiResourcesResult["packages"][number];
  const themes = async () => (await app.inject({ method: "GET", url: "/api/pi-settings" })).json().themes as string[];

  it("E20 lists built-ins plus global and package themes by declared name, sorted and de-duplicated", async () => {
    scan = async () => ({
      global: scope([
        themeFile("nord.json", '{"name":"nord"}'),
        themeFile("system.json", '{"name":"system"}'), // reserved
        themeFile("slash.json", '{"name":"a/b"}'), // `/` is the pair separator
      ]),
      packages: [
        pkg([
          themeFile("tokyo.json", '{"name":"tokyo-night"}'),
          themeFile("nord-pkg.json", '{"name":"nord"}'), // collision: still one `nord`
          themeFile("bad.json", "{ not json"), // unreadable
          themeFile("noname.json", "{}"), // falls back to the basename
        ]),
      ],
    });
    expect(await themes()).toEqual(["dark", "light", "noname", "nord", "system", "tokyo-night"]);
  });

  it("E20 a disabled theme is not offered", async () => {
    const t = themeFile("off.json", '{"name":"off"}');
    scan = async () => ({ global: scope([{ ...t, enabled: false }]), packages: [] });
    expect(await themes()).toEqual(["dark", "light", "system"]);
  });

  it("X6 a scanner failure still answers 200 with the built-ins only", async () => {
    scan = async () => {
      throw new Error("resolver exploded");
    };
    const res = await app.inject({ method: "GET", url: "/api/pi-settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().themes).toEqual(["dark", "light", "system"]);
  });

  it("the default scanner reads the configured agent dir (not ~/.pi/agent) and no project settings", async () => {
    // No `scanThemes` seam: the real scanner runs against `agentDirEnv`.
    const themesDir = join(dir, "themes");
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, "only-in-agent-dir.json"), '{"name":"only-in-agent-dir"}');
    const real = Fastify();
    registerPiSettingsRoutes(real, {
      networkGuard: async () => {},
      reloadConnectedSessions: () => 0,
      readDashboardConfig: () => ({}),
      fsDeps: { agentDirEnv: dir },
    });
    try {
      const res = await real.inject({ method: "GET", url: "/api/pi-settings" });
      expect(res.json().themes).toContain("only-in-agent-dir");
    } finally {
      await real.close();
    }
  });
});
