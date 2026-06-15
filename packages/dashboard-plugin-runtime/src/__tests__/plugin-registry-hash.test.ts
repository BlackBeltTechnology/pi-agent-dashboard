/**
 * Pure tests for plugin-registry hash determinism — see change
 * fix-pi-flows-end-to-end (Group 6, task 6.7).
 */
import { describe, it, expect } from "vitest";
import {
  deterministicSerializePlugins,
  pluginRegistryHash,
} from "../server/loader.js";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";

function plugin(id: string, claims: PluginManifest["claims"]): { manifest: PluginManifest } {
  return { manifest: { id, displayName: id, priority: 100, claims } as PluginManifest };
}

describe("deterministicSerializePlugins", () => {
  it("produces identical output for identical input", () => {
    const a = [
      plugin("a", [{ slot: "settings-section", component: "X" }]),
      plugin("b", [{ slot: "tool-renderer", component: "Y", toolName: "T" }]),
    ];
    const b = [
      plugin("a", [{ slot: "settings-section", component: "X" }]),
      plugin("b", [{ slot: "tool-renderer", component: "Y", toolName: "T" }]),
    ];
    expect(deterministicSerializePlugins(a)).toEqual(deterministicSerializePlugins(b));
  });

  it("is order-independent across plugins", () => {
    const fwd = [
      plugin("b", [{ slot: "tool-renderer", component: "Y" }]),
      plugin("a", [{ slot: "settings-section", component: "X" }]),
    ];
    const rev = [
      plugin("a", [{ slot: "settings-section", component: "X" }]),
      plugin("b", [{ slot: "tool-renderer", component: "Y" }]),
    ];
    expect(deterministicSerializePlugins(fwd)).toEqual(
      deterministicSerializePlugins(rev),
    );
  });

  it("is order-independent across claims within a plugin", () => {
    const fwd = [
      plugin("a", [
        { slot: "settings-section", component: "X" },
        { slot: "tool-renderer", component: "Y" },
      ]),
    ];
    const rev = [
      plugin("a", [
        { slot: "tool-renderer", component: "Y" },
        { slot: "settings-section", component: "X" },
      ]),
    ];
    expect(deterministicSerializePlugins(fwd)).toEqual(
      deterministicSerializePlugins(rev),
    );
  });

  it("changes when a claim is added", () => {
    const base = [plugin("a", [{ slot: "settings-section", component: "X" }])];
    const extra = [
      plugin("a", [
        { slot: "settings-section", component: "X" },
        { slot: "tool-renderer", component: "Y" },
      ]),
    ];
    expect(pluginRegistryHash(base)).not.toEqual(pluginRegistryHash(extra));
  });

  it("changes when a plugin is added", () => {
    const base = [plugin("a", [{ slot: "settings-section", component: "X" }])];
    const extra = [
      plugin("a", [{ slot: "settings-section", component: "X" }]),
      plugin("b", [{ slot: "tool-renderer", component: "Y" }]),
    ];
    expect(pluginRegistryHash(base)).not.toEqual(pluginRegistryHash(extra));
  });

  it("hash is 64-char hex (SHA-256)", () => {
    const hash = pluginRegistryHash([plugin("a", [{ slot: "settings-section", component: "X" }])]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a claim's tab differs", () => {
    const a = [plugin("a", [{ slot: "settings-section", component: "X", tab: "general" }])];
    const b = [plugin("a", [{ slot: "settings-section", component: "X", tab: "developer" }])];
    expect(pluginRegistryHash(a)).not.toEqual(pluginRegistryHash(b));
  });
});
