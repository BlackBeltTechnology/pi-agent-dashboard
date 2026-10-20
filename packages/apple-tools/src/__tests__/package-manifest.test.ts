/**
 * Package-manifest invariants (#E30 opt-in invocation, #E34 bundling contract).
 * See change: add-apple-tools-imcp-plugin.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));

describe("package manifest", () => {
  it("#E30: declares NO postinstall / lifecycle script (provisioning is opt-in)", () => {
    const scripts = pkg.scripts ?? {};
    for (const hook of ["postinstall", "install", "preinstall", "prepare", "prepublish"]) {
      expect(scripts[hook], `${hook} must not exist`).toBeUndefined();
    }
  });

  it("declares the opt-in installer bin", () => {
    expect(pkg.bin?.["pi-apple-tools-install"]).toBeTruthy();
  });

  it("declares the mcp-core library (NOT the mcp-client plugin) as a dependency, never bundled", () => {
    expect(pkg.dependencies?.["@blackbelt-technology/pi-dashboard-mcp-core"]).toBeTruthy();
    expect(pkg.bundledDependencies ?? []).not.toContain("@blackbelt-technology/pi-dashboard-mcp-core");
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      expect(pkg[field]?.["@blackbelt-technology/pi-dashboard-mcp-client-plugin"], field).toBeUndefined();
    }
  });

  // #E12 / test-plan: shared contracts live in non-plugin packages (task 2.5).
  it("#E12: sources take the service type + key from mcp-core, consume it, and never import mcp-client", () => {
    const srcDir = join(here, "..");
    const read = (f: string) => readFileSync(join(srcDir, f), "utf8");
    for (const f of ["env.ts", "install.ts", "server/index.ts"]) {
      const src = read(f);
      expect(src, f).toContain("@blackbelt-technology/pi-dashboard-mcp-core");
      expect(src, f).not.toMatch(/pi-dashboard-mcp-client-plugin/);
    }
    const server = read("server/index.ts");
    expect(server).toMatch(/McpClientConfigService/);
    expect(server).toMatch(/ctx\.consume<McpClientConfigService>\(MCP_CLIENT_CONFIG_SERVICE_KEY\)/);
    expect(server).not.toMatch(/const SERVICE_KEY = "mcp-client\.config"/);
  });

  it("server entry satisfies the loader contract (default export function)", async () => {
    // The loader calls `mod.default(ctx)`; a named-only export silently fails to
    // load the plugin at runtime. Regression guard — caught in the harness.
    const mod = await import("../server/index.js");
    expect(typeof mod.default).toBe("function");
  });

  it("#E34: has a pi-dashboard-plugin manifest with id apple-tools, a mcp-client dep, + paths requirement", () => {
    const m = pkg["pi-dashboard-plugin"];
    expect(m?.id).toBe("apple-tools");
    expect(m?.requires?.paths).toEqual(["${imcpServerPath}"]);
    // pi's built-in MCP serves iMCP; no pi-mcp-adapter requirement or
    // dependency anywhere (an installed adapter disables the built-in).
    expect(m?.requires?.piExtensions).toBeUndefined();
    expect(pkg.dependencies?.["pi-mcp-adapter"]).toBeUndefined();
    expect(m?.dependsOn).toEqual(["mcp-client"]);
    // settings-section without a tab field (renders inline under the plugin row)
    const claim = (m?.claims ?? []).find((c: { slot: string }) => c.slot === "settings-section");
    expect(claim).toBeTruthy();
    expect(claim.tab).toBeUndefined();
  });
});

// test-plan #E67 / PS › First-party plugins findable (task 5.13). The README half is task 5.16.
describe("first-party plugin packages are findable by the dashboard-plugin keyword", () => {
  const packagesDir = join(here, "..", "..", "..");
  const manifestPackages = readdirSync(packagesDir).flatMap((name) => {
    const pkgPath = join(packagesDir, name, "package.json");
    if (!existsSync(pkgPath)) return [];
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { keywords?: string[]; "pi-dashboard-plugin"?: { fixture?: boolean } };
    const adjacent = join(packagesDir, name, "dashboard-plugin.json");
    const manifest = existsSync(adjacent)
      ? (JSON.parse(readFileSync(adjacent, "utf8")) as { fixture?: boolean })
      : raw["pi-dashboard-plugin"];
    return manifest ? [{ name, keywords: raw.keywords ?? [], fixture: manifest.fixture === true }] : [];
  });

  it("finds the manifest packages (guards against a vacuous pass)", () => {
    expect(manifestPackages.length).toBeGreaterThan(20);
  });

  it("every non-fixture manifest package carries keywords ∋ pi-dashboard-plugin", () => {
    const missing = manifestPackages.filter((p) => !p.fixture && !p.keywords.includes("pi-dashboard-plugin")).map((p) => p.name);
    expect(missing).toEqual([]);
  });
});
