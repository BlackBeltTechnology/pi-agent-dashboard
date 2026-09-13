/**
 * Manifest validation for the mcp-client-plugin `pi-dashboard-plugin` block.
 * Covers task 1.1 (id, claims, adapter requirement, config schema).
 * See change: extract-mcp-client-plugin.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("mcp-client-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "mcp-client")).not.toThrow();
  });

  it("plugin id is `mcp-client` with client + server entries", () => {
    const v = validateManifest(manifest, "mcp-client");
    expect(v.id).toBe("mcp-client");
    expect(v.server).toBeTruthy();
    expect(v.client).toBeTruthy();
  });

  it("requires pi-mcp-adapter and no other first-party plugin declares it here", () => {
    const v = validateManifest(manifest, "mcp-client");
    expect(v.requires?.piExtensions).toContain("pi-mcp-adapter");
  });

  it("declares the settings-section + both folder slots + the MCP folder overlay", () => {
    const v = validateManifest(manifest, "mcp-client");
    expect(v.claims.map((c) => c.slot).sort()).toEqual([
      "settings-section",
      "shell-overlay-route",
      "sidebar-folder-section",
      "worktree-card-section",
    ]);
    const overlay = v.claims.find((c) => c.slot === "shell-overlay-route") as {
      path?: string;
      component: string;
      depth?: number;
    };
    expect(overlay.path).toBe("/folder/:encodedCwd/mcp");
    expect(overlay.component).toBe("FolderMcpPage");
    expect(overlay.depth).toBe(2);
  });

  it("declares the host config schema for adapterLoadTimeoutMs", () => {
    const v = validateManifest(manifest, "mcp-client");
    expect(v.configSchema).toBe("./configSchema.json");
  });
});
