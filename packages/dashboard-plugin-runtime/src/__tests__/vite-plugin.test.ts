/**
 * Tests for the Vite plugin manifest scanning and registry generation.
 * We test the generation logic without spinning up a real Vite server.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache } from "../server/loader.js";

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
