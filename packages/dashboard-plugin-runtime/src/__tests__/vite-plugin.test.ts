// @vitest-environment node
// (node, not jsdom: the real Vite/esbuild builds below break under jsdom's TextEncoder.)
/**
 * Tests for the Vite plugin manifest scanning and registry generation.
 * We test the generation logic without spinning up a real Vite server.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_IMPORT_MAP_SPECIFIERS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-import-map.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiscoveryCache } from "../server/loader.js";
import { buildDashboardClient, CLIENT_PRESET_EXTERNALS, clientStylesTemplate } from "../vite-plugin/index.js";

// We test the generation by importing the internal helpers via the vite-plugin module.
// Since the plugin is exported, we call buildStart directly.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-plugin-test-"));
  clearDiscoveryCache();
  // Write a fake packages dir
  fs.mkdirSync(path.join(tmpDir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

function writePlugin(name: string, manifest: Record<string, unknown>) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, "pi-dashboard-plugin": manifest }),
  );
}

async function invokePlugin(isProd = false): Promise<string> {
  const oldEnv = process.env.NODE_ENV;
  if (isProd) process.env.NODE_ENV = "production";
  try {
    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    const plugin = viteDashboardPluginsPlugin(tmpDir);
    // Call buildStart manually
    await (plugin as { buildStart?: () => void }).buildStart?.();

    const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
    return fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
  } finally {
    process.env.NODE_ENV = oldEnv;
    clearDiscoveryCache();
  }
}

describe("viteDashboardPluginsPlugin", () => {
  it("generates registry with named imports for claimed components", async () => {
    writePlugin("openspec-plugin", {
      id: "openspec",
      displayName: "OpenSpec",
      priority: 100,
      client: "./dist/client/index.js",
      claims: [
        { slot: "session-card-badge", component: "OpenSpecBadge" },
        { slot: "settings-section", component: "OpenSpecSettings", tab: "general" },
      ],
    });

    const content = await invokePlugin();
    // Should use named imports, not import *
    expect(content).toContain("import { OpenSpecBadge, OpenSpecSettings }");
    expect(content).not.toContain("import * as");
    expect(content).toContain("PLUGIN_REGISTRY");
    expect(content).toContain('"openspec"');
  });

  // test-plan #E5 — see change: add-plugin-app-host.
  it("emits presentation: \"content\" as a top-level ClaimEntry field", async () => {
    writePlugin("wall-plugin", {
      id: "wall",
      displayName: "Wall",
      priority: 100,
      client: "./dist/client/index.js",
      claims: [
        {
          slot: "shell-overlay-route",
          component: "WallRoute",
          path: "/folder/:encodedCwd/wall/*?",
          depth: 2,
          parentPath: "/folder/:encodedCwd",
          presentation: "content",
        },
      ],
    });

    const content = await invokePlugin();
    const line = content.split("\n").find((l) => l.includes('slot: "shell-overlay-route"'));
    expect(line).toBeDefined();
    expect(line).toContain('presentation: "content"');
    expect(line).toContain('path: "/folder/:encodedCwd/wall/*?"');
    expect(line).not.toMatch(/config:[^}]*presentation/);
  });

  it("skips fixture plugins in production", async () => {
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });

    const content = await invokePlugin(true);
    // demo plugin should not appear in production bundle
    expect(content).not.toContain("demo");
    expect(content).not.toContain("DemoBadge");
  });

  it("E4: cross-plugin customType collision fails the build naming BOTH plugins + the type", async () => {
    writePlugin("alpha-plugin", {
      id: "alpha",
      displayName: "Alpha",
      client: "./dist/client/index.js",
      claims: [
        { slot: "custom-entry-renderer", customType: "om.reflections.recorded", component: "AlphaRow" },
      ],
    });
    writePlugin("beta-plugin", {
      id: "beta",
      displayName: "Beta",
      client: "./dist/client/index.js",
      claims: [
        { slot: "custom-entry-renderer", customType: "om.reflections.recorded", component: "BetaRow" },
      ],
    });

    let message = "";
    try {
      await invokePlugin();
      expect.fail("should have thrown");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("alpha");
    expect(message).toContain("beta");
    expect(message).toContain("om.reflections.recorded");
    // No registry emitted on a fatal collision.
    const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
    expect(fs.existsSync(outPath)).toBe(false);
  });

  it("E5: distinct customTypes across plugins build fine; both claims land in the registry", async () => {
    writePlugin("alpha-plugin", {
      id: "alpha",
      displayName: "Alpha",
      client: "./dist/client/index.js",
      claims: [
        { slot: "custom-entry-renderer", customType: "om.observations.recorded", component: "AlphaRow" },
      ],
    });
    writePlugin("beta-plugin", {
      id: "beta",
      displayName: "Beta",
      client: "./dist/client/index.js",
      claims: [
        { slot: "custom-entry-renderer", customType: "om.reflections.recorded", component: "BetaRow" },
      ],
    });

    const content = await invokePlugin();
    expect(content).toContain('customType: "om.observations.recorded"');
    expect(content).toContain('customType: "om.reflections.recorded"');
    expect(content).toContain("AlphaRow");
    expect(content).toContain("BetaRow");
  });

  it("does not regenerate when manifest content hasn't changed", async () => {
    writePlugin("stable-plugin", {
      id: "stable",
      displayName: "Stable",
      client: "./dist/client/index.js",
      claims: [],
    });

    // First generation
    const content1 = await invokePlugin();
    // Second generation — must produce same content
    const content2 = await invokePlugin();
    expect(content1).toBeTruthy();
    expect(content1).toBe(content2);
  });
});

// test-plan #E15 — see change: decouple-plugins-from-core (task 2.11, 8.23).
describe("plugin-sources.css generation", () => {
  const sourcesPath = () => path.join(tmpDir, "packages", "client", "src", "generated", "plugin-sources.css");

  function writeClientFile(pkg: string, rel: string, src: string) {
    const full = path.join(tmpDir, "packages", pkg, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, src, "utf-8");
  }

  function writeSources() {
    writePlugin("zeta-plugin", {
      id: "zeta",
      displayName: "Zeta",
      client: "./src/client/index.tsx",
      claims: [{ slot: "session-card-badge", component: "ZetaBadge" }],
    });
    writeClientFile("zeta-plugin", "src/client/index.tsx", "export function ZetaBadge() { return null; }\n");
    writePlugin("alpha-plugin", {
      id: "alpha",
      displayName: "Alpha",
      client: "./src/client.tsx",
      claims: [{ slot: "session-card-badge", component: "AlphaBadge" }],
    });
    writeClientFile("alpha-plugin", "src/client.tsx", "export function AlphaBadge() { return null; }\n");
    // Fixture plugin: included by the sources file regardless of build policy.
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./src/client.tsx",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });
    writeClientFile("demo-plugin", "src/client.tsx", "export function DemoBadge() { return null; }\n");
    // Claim module outside the client dir.
    writePlugin("board-plugin", {
      id: "board",
      displayName: "Board",
      client: "./src/client/index.tsx",
      claims: [{ slot: "settings-section", component: "Board", module: "./src/board/Board.tsx" }],
    });
    writeClientFile("board-plugin", "src/client/index.tsx", "export const X = 1;\n");
    writeClientFile("board-plugin", "src/board/Board.tsx", "export function Board() { return null; }\n");
    // No client entry => not client-bearing => no line.
    writePlugin("server-only-plugin", { id: "server-only", displayName: "S", claims: [] });
  }

  it("emits one sorted @source line per client-bearing plugin, relative to generated/, plus outside claim module dirs", async () => {
    writeSources();
    await invokePlugin();
    const lines = fs
      .readFileSync(sourcesPath(), "utf-8")
      .split("\n")
      .filter((l) => l.startsWith("@source"));
    expect(lines).toEqual([
      '@source "../../../alpha-plugin/src";',
      '@source "../../../board-plugin/src/board";',
      '@source "../../../board-plugin/src/client";',
      '@source "../../../demo-plugin/src";',
      '@source "../../../zeta-plugin/src/client";',
    ]);
  });

  it("dev (fixtures included) and production (fixtures excluded) produce byte-identical files", async () => {
    writeSources();
    await invokePlugin(false);
    const dev = fs.readFileSync(sourcesPath(), "utf-8");
    fs.rmSync(sourcesPath());
    await invokePlugin(true);
    const prod = fs.readFileSync(sourcesPath(), "utf-8");
    expect(prod).toBe(dev);
    expect(prod).toContain("demo-plugin/src");
  });

  it("an unchanged plugin set causes no rewrite", async () => {
    writeSources();
    await invokePlugin();
    const before = fs.statSync(sourcesPath()).mtimeMs;
    const content = fs.readFileSync(sourcesPath(), "utf-8");
    await new Promise((r) => setTimeout(r, 20));
    await invokePlugin();
    expect(fs.statSync(sourcesPath()).mtimeMs).toBe(before);
    expect(fs.readFileSync(sourcesPath(), "utf-8")).toBe(content);
  });

  it("generatePluginSourcesContent is a pure function of the manifests", async () => {
    writeSources();
    const { generatePluginSourcesContent } = await import("../vite-plugin/index.js");
    const a = generatePluginSourcesContent(tmpDir);
    clearDiscoveryCache();
    expect(generatePluginSourcesContent(tmpDir)).toBe(a);
  });
});


// ── SDK client preset (tasks 7.2, 7.3; tests 8.133 / test-plan #E96, 8.129 / #E95 artifact half) ─────────
// Real Vite builds of tiny fixtures. See change: decouple-plugins-from-core.

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "client-preset");
const BUILD_TIMEOUT = 120_000;

async function presetBuild(fixture: string, extra: Record<string, unknown> = {}): Promise<string> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "client-preset-out-"));
  await buildDashboardClient({
    root: path.join(FIXTURES, fixture),
    entry: "index.tsx",
    outDir,
    ...extra,
  });
  return outDir;
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

describe("dashboard client preset", () => {
  it("externals are exactly the host import-map specifiers", () => {
    expect([...CLIENT_PRESET_EXTERNALS]).toEqual([...HOST_IMPORT_MAP_SPECIFIERS]);
  });

  it("CSS template is utilities-only: theme as reference, utilities, no preflight, no :root", () => {
    const css = clientStylesTemplate(["/abs/src"]);
    expect(css).toContain('@import "tailwindcss/theme.css" theme(reference);');
    expect(css).toContain('@import "tailwindcss/utilities.css";');
    expect(css).toContain('@source "/abs/src";');
    expect(css).not.toMatch(/preflight|@import "tailwindcss";|:root/);
  });

  it("(f) clean fixture: ES entry + lazy chunk + utilities-only CSS; every import-map specifier external", async () => {
    const out = await presetBuild("clean", { lazyModules: { lazy: "lazy.tsx" } });
    try {
      const entry = read(out, "index.js");
      // Every import-map specifier stays a bare import (and nothing else bare is imported).
      const bare = new Set([...entry.matchAll(/from\s*["']([^"'./][^"']*)["']|import\s*["']([^"'./][^"']*)["']/g)].map((m) => m[1] ?? m[2]));
      expect([...bare].sort()).toEqual([...HOST_IMPORT_MAP_SPECIFIERS].sort());
      // No bundled React (and no preload helper that would need a DOM).
      expect(entry).not.toMatch(/react\.transitional\.element|__vitePreload/);
      // Lazy chunk emitted as its own file, with its own component export.
      expect(fs.existsSync(path.join(out, "lazy.js"))).toBe(true);
      expect(read(out, "lazy.js")).toMatch(/export\s*\{[^}]*LazyPanel/);
      // The lazy module is NOT pulled into the entry.
      expect(entry).not.toContain("LazyPanel");
      // Utilities-only stylesheet: utilities present, no reset, no :root theme, host var passed through.
      const css = read(out, "client.css");
      expect(css).toMatch(/\.flex\b/);
      expect(css).toMatch(/\.grid\b/);
      expect(css).toContain("var(--bg-surface)");
      expect(css).not.toMatch(/\*,\s*::before|::backdrop|box-sizing:\s*border-box|:root|:host/);
      expect(fs.readdirSync(out).filter((f) => f.endsWith(".css"))).toEqual(["client.css"]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, BUILD_TIMEOUT);

  it("(a) bundling React fails the build, naming the module and the import-map specifier", async () => {
    await expect(presetBuild("bundle-react")).rejects.toThrow(/node_modules\/react\/[\s\S]*"react", "react\/jsx-runtime", "react-dom" or "react-dom\/client"/);
  }, BUILD_TIMEOUT);

  it.each([
    ["(b) LayerPortal", "layer-portal", "LayerPortal"],
    ["(c) useMobile", "use-mobile", "useMobile"],
    ["(d) escape-stack", "escape-stack", "escape-stack"],
    ["(e) ActionListMenuContext", "action-list-menu-context", "ActionListMenuContext"],
  ])("%s fails the build naming the module", async (_label, fixture, moduleName) => {
    await expect(presetBuild(fixture)).rejects.toThrow(new RegExp(`client-utils/src/${moduleName}\\.[tj]sx?`));
  }, BUILD_TIMEOUT);

  it("unsafeBundleSpecifiers (test-only) bypasses the React half of the guard", async () => {
    const out = await presetBuild("bundle-react", { unsafeBundleSpecifiers: ["react"] });
    try {
      // Built (guard bypassed); the deep React path was bundled, not left as an external import.
      expect(read(out, "index.js")).not.toMatch(/from\s*["']react\/jsx-dev-runtime["']/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, BUILD_TIMEOUT);

  it("standalone config: own React (no externals), relative base, separate outDir", async () => {
    const { dashboardStandaloneViteConfig } = await import("../vite-plugin/index.js");
    const cfg = await dashboardStandaloneViteConfig({ root: path.join(FIXTURES, "clean") });
    expect(cfg.base).toBe("./");
    expect(cfg.build?.outDir).toBe(path.join(FIXTURES, "clean", "dist", "standalone"));
    expect(cfg.build?.rollupOptions?.external).toBeUndefined();
  });
});
