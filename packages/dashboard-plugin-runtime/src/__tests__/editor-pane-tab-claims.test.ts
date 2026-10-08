/**
 * `editor-pane-tab` claim pipeline: validator (E1), cross-plugin collision
 * (E2), label-export check (E3), field emission + registry hash (E4).
 * See change: add-browser-editor-pane-tab (D1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { paneTabPrefixOf } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/editor-pane-tab.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";
import { clearDiscoveryCache, deterministicSerializePlugins, pluginRegistryHash } from "../server/loader.js";

const manifest = (claim: Record<string, unknown>) => ({
  id: "demo",
  displayName: "Demo",
  claims: [{ slot: "editor-pane-tab", component: "Body", ...claim }],
});

describe("validateManifest — editor-pane-tab (#E1)", () => {
  it("accepts `ab` and keeps pathPrefix + labelComponent on the normalized claim", () => {
    const m = validateManifest(manifest({ pathPrefix: "ab", labelComponent: "Label" }));
    expect(m.claims[0]).toMatchObject({ slot: "editor-pane-tab", component: "Body", pathPrefix: "ab", labelComponent: "Label" });
  });

  it.each(["a", "a".repeat(33), "Browser", "a b", "1ab", "a_b"])("rejects malformed prefix %j naming plugin + prefix", (p) => {
    try {
      validateManifest(manifest({ pathPrefix: p }));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).pluginId).toBe("demo");
      expect((e as Error).message).toContain(JSON.stringify(p).slice(1, -1));
    }
  });

  it("accepts the 32-char upper bound", () => {
    expect(validateManifest(manifest({ pathPrefix: `a${"b".repeat(31)}` })).claims[0].pathPrefix).toHaveLength(32);
  });

  it.each(["diff", "term", "url", "live"])("rejects built-in prefix %s as reserved", (p) => {
    expect(() => validateManifest(manifest({ pathPrefix: p }))).toThrow(/reserved/);
    expect(() => validateManifest(manifest({ pathPrefix: p }))).toThrow(new RegExp(`demo[\\s\\S]*${p}`));
  });

  it("rejects a claim without pathPrefix, naming plugin and slot", () => {
    expect(() => validateManifest(manifest({}))).toThrow(/demo[\s\S]*editor-pane-tab[\s\S]*pathPrefix/);
  });

  it("rejects a claim without a body component", () => {
    expect(() =>
      validateManifest({ id: "demo", displayName: "Demo", claims: [{ slot: "editor-pane-tab", pathPrefix: "ab" }] }),
    ).toThrow(/component/);
  });

  it("rejects a non-string labelComponent", () => {
    expect(() => validateManifest(manifest({ pathPrefix: "ab", labelComponent: 7 }))).toThrow(/labelComponent/);
  });

  it("does not carry pathPrefix onto claims of other slots", () => {
    const m = validateManifest({
      id: "demo",
      displayName: "Demo",
      claims: [{ slot: "session-card-badge", component: "B", pathPrefix: "ab" }],
    });
    expect(m.claims[0].pathPrefix).toBeUndefined();
  });
});

describe("paneTabPrefixOf", () => {
  it.each([
    ["browser:inst:42", "browser"],
    ["term:1", null],
    ["diff:a.ts", null],
    ["browser:", null],
    [":x", null],
    ["src/a.ts", null],
    ["Browser:x", null],
  ])("%j → %j", (p, want) => expect(paneTabPrefixOf(p)).toBe(want));
});

// ── Registry generation (vite plugin) ────────────────────────────────────────

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pane-tab-claims-"));
  clearDiscoveryCache();
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

function writePlugin(name: string, m: Record<string, unknown>, source: string) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(path.join(pkgDir, "src", "client"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, "pi-dashboard-plugin": { ...m, client: "./src/client/index.tsx" } }));
  fs.writeFileSync(path.join(pkgDir, "src", "client", "index.tsx"), source);
}

async function generate(): Promise<string> {
  const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
  await (viteDashboardPluginsPlugin(tmpDir) as { buildStart?: () => void }).buildStart?.();
  const out = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
  return fs.existsSync(out) ? fs.readFileSync(out, "utf-8") : "";
}

const SRC = "export function Body() { return null; }\nexport function Label() { return null; }\n";

describe("registry generation — editor-pane-tab", () => {
  it("#E2 two plugins claiming one prefix fail generation naming both + the prefix", async () => {
    writePlugin("alpha-plugin", { id: "alpha", displayName: "A", claims: [{ slot: "editor-pane-tab", component: "Body", pathPrefix: "browser" }] }, SRC);
    writePlugin("beta-plugin", { id: "beta", displayName: "B", claims: [{ slot: "editor-pane-tab", component: "Body", pathPrefix: "browser" }] }, SRC);
    await expect(generate()).rejects.toThrow(/"alpha" and "beta"[\s\S]*"browser"|"beta" and "alpha"[\s\S]*"browser"/);
  });

  it("#E3 a label component the entry does not export fails generation naming plugin + export", async () => {
    writePlugin(
      "alpha-plugin",
      { id: "alpha", displayName: "A", claims: [{ slot: "editor-pane-tab", component: "Body", pathPrefix: "browser", labelComponent: "Missing" }] },
      SRC,
    );
    await expect(generate()).rejects.toThrow(/"alpha"[\s\S]*labelComponent "Missing"/);
  });

  it("#E4 emits pathPrefix + LabelComponent onto the runtime claim entry", async () => {
    writePlugin(
      "alpha-plugin",
      { id: "alpha", displayName: "A", claims: [{ slot: "editor-pane-tab", component: "Body", pathPrefix: "browser", labelComponent: "Label" }] },
      SRC,
    );
    const content = await generate();
    expect(content).toMatch(/import \{[^}]*\bBody\b[^}]*\bLabel\b[^}]*\}/);
    expect(content).toContain('pathPrefix: "browser"');
    expect(content).toContain('labelComponentName: "Label", LabelComponent: Label');
  });
});

describe("registry hash — editor-pane-tab (#E4)", () => {
  const plugin = (claim: Record<string, unknown>) => [
    { manifest: { id: "p", displayName: "p", claims: [{ slot: "editor-pane-tab", component: "Body", ...claim }] } as PluginManifest },
  ];
  it("a pathPrefix-only edit changes the hash", () => {
    expect(pluginRegistryHash(plugin({ pathPrefix: "browser" }))).not.toBe(pluginRegistryHash(plugin({ pathPrefix: "browsr" })));
  });
  it("a labelComponent-only edit changes the hash", () => {
    expect(pluginRegistryHash(plugin({ pathPrefix: "b1", labelComponent: "L1" }))).not.toBe(
      pluginRegistryHash(plugin({ pathPrefix: "b1", labelComponent: "L2" })),
    );
  });
  it("claims without the fields hash as before (no churn)", () => {
    const other = [{ manifest: { id: "p", displayName: "p", claims: [{ slot: "settings-section", component: "X" }] } as PluginManifest }];
    const ser = deterministicSerializePlugins(other);
    expect(ser).not.toContain("pathPrefix");
    expect(ser).not.toContain("labelComponent");
  });
});
