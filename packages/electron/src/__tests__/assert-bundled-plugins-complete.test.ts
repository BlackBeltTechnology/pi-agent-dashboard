/**
 * S79 (throttle-kb-reindex, R4 decision table): the built-bundle plugin gate also proves the kb reindex
 * worker can load in the packaged layout — `reindex-worker.mjs`, `reindex-core.ts`, the kb package's
 * `exports` entry and the shared TS-loading bootstrap it imports. Drives the real CLI over fixture bundles.
 * Exemplar: assert-keyring-bundle.test.ts (credential-key-worker.mjs).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "assert-bundled-plugins-complete.mjs");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Defects {
  worker?: boolean;
  core?: boolean;
  kbEntry?: boolean;
  bootstrap?: boolean;
  /** The bundle carries no kb-plugin at all (and the source list does not expect one). */
  noKb?: boolean;
}

const put = (file: string, body = ""): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

/** `<root>/packages` (source list) + `<root>/server/resources/plugins` + `<root>/server/node_modules` (bundle). */
function fixture(d: Defects = {}): { env: Record<string, string>; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "bundled-plugins-"));
  dirs.push(root);
  const packages = path.join(root, "packages");
  const server = path.join(root, "server");
  const plugins = path.join(server, "resources", "plugins");
  const manifest = (name: string) => JSON.stringify({ name, "pi-dashboard-plugin": { id: name } });
  const other = d.noKb ? "demo-plugin" : "kb-plugin";
  put(path.join(packages, other, "package.json"), manifest(other));
  put(path.join(plugins, other, "package.json"), manifest(other));
  if (!d.noKb) {
    const srv = path.join(plugins, "kb-plugin", "src", "server");
    if (!d.worker) put(path.join(srv, "reindex-worker.mjs"), "// worker\n");
    if (!d.core) put(path.join(srv, "reindex-core.ts"), "export {};\n");
    const nm = path.join(server, "node_modules", "@blackbelt-technology");
    put(path.join(nm, "pi-dashboard-kb", "package.json"), JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-kb", exports: { ".": "./src/index.ts" } }));
    if (!d.kbEntry) put(path.join(nm, "pi-dashboard-kb", "src", "index.ts"), "export {};\n");
    put(path.join(nm, "pi-dashboard-shared", "package.json"), JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-shared", exports: { "./*.mjs": "./src/*.mjs", "./*": "./src/*" } }));
    if (!d.bootstrap) put(path.join(nm, "pi-dashboard-shared", "src", "platform", "native-ts-hooks.mjs"), "export {};\n");
  }
  return { env: { PACKAGES_DIR: packages, BUNDLE_PLUGINS_DIR: plugins, BUNDLE_ROOT_DIR: server }, root };
}

const run = (d: Defects) => {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...fixture(d).env }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe("assert-bundled-plugins-complete.mjs — kb reindex worker (S79)", () => {
  it("complete layout ⇒ exit 0", () => {
    const r = run({});
    expect(r.out).toContain("kb reindex worker");
    expect(r.code).toBe(0);
  });

  it.each([
    ["reindex-worker.mjs", { worker: true }],
    ["reindex-core.ts", { core: true }],
    ["src/index.ts", { kbEntry: true }], // the kb package's `exports["."]` target
    ["native-ts-hooks.mjs", { bootstrap: true }], // the TS-loading bootstrap the worker imports first
  ] as Array<[string, Defects]>)("missing %s ⇒ non-zero, naming it", (file, defect) => {
    const r = run(defect);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(file);
  });

  it("a bundle without kb-plugin is not asked for kb worker files", () => {
    expect(run({ noKb: true }).code).toBe(0);
  });
});
