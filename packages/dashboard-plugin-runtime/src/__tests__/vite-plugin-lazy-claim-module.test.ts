/**
 * Registry generation for claims that name a lazily-loaded `module`.
 *
 * Covers: lazy emission (no static import of the component), eager
 * predicate/shouldRender/labelComponent, hash sensitivity to `module`, and the
 * three hard failures (missing module file, module lacking the export, main
 * entry also exporting the component).
 *
 * See change: lazy-plugin-claim-modules (tasks 1.1, 1.2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiscoveryCache, pluginRegistryHash } from "../server/loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-plugin-lazy-claim-"));
  clearDiscoveryCache();
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

interface PluginSpec {
  claims: Record<string, unknown>[];
  entrySource: string;
  /** relPath → source of extra files (lazy modules). */
  files?: Record<string, string>;
  exportsField?: Record<string, string>;
}

function writePlugin(name: string, spec: PluginSpec): void {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(path.join(pkgDir, "src", "client"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: `@fixture/${name}`,
      ...(spec.exportsField ? { exports: spec.exportsField } : {}),
      "pi-dashboard-plugin": {
        id: name,
        displayName: name,
        client: "./src/client/index.tsx",
        claims: spec.claims,
      },
    }),
  );
  fs.writeFileSync(path.join(pkgDir, "src", "client", "index.tsx"), spec.entrySource, "utf-8");
  for (const [rel, src] of Object.entries(spec.files ?? {})) {
    const full = path.join(pkgDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, src, "utf-8");
  }
}

async function generate(): Promise<string> {
  const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
  const plugin = viteDashboardPluginsPlugin(tmpDir);
  await (plugin as { buildStart?: () => void }).buildStart?.();
  const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
  return fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
}

const LAZY_CLAIM = {
  slot: "settings-section",
  component: "FooSettings",
  module: "./src/client/FooSettings.tsx",
};

