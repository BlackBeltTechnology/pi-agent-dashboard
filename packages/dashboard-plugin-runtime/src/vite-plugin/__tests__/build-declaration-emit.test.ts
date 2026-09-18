/**
 * Build-declaration emit tests — folds test-plan scenarios E7 (production
 * emit) and E8 (dev emits nothing), plus the vite-plugin hook wiring.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_DECLARATION_SCHEMA_VERSION,
  buildDeclarationPath,
  isUsableDeclaration,
  readBuildDeclaration,
} from "../../server/build-metadata.js";
import {
  emitBuildDeclaration,
  regeneratePluginRegistry,
  viteDashboardPluginsPlugin,
} from "../index.js";

let root: string;
let clientRoot: string;
let outDir: string;
/** Extra temp repos created by a test (cleaned in afterEach). */
const extraRoots: string[] = [];

function writePlugin(id: string, opts: { fixture?: boolean; targetRoot?: string } = {}): void {
  const pkgDir = path.join(opts.targetRoot ?? root, "packages", id);
  fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
  const component = `${id.replace(/[^a-zA-Z0-9]/g, "_")}Panel`;
  fs.writeFileSync(
    path.join(pkgDir, "src", "client.tsx"),
    `export function ${component}() { return null; }\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: `@fixture/${id}`,
        exports: { ".": "./src/client.tsx" },
        "pi-dashboard-plugin": {
          id,
          displayName: id,
          client: "src/client.tsx",
          claims: [{ slot: "settings-section", component }],
          ...(opts.fixture ? { fixture: true } : {}),
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function embeddedHash(content: string): string {
  const match = content.match(/PLUGIN_REGISTRY_HASH\s*=\s*"([0-9a-f]{64})"/);
  if (!match) throw new Error("PLUGIN_REGISTRY_HASH not found in generated content");
  return match[1];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-emit-"));
  clientRoot = path.join(root, "packages", "client");
  outDir = path.join(clientRoot, "dist");
  fs.mkdirSync(outDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const extra of extraRoots.splice(0)) fs.rmSync(extra, { recursive: true, force: true });
});

describe("build declaration emit (E7, E8)", () => {
  it("E7 production emit writes a declaration matching the embedded hash", () => {
    writePlugin("alpha");
    writePlugin("beta");

    const { content } = regeneratePluginRegistry(root, true);
    const embedded = embeddedHash(content);

    const declaration = emitBuildDeclaration({ outDir, repoRoot: root, isProd: true });
    expect(declaration).not.toBeNull();

    const read = readBuildDeclaration(outDir);
    expect(read.kind).toBe("valid");
    if (!isUsableDeclaration(read)) return;
    expect(read.declaration.schemaVersion).toBe(BUILD_DECLARATION_SCHEMA_VERSION);
    expect(read.declaration.fixturePolicy).toBe("excluded");
    expect(read.declaration.pluginRegistryHash).toBe(embedded);
  });

  it("E8 dev emit writes nothing", () => {
    writePlugin("alpha");
    regeneratePluginRegistry(root, false);

    const declaration = emitBuildDeclaration({ outDir, repoRoot: root, isProd: false });
    expect(declaration).toBeNull();
    expect(fs.existsSync(buildDeclarationPath(outDir))).toBe(false);
  });

  it("each root's declaration matches its OWN embedded hash (no discovery-cache bleed)", () => {
    // The process-wide discovery cache is unkeyed by root, so emitting for a
    // second repo must not reuse the first repo's set. Two roots with disjoint
    // plugin sets, emitted in sequence, each keep their own registry hash.
    writePlugin("alpha");
    const { content: contentA } = regeneratePluginRegistry(root, true);
    const hashA = embeddedHash(contentA);

    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "vite-emit-b-"));
    extraRoots.push(rootB);
    writePlugin("beta", { targetRoot: rootB });
    writePlugin("gamma", { targetRoot: rootB });
    const outDirB = path.join(rootB, "packages", "client", "dist");
    fs.mkdirSync(outDirB, { recursive: true });
    const { content: contentB } = regeneratePluginRegistry(rootB, true);
    const hashB = embeddedHash(contentB);
    expect(hashA).not.toBe(hashB);

    // Emit A AFTER B — A must still carry A's set, not the most recent one.
    emitBuildDeclaration({ outDir, repoRoot: root, isProd: true });
    emitBuildDeclaration({ outDir: outDirB, repoRoot: rootB, isProd: true });

    const readA = readBuildDeclaration(outDir);
    const readB = readBuildDeclaration(outDirB);
    if (!isUsableDeclaration(readA) || !isUsableDeclaration(readB)) {
      throw new Error("both declarations must be valid");
    }
    expect(readA.declaration.pluginRegistryHash).toBe(hashA);
    expect(readB.declaration.pluginRegistryHash).toBe(hashB);
  });

  it("the vite plugin's writeBundle hook emits in production and not in dev", () => {
    writePlugin("alpha");
    const plugin = viteDashboardPluginsPlugin(root);

    // Minimal configResolved surface the plugin reads.
    (plugin.configResolved as (c: unknown) => void).call({}, {
      root: clientRoot,
      build: { outDir: "dist" },
    });

    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      (plugin.buildStart as () => void).call({});
      (plugin.writeBundle as (o: unknown, b: unknown) => void).call({}, { dir: outDir }, {});
      expect(fs.existsSync(buildDeclarationPath(outDir))).toBe(true);
      expect(readBuildDeclaration(outDir).kind).toBe("valid");

      // Dev: fresh out dir, no declaration.
      const devRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vite-emit-dev-"));
      try {
        fs.mkdirSync(path.join(devRoot, "packages", "client", "dist"), { recursive: true });
        process.env.NODE_ENV = "development";
        (plugin.writeBundle as (o: unknown, b: unknown) => void).call(
          {},
          { dir: path.join(devRoot, "packages", "client", "dist") },
          {},
        );
        expect(
          fs.existsSync(buildDeclarationPath(path.join(devRoot, "packages", "client", "dist"))),
        ).toBe(false);
      } finally {
        fs.rmSync(devRoot, { recursive: true, force: true });
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
