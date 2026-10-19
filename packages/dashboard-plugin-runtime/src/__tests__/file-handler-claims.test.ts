/**
 * `editor-pane-file-handler` claim pipeline: text-backed rejection (E1),
 * claimable extensions (E2), extension format (E3), id + copySuffix (E4),
 * registry hash (E5). See change: add-editor-pane-file-handlers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { isTextBackedExt } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";
import { clearDiscoveryCache, deterministicSerializePlugins, pluginRegistryHash } from "../server/loader.js";

const claim = (over: Record<string, unknown> = {}) => ({
  slot: "editor-pane-file-handler",
  component: "Handler",
  id: "word",
  extensions: [".docx"],
  mode: "edit",
  label: "Edit in Word",
  copySuffix: "word",
  ...over,
});
const manifest = (...claims: Record<string, unknown>[]) => ({ id: "demo", displayName: "Demo", claims });

describe("validateManifest — file-handler text-backed rejection (#E1)", () => {
  it.each([".md", ".markdown", ".csv", ".adoc", ".mmd", ".puml", ".txt", ".json", ".ts", ".html"])(
    "rejects %s naming plugin, slot and extension",
    (ext) => {
      try {
        validateManifest(manifest(claim({ extensions: [ext] })));
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        expect((e as ManifestValidationError).pluginId).toBe("demo");
        expect((e as Error).message).toContain("editor-pane-file-handler");
        expect((e as Error).message).toContain(ext);
      }
    },
  );
});

describe("validateManifest — file-handler claimable extensions (#E2)", () => {
  it.each([".docx", ".drawio", ".psd", ".svg"])("accepts %s (isTextBackedExt false)", (ext) => {
    expect(isTextBackedExt(ext)).toBe(false);
    const m = validateManifest(manifest(claim({ extensions: [ext] })));
    expect(m.claims[0].extensions).toEqual([ext]);
  });

  it("normalizes every field onto the claim", () => {
    const m = validateManifest(
      manifest(claim({ keepAlive: { max: 2 }, maxBytes: 1024, firstOverwriteNotice: "careful", validator: true })),
    );
    expect(m.claims[0]).toMatchObject({
      slot: "editor-pane-file-handler",
      component: "Handler",
      id: "word",
      extensions: [".docx"],
      mode: "edit",
      label: "Edit in Word",
      copySuffix: "word",
      keepAlive: { max: 2 },
      maxBytes: 1024,
      firstOverwriteNotice: "careful",
      validator: true,
    });
  });

  it("does not carry file-handler fields onto claims of other slots", () => {
    const m = validateManifest({
      id: "demo",
      displayName: "Demo",
      claims: [{ slot: "session-card-badge", component: "B", id: "x", extensions: [".docx"], mode: "edit" }],
    });
    expect(m.claims[0].extensions).toBeUndefined();
    expect(m.claims[0].id).toBeUndefined();
  });
});

describe("validateManifest — file-handler extension format (#E3)", () => {
  it.each(["docx", ".*", ".tar.gz", ".DOCX"])("rejects %j", (ext) => {
    expect(() => validateManifest(manifest(claim({ extensions: [ext] })))).toThrow(/extension/);
  });
  it("accepts .a", () => {
    expect(validateManifest(manifest(claim({ extensions: [".a"] }))).claims[0].extensions).toEqual([".a"]);
  });
  it("rejects an empty / non-array list", () => {
    expect(() => validateManifest(manifest(claim({ extensions: [] })))).toThrow(/extensions/);
    expect(() => validateManifest(manifest(claim({ extensions: ".docx" })))).toThrow(/extensions/);
  });
});

describe("validateManifest — file-handler id, copySuffix, bounds (#E4)", () => {
  it("rejects a duplicate id within one plugin, naming plugin and id", () => {
    expect(() => validateManifest(manifest(claim(), claim({ extensions: [".psd"] })))).toThrow(/demo[\s\S]*duplicate[\s\S]*"word"/);
  });
  it("rejects a malformed id naming the field", () => {
    for (const id of ["a/b", "A", "1a", "", "a".repeat(33)]) {
      expect(() => validateManifest(manifest(claim({ id })))).toThrow(/\.id/);
    }
  });
  it("rejects an edit claim without copySuffix, naming the field", () => {
    const { copySuffix: _drop, ...noSuffix } = claim();
    expect(() => validateManifest(manifest(noSuffix))).toThrow(/copySuffix/);
  });
  it("accepts a preview claim without copySuffix, and rejects a malformed one", () => {
    const { copySuffix: _drop, ...noSuffix } = claim({ mode: "preview" });
    expect(validateManifest(manifest(noSuffix)).claims[0].copySuffix).toBeUndefined();
    expect(() => validateManifest(manifest(claim({ copySuffix: "A" })))).toThrow(/copySuffix/);
    expect(() => validateManifest(manifest(claim({ copySuffix: "a" })))).toThrow(/copySuffix/);
  });
  it("rejects bad mode / label / keepAlive / maxBytes / notice / validator", () => {
    expect(() => validateManifest(manifest(claim({ mode: "view" })))).toThrow(/mode/);
    expect(() => validateManifest(manifest(claim({ label: "" })))).toThrow(/label/);
    expect(() => validateManifest(manifest(claim({ label: "x".repeat(41) })))).toThrow(/label/);
    expect(() => validateManifest(manifest(claim({ keepAlive: { max: 0 } })))).toThrow(/keepAlive/);
    expect(() => validateManifest(manifest(claim({ keepAlive: { max: 4 } })))).toThrow(/keepAlive/);
    expect(() => validateManifest(manifest(claim({ maxBytes: 128 * 1024 * 1024 + 1 })))).toThrow(/maxBytes/);
    expect(() => validateManifest(manifest(claim({ maxBytes: 0 })))).toThrow(/maxBytes/);
    expect(() => validateManifest(manifest(claim({ firstOverwriteNotice: "x".repeat(301) })))).toThrow(/firstOverwriteNotice/);
    expect(() => validateManifest(manifest(claim({ validator: "yes" })))).toThrow(/validator/);
  });
  it("accepts the 128 MiB ceiling and keepAlive 1..3", () => {
    expect(validateManifest(manifest(claim({ maxBytes: 128 * 1024 * 1024, keepAlive: { max: 3 } }))).claims[0].maxBytes).toBe(134217728);
  });
  it("requires a component and an id", () => {
    const { component: _c, ...noComponent } = claim();
    expect(() => validateManifest(manifest(noComponent))).toThrow(/component/);
    const { id: _i, ...noId } = claim();
    expect(() => validateManifest(manifest(noId))).toThrow(/\.id/);
  });
});

describe("registry hash — file-handler (#E5)", () => {
  const plugin = (over: Record<string, unknown>) => [
    { manifest: { id: "p", displayName: "p", claims: [claim(over)] } as unknown as PluginManifest },
  ];
  it("changes when only extensions / maxBytes / validator change", () => {
    const base = pluginRegistryHash(plugin({}));
    const ext = pluginRegistryHash(plugin({ extensions: [".docx", ".odt"] }));
    const max = pluginRegistryHash(plugin({ maxBytes: 1000 }));
    const val = pluginRegistryHash(plugin({ validator: true }));
    expect(new Set([base, ext, max, val]).size).toBe(4);
  });
  it("changes on mode/label/keepAlive/copySuffix/notice/id edits", () => {
    const base = pluginRegistryHash(plugin({}));
    for (const over of [{ mode: "preview" }, { label: "X" }, { keepAlive: { max: 2 } }, { copySuffix: "other" }, { firstOverwriteNotice: "n" }, { id: "other" }]) {
      expect(pluginRegistryHash(plugin(over))).not.toBe(base);
    }
  });
  it("plugins without file-handler claims keep their serialization", () => {
    const other = [{ manifest: { id: "p", displayName: "p", claims: [{ slot: "settings-section", component: "X" }] } as PluginManifest }];
    const ser = deterministicSerializePlugins(other);
    for (const f of ["extensions", "maxBytes", "validator", "copySuffix", "keepAlive", "firstOverwriteNotice"]) expect(ser).not.toContain(f);
  });
});

describe("registry generation — file-handler claim metadata (#E4)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-handler-claims-"));
    clearDiscoveryCache();
    fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearDiscoveryCache();
  });

  it("emits the validated claim fields onto the runtime ClaimEntry as `fileHandler`", async () => {
    const pkgDir = path.join(tmpDir, "packages", "word-plugin");
    fs.mkdirSync(path.join(pkgDir, "src", "client"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "word-plugin",
        "pi-dashboard-plugin": { id: "wc", displayName: "WC", client: "./src/client/index.tsx", claims: [claim({ keepAlive: { max: 2 }, maxBytes: 1000 })] },
      }),
    );
    fs.writeFileSync(path.join(pkgDir, "src", "client", "index.tsx"), "export function Handler() { return null; }\n");
    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    await (viteDashboardPluginsPlugin(tmpDir) as { buildStart?: () => void }).buildStart?.();
    const out = fs.readFileSync(path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx"), "utf-8");
    expect(out).toContain('slot: "editor-pane-file-handler"');
    expect(out).toContain(
      'fileHandler: {"id":"word","extensions":[".docx"],"mode":"edit","label":"Edit in Word","keepAlive":{"max":2},"maxBytes":1000,"copySuffix":"word"}',
    );
  });
});
