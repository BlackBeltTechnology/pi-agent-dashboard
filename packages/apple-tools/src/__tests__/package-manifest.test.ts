/**
 * Package-manifest invariants (#E30 opt-in invocation, #E34 bundling contract).
 * See change: add-apple-tools-imcp-plugin.
 */

import { readFileSync } from "node:fs";
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

  it("declares pi-mcp-adapter as a dependency but NOT bundledDependencies", () => {
    expect(pkg.dependencies?.["pi-mcp-adapter"]).toBeTruthy();
    expect(pkg.bundledDependencies ?? []).not.toContain("pi-mcp-adapter");
  });

  it("server entry satisfies the loader contract (default export function)", async () => {
    // The loader calls `mod.default(ctx)`; a named-only export silently fails to
    // load the plugin at runtime. Regression guard — caught in the harness.
    const mod = await import("../server/index.js");
    expect(typeof mod.default).toBe("function");
  });

  it("#E34: has a pi-dashboard-plugin manifest with id apple-tools + paths requirement", () => {
    const m = pkg["pi-dashboard-plugin"];
    expect(m?.id).toBe("apple-tools");
    expect(m?.requires?.paths).toEqual(["${imcpServerPath}"]);
    expect(m?.requires?.piExtensions).toEqual(["pi-mcp-adapter"]);
    // settings-section without a tab field (renders inline under the plugin row)
    const claim = (m?.claims ?? []).find((c: { slot: string }) => c.slot === "settings-section");
    expect(claim).toBeTruthy();
    expect(claim.tab).toBeUndefined();
  });
});
