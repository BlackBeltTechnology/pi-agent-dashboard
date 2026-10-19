/**
 * `editor-pane-tab` claim pipeline: validator (E1), cross-plugin collision
 * (E2), label-export check (E3), field emission + registry hash (E4).
 * See change: add-browser-editor-pane-tab (D1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paneTabPrefixOf } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/editor-pane-tab.js";
import { HANDLER_MAX_BYTES, type PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { SlotPredicateInput } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import { isTextBackedExt } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
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

// ── editor-pane-file-handler (add-editor-pane-file-handlers E1–E6) ───────────

const handlerClaim = (over: Record<string, unknown> = {}) => ({
  slot: "editor-pane-file-handler",
  component: "Word",
  id: "word",
  extensions: [".docx"],
  mode: "edit",
  label: "Word",
  copySuffix: "edited",
  ...over,
});
const handlerManifest = (over: Record<string, unknown> = {}, id = "demo") => ({
  id,
  displayName: "Demo",
  claims: [handlerClaim(over)],
});

describe("validateManifest — editor-pane-file-handler", () => {
  it("accepts a well-formed claim and normalises every field", () => {
    const m = validateManifest(
      handlerManifest({
        keepAlive: { max: 2 },
        maxBytes: 1024,
        firstOverwriteNotice: "careful",
        validator: true,
        junk: "dropped",
      }),
    );
    expect(m.claims[0]).toEqual({
      slot: "editor-pane-file-handler",
      component: "Word",
      id: "word",
      extensions: [".docx"],
      mode: "edit",
      label: "Word",
      keepAlive: { max: 2 },
      maxBytes: 1024,
      firstOverwriteNotice: "careful",
      copySuffix: "edited",
      validator: true,
    });
  });

  it("#E1 rejects every text-backed extension naming plugin, slot and extension", () => {
    for (const ext of [".md", ".markdown", ".csv", ".adoc", ".mmd", ".puml", ".txt", ".json", ".ts", ".html"]) {
      try {
        validateManifest(handlerManifest({ extensions: [ext] }));
        expect.fail(`${ext} should have thrown`);
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        expect((e as ManifestValidationError).pluginId).toBe("demo");
        expect((e as Error).message).toContain("editor-pane-file-handler");
        expect((e as Error).message).toContain(`"${ext}"`);
      }
    }
  });

  it("#E2 accepts unrecognised / non-text extensions; isTextBackedExt is false for each", () => {
    for (const ext of [".docx", ".drawio", ".psd", ".svg"]) {
      expect(isTextBackedExt(ext), ext).toBe(false);
      expect(validateManifest(handlerManifest({ extensions: [ext] })).claims[0].extensions).toEqual([ext]);
    }
  });

  it("#E3 rejects malformed extensions; accepts `.a`", () => {
    for (const ext of ["docx", ".*", ".tar.gz", ".DOCX", ""]) {
      expect(() => validateManifest(handlerManifest({ extensions: [ext] })), JSON.stringify(ext)).toThrow(
        /demo[\s\S]*editor-pane-file-handler[\s\S]*extension/,
      );
    }
    expect(validateManifest(handlerManifest({ extensions: [".a"] })).claims[0].extensions).toEqual([".a"]);
    expect(() => validateManifest(handlerManifest({ extensions: [] }))).toThrow(/extensions/);
    expect(() => validateManifest(handlerManifest({ extensions: undefined }))).toThrow(/extensions/);
  });

  it("#E4 duplicate id in one plugin fails naming plugin and id", () => {
    const m = { id: "demo", displayName: "Demo", claims: [handlerClaim(), handlerClaim({ extensions: [".psd"] })] };
    expect(() => validateManifest(m)).toThrow(/demo[\s\S]*duplicate[\s\S]*"word"/);
  });

  it("#E4 the same id in two different plugins is allowed", () => {
    expect(() => validateManifest(handlerManifest({}, "one"))).not.toThrow();
    expect(() => validateManifest(handlerManifest({}, "two"))).not.toThrow();
  });

  it.each(["a/b", "A", "1a", "", "a".repeat(33)])("#E4 rejects malformed id %j naming plugin and field", (id) => {
    expect(() => validateManifest(handlerManifest({ id }))).toThrow(/demo[\s\S]*editor-pane-file-handler[\s\S]*id/);
  });

  it("#E4 edit claim without copySuffix fails naming plugin and field", () => {
    expect(() => validateManifest(handlerManifest({ copySuffix: undefined }))).toThrow(/demo[\s\S]*copySuffix/);
  });

  it("preview claim does not need copySuffix; a malformed one is still rejected", () => {
    expect(validateManifest(handlerManifest({ mode: "preview", copySuffix: undefined })).claims[0].copySuffix).toBeUndefined();
    for (const copySuffix of ["a", "A", "1a", "a b", "a".repeat(33)]) {
      expect(() => validateManifest(handlerManifest({ mode: "preview", copySuffix })), copySuffix).toThrow(/copySuffix/);
    }
  });

  it("validates mode, label, keepAlive, maxBytes, firstOverwriteNotice, validator bounds", () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ mode: "view" }, /mode/],
      [{ mode: undefined }, /mode/],
      [{ label: "" }, /label/],
      [{ label: "x".repeat(41) }, /label/],
      [{ keepAlive: { max: 0 } }, /keepAlive/],
      [{ keepAlive: { max: 4 } }, /keepAlive/],
      [{ keepAlive: { max: 1.5 } }, /keepAlive/],
      [{ keepAlive: {} }, /keepAlive/],
      [{ maxBytes: HANDLER_MAX_BYTES + 1 }, /maxBytes/],
      [{ maxBytes: 0 }, /maxBytes/],
      [{ maxBytes: "1" }, /maxBytes/],
      [{ firstOverwriteNotice: "x".repeat(301) }, /firstOverwriteNotice/],
      [{ validator: "yes" }, /validator/],
      [{ component: undefined }, /component/],
    ];
    for (const [over, re] of bad) {
      expect(() => validateManifest(handlerManifest(over)), JSON.stringify(over)).toThrow(re);
    }
    const ok = validateManifest(
      handlerManifest({
        label: "x".repeat(40),
        keepAlive: { max: 3 },
        maxBytes: HANDLER_MAX_BYTES,
        firstOverwriteNotice: "x".repeat(300),
        validator: false,
      }),
    ).claims[0];
    expect(ok).toMatchObject({ keepAlive: { max: 3 }, maxBytes: HANDLER_MAX_BYTES, validator: false });
  });

  it("does not carry file-handler fields onto claims of other slots", () => {
    const m = validateManifest({
      id: "demo",
      displayName: "Demo",
      claims: [{ slot: "session-card-badge", component: "B", id: "x", extensions: [".md"], mode: "edit" }],
    });
    expect(m.claims[0]).toEqual({ slot: "session-card-badge", component: "B" });
  });
});

describe("registry hash — editor-pane-file-handler (#E5)", () => {
  const plugin = (over: Record<string, unknown> = {}) => [
    { manifest: validateManifest(handlerManifest({ maxBytes: 1024, validator: false, ...over })) },
  ];
  it("changes when only extensions, then only maxBytes, then only validator change", () => {
    const base = pluginRegistryHash(plugin());
    const byExt = pluginRegistryHash(plugin({ extensions: [".psd"] }));
    const byMax = pluginRegistryHash(plugin({ maxBytes: 2048 }));
    const byValidator = pluginRegistryHash(plugin({ validator: true }));
    expect(new Set([base, byExt, byMax, byValidator]).size).toBe(4);
  });
  it("changes for each remaining field (id, mode, label, keepAlive, firstOverwriteNotice, copySuffix)", () => {
    const base = pluginRegistryHash(plugin());
    for (const over of [
      { id: "word2" },
      { mode: "preview" },
      { label: "Other" },
      { keepAlive: { max: 1 } },
      { firstOverwriteNotice: "n" },
      { copySuffix: "other" },
    ]) {
      expect(pluginRegistryHash(plugin(over)), JSON.stringify(over)).not.toBe(base);
    }
  });
  it("plugins without file-handler claims serialize exactly as before (no new keys)", () => {
    const other = [{ manifest: { id: "p", displayName: "p", claims: [{ slot: "settings-section", component: "X" }] } as PluginManifest }];
    const ser = deterministicSerializePlugins(other);
    for (const k of ["extensions", "maxBytes", "validator", "copySuffix", "keepAlive", "firstOverwriteNotice", '"mode"', '"label"', '"id":"x"']) {
      expect(ser).not.toContain(k);
    }
    expect(JSON.parse(ser)[0].claims[0]).toEqual({
      slot: "settings-section",
      component: "X",
      predicate: null,
      shouldRender: null,
      command: null,
      tab: null,
      toolName: null,
      path: null,
      sessionParam: null,
      nav: null,
      config: null,
    });
  });
});

// #E6 — `tsc` type assertion. Constraint form (`T extends never`) fails closed
// with TS2344 if the classification regresses; the `const _x: T[] = []` spelling
// is vacuous. Proven by mutation (see change notes).
type AssertNever<T extends never> = T;
export type _EditorPaneFileHandlerPredicateIsNever = AssertNever<SlotPredicateInput<"editor-pane-file-handler">>;

describe("slot predicate classification (#E6)", () => {
  it("SlotPredicateInput<'editor-pane-file-handler'> resolves to never", () => {
    expectTypeOf<SlotPredicateInput<"editor-pane-file-handler">>().toBeNever();
  });
});
