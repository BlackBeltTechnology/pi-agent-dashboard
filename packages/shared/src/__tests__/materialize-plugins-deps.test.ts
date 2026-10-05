/**
 * Plugin runtime-dependency helpers in `materialize-plugins.mjs`:
 *   - `collectPluginRuntimeDeps` — union of bundled plugins' third-party
 *     `dependencies` (design D1) with the conflict/specifier rules (D3).
 *   - `findUnresolvedPluginDeps` — fs-existence resolvability check bounded
 *     by `rootDir` (D4).
 * See change: bundle-plugin-third-party-deps (test-plan E1–E12).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectPluginRuntimeDeps,
  findUnresolvedPluginDeps,
  materializeBundledPlugins,
} from "../runtime-overlay/materialize-plugins.mjs";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mat-deps-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

/** Create `<tmp>/src/<id>/package.json` and return the source dir. */
const plugin = (id: string, pkg: Record<string, unknown>) => {
  const dir = path.join(tmp, "src", id);
  writeJson(path.join(dir, "package.json"), { name: id, ...pkg });
  return dir;
};
const resolveSource = (id: string) => path.join(tmp, "src", id);

describe("collectPluginRuntimeDeps", () => {
  it("returns only third-party dependencies (test-plan #E1)", () => {
    plugin("gmail-plugin", {
      dependencies: { oauth4webapi: "^3.8.8", "@blackbelt-technology/pi-dashboard-shared": "x" },
    });
    expect(
      collectPluginRuntimeDeps({ ids: ["gmail-plugin"], resolveSource, workspaceManifests: [] }),
    ).toEqual({ oauth4webapi: "^3.8.8" });
  });

  it("ignores dev/peer/optional dependencies (test-plan #E2)", () => {
    plugin("p", {
      devDependencies: { vitest: "^1.0.0" },
      peerDependencies: { react: "^19.0.0" },
      optionalDependencies: { fsevents: "^2.0.0" },
    });
    expect(collectPluginRuntimeDeps({ ids: ["p"], resolveSource, workspaceManifests: [] })).toEqual({});
  });

  it("skips fixture and manifest-less ids exactly like materializeBundledPlugins (test-plan #E3)", () => {
    plugin("normal", { dependencies: { a: "^1.0.0" } });
    plugin("fx", { "pi-dashboard-plugin": { fixture: true }, dependencies: { x: "^1.0.0" } });
    fs.mkdirSync(path.join(tmp, "src", "nopkg"), { recursive: true });
    const ids = ["normal", "fx", "nopkg"];
    const union = collectPluginRuntimeDeps({ ids, resolveSource, workspaceManifests: [] });
    expect(union).toEqual({ a: "^1.0.0" });
    expect(union).not.toHaveProperty("x");
    expect(materializeBundledPlugins({ ids, resolveSource, destDir: path.join(tmp, "out") })).toEqual([
      "normal",
    ]);
  });

  it("accepts identical specifiers across plugins and workspaces (test-plan #E4)", () => {
    plugin("a", { dependencies: { "@fastify/rate-limit": "^11.2.0" } });
    plugin("b", { dependencies: { "@fastify/rate-limit": "^11.2.0" } });
    const union = collectPluginRuntimeDeps({
      ids: ["a", "b"],
      resolveSource,
      workspaceManifests: [{ name: "server", dependencies: { "@fastify/rate-limit": "^11.2.0" } }],
    });
    expect(union).toEqual({ "@fastify/rate-limit": "^11.2.0" });
  });

  it("throws on differing specifiers between plugins (test-plan #E5)", () => {
    plugin("A", { dependencies: { yaml: "^2.9.0" } });
    plugin("B", { dependencies: { yaml: "^1.10.0" } });
    expect(() =>
      collectPluginRuntimeDeps({ ids: ["A", "B"], resolveSource, workspaceManifests: [] }),
    ).toThrow(/yaml[\s\S]*A@\^2\.9\.0[\s\S]*B@\^1\.10\.0/);
  });

  it("throws on a plugin-vs-workspace specifier conflict (test-plan #E6)", () => {
    plugin("kc", { dependencies: { jose: "^5.0.0" } });
    let message = "";
    try {
      collectPluginRuntimeDeps({
        ids: ["kc"],
        resolveSource,
        workspaceManifests: [{ name: "server", dependencies: { jose: "^6.0.0" } }],
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("jose");
    expect(message).toContain("kc@^5.0.0");
    expect(message).toContain("server@^6.0.0");
  });

  it("does not add workspace-only deps to the union (test-plan #E7)", () => {
    plugin("p", { dependencies: {} });
    const union = collectPluginRuntimeDeps({
      ids: ["p"],
      resolveSource,
      workspaceManifests: [{ name: "server", dependencies: { fastify: "^5.0.0" } }],
    });
    expect(union).not.toHaveProperty("fastify");
    expect(union).toEqual({});
  });

  describe("specifier rules (test-plan #E8)", () => {
    const rejected = ["file:../x", "workspace:*", "link:../y", "npm:foo@1", "git+https://h/r.git", "user/repo"];
    const accepted = ["^1.2.3", "1.x", ">=1 <2", "latest"];
    for (const spec of rejected) {
      it(`rejects ${spec}`, () => {
        plugin("p", { dependencies: { dep: spec } });
        expect(() =>
          collectPluginRuntimeDeps({ ids: ["p"], resolveSource, workspaceManifests: [] }),
        ).toThrow(/p[\s\S]*dep|dep[\s\S]*p/);
      });
    }
    for (const spec of accepted) {
      it(`accepts ${spec}`, () => {
        plugin("p", { dependencies: { dep: spec } });
        expect(collectPluginRuntimeDeps({ ids: ["p"], resolveSource, workspaceManifests: [] })).toEqual({
          dep: spec,
        });
      });
    }
  });
});

describe("findUnresolvedPluginDeps", () => {
  /** `<pluginsDir>/<id>/package.json` with the given deps. */
  const bundled = (pluginsDir: string, id: string, deps: Record<string, string>) =>
    writeJson(path.join(pluginsDir, id, "package.json"), { name: id, dependencies: deps });
  const installed = (nmParent: string, name: string) =>
    writeJson(path.join(nmParent, "node_modules", name, "package.json"), { name, version: "1.0.0" });

  it("reports only deps absent from plugin-local and root node_modules (test-plan #E9)", () => {
    const root = path.join(tmp, "root");
    const pluginsDir = path.join(root, "resources", "plugins");
    bundled(pluginsDir, "p", { a: "^1", "@s/b": "^1", c: "^1" });
    installed(path.join(pluginsDir, "p"), "a");
    installed(root, "@s/b");
    expect(findUnresolvedPluginDeps({ pluginsDir, rootDir: root })).toEqual([{ plugin: "p", dep: "c" }]);
  });

  it("does not walk above rootDir (test-plan #E10)", () => {
    const parent = path.join(tmp, "parent");
    const root = path.join(parent, "root");
    const pluginsDir = path.join(root, "resources", "plugins");
    bundled(pluginsDir, "p", { d: "^1" });
    installed(parent, "d");
    expect(findUnresolvedPluginDeps({ pluginsDir, rootDir: root })).toEqual([{ plugin: "p", dep: "d" }]);
    installed(root, "d");
    expect(findUnresolvedPluginDeps({ pluginsDir, rootDir: root })).toEqual([]);
  });

  it("requires both segments of a scoped name (test-plan #E11)", () => {
    const root = path.join(tmp, "root");
    const pluginsDir = path.join(root, "resources", "plugins");
    bundled(pluginsDir, "p", { "@s/b": "^1" });
    writeJson(path.join(root, "node_modules", "@s", "package.json"), {});
    expect(findUnresolvedPluginDeps({ pluginsDir, rootDir: root })).toEqual([{ plugin: "p", dep: "@s/b" }]);
  });

  it("checks first-party deps and skips dirs without a manifest (test-plan #E12)", () => {
    const root = path.join(tmp, "root");
    const pluginsDir = path.join(root, "resources", "plugins");
    bundled(pluginsDir, "p", { "@blackbelt-technology/pi-dashboard-shared": "x" });
    fs.mkdirSync(path.join(pluginsDir, "stray"), { recursive: true });
    expect(findUnresolvedPluginDeps({ pluginsDir, rootDir: root })).toEqual([
      { plugin: "p", dep: "@blackbelt-technology/pi-dashboard-shared" },
    ]);
  });
});