describe("lazy claim module — emission", () => {
  it("emits lazyClaim(import(...)) and no static import of the component", async () => {
    writePlugin("foo-plugin", {
      claims: [LAZY_CLAIM, { slot: "session-card-badge", component: "FooBadge" }],
      entrySource: "export function FooBadge() { return null; }\n",
      files: { "src/client/FooSettings.tsx": "export function FooSettings() { return null; }\n" },
    });
    const out = await generate();
    expect(out).toMatch(/Component: lazyClaim\(\(\) => import\("[^"]*FooSettings"\), "FooSettings"\)/);
    // FooSettings must not appear in any static import list.
    const staticImports = out.split("\n").filter((l) => l.startsWith("import {"));
    expect(staticImports.join("\n")).not.toContain("FooSettings");
    expect(staticImports.join("\n")).toContain("FooBadge");
    expect(out).toMatch(/import \{ lazyClaim \} from "@blackbelt-technology\/dashboard-plugin-runtime"/);
  });

  it("emits no lazyClaim import when no claim has a module", async () => {
    writePlugin("plain-plugin", {
      claims: [{ slot: "session-card-badge", component: "PlainBadge" }],
      entrySource: "export function PlainBadge() { return null; }\n",
    });
    const out = await generate();
    expect(out).not.toContain("lazyClaim");
  });

  it("keeps predicate / shouldRender / labelComponent static from the main entry", async () => {
    writePlugin("eager-plugin", {
      claims: [
        {
          slot: "content-view",
          component: "BoardView",
          module: "./src/client/BoardView.tsx",
          predicate: "isBoard",
          shouldRender: "hasBoard",
        },
      ],
      entrySource:
        "export const isBoard = () => true;\nexport const hasBoard = () => true;\n",
      files: { "src/client/BoardView.tsx": "export function BoardView() { return null; }\n" },
    });
    const out = await generate();
    expect(out).toMatch(/import \{ isBoard, hasBoard \} from /);
    expect(out).toContain("predicate: isBoard");
    expect(out).toContain("shouldRender: hasBoard");
    expect(out).toMatch(/Component: lazyClaim\(/);
  });

  it("prefers a package subpath export that maps to the module", async () => {
    writePlugin("sub-plugin", {
      exportsField: {
        ".": "./src/client/index.tsx",
        "./client/FooSettings": "./src/client/FooSettings.tsx",
      },
      claims: [LAZY_CLAIM],
      entrySource: "export const x = 1;\n",
      files: { "src/client/FooSettings.tsx": "export function FooSettings() { return null; }\n" },
    });
    const out = await generate();
    expect(out).toContain('import("@fixture/sub-plugin/client/FooSettings")');
  });

  it("includes `module` in the registry hash", () => {
    const base = { slot: "settings-section" as const, component: "FooSettings" };
    const mk = (claim: Record<string, unknown>) => [
      { manifest: { id: "p", displayName: "p", claims: [claim] } as never },
    ];
    expect(pluginRegistryHash(mk({ ...base }))).not.toBe(
      pluginRegistryHash(mk({ ...base, module: "./src/client/FooSettings.tsx" })),
    );
    expect(pluginRegistryHash(mk({ ...base, module: "./a.tsx" }))).not.toBe(
      pluginRegistryHash(mk({ ...base, module: "./b.tsx" })),
    );
  });
});

describe("lazy claim module — validation", () => {
  it("fails when the module file is missing", async () => {
    writePlugin("missing-plugin", {
      claims: [LAZY_CLAIM],
      entrySource: "export const x = 1;\n",
    });
    await expect(generate()).rejects.toThrow(
      /missing-plugin.*settings-section.*FooSettings.*FooSettings\.tsx|FooSettings\.tsx.*does not exist/s,
    );
  });

  it("fails when the module does not export the component", async () => {
    writePlugin("noexport-plugin", {
      claims: [LAZY_CLAIM],
      entrySource: "export const x = 1;\n",
      files: { "src/client/FooSettings.tsx": "export function Other() { return null; }\n" },
    });
    await expect(generate()).rejects.toThrow(
      /noexport-plugin.*settings-section.*"FooSettings".*FooSettings\.tsx.*does not export/s,
    );
  });

  it("fails when the main entry also exports the component (named)", async () => {
    writePlugin("pinned-plugin", {
      claims: [LAZY_CLAIM],
      entrySource: 'export { FooSettings } from "./FooSettings";\n',
      files: { "src/client/FooSettings.tsx": "export function FooSettings() { return null; }\n" },
    });
    await expect(generate()).rejects.toThrow(
      /pinned-plugin.*"FooSettings".*FooSettings\.tsx.*main client entry/s,
    );
  });

  it("fails when the main entry re-exports the module via export *", async () => {
    writePlugin("star-plugin", {
      claims: [LAZY_CLAIM],
      entrySource: 'export * from "./FooSettings";\n',
      files: { "src/client/FooSettings.tsx": "export function FooSettings() { return null; }\n" },
    });
    await expect(generate()).rejects.toThrow(/star-plugin.*"FooSettings".*FooSettings\.tsx.*main client entry/s);
  });
});

describe("lazy claim module — eager-chunk guard (renderChunk)", () => {
  async function setup() {
    writePlugin("guard-plugin", {
      claims: [{ slot: "settings-section", component: "GuardSettings", module: "./src/client/GuardSettings.tsx" }],
      entrySource: "export const x = 1;\n",
      files: { "src/client/GuardSettings.tsx": "export function GuardSettings() { return null; }\n" },
    });
    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    const plugin = viteDashboardPluginsPlugin(tmpDir) as unknown as {
      buildStart(): void;
      renderChunk(this: unknown, code: string, chunk: { moduleIds: string[] }): unknown;
    };
    plugin.buildStart();
    const registry = path.join(fs.realpathSync(tmpDir), "packages", "client", "src", "generated", "plugin-registry.tsx");
    const mod = path.join(fs.realpathSync(tmpDir), "packages", "guard-plugin", "src", "client", "GuardSettings.tsx");
    const ctx = {
      getModuleInfo: () => ({ importers: ["/eager/Importer.tsx"] }),
      error: (msg: string): never => {
        throw new Error(msg);
      },
    };
    return { plugin, registry, mod, ctx };
  }

  it("fails when a lazy module shares the registry chunk, naming claim + static importers", async () => {
    const { plugin, registry, mod, ctx } = await setup();
    expect(() => plugin.renderChunk.call(ctx, "", { moduleIds: [registry, mod] })).toThrow(
      /guard-plugin.*settings-section.*GuardSettings.*GuardSettings\.tsx.*\/eager\/Importer\.tsx/s,
    );
  });

  it("passes when the lazy module is in its own chunk", async () => {
    const { plugin, registry, mod, ctx } = await setup();
    expect(plugin.renderChunk.call(ctx, "", { moduleIds: [mod] })).toBeNull();
    expect(plugin.renderChunk.call(ctx, "", { moduleIds: [registry] })).toBeNull();
  });
});

describe("lazy claim module — generated literal escaping", () => {
  it("escapes unusual path characters instead of splicing them into the generated code", async () => {
    writePlugin("odd plugin", {
      claims: [{ slot: "settings-section", component: "OddSettings", module: './src/client/odd"name.tsx' }],
      entrySource: "export const x = 1;\n",
      files: { 'src/client/odd"name.tsx': "export function OddSettings() { return null; }\n" },
    });
    const out = await generate();
    expect(out).toContain("\\u0022name"); // the double quote is escaped, never raw
    expect(out).not.toMatch(/import\("[^"\n]*"name/);
  });
});
