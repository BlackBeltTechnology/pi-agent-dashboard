/**
 * Plugin/core boundary gate (`scripts/check-plugin-boundary.mjs`): tmp-tree
 * scenarios (test-plan #E1-#E8) plus the real-tree assertions (#E9).
 *
 * Every scenario builds a minimal `packages/*` tree in a tmp dir and drives the
 * CLI with `--root`, so the gate's real code path (not a re-implementation) is
 * what the assertions observe.
 *
 * See change: decouple-plugins-from-core.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-plugin-boundary.mjs");
const ALLOWLIST = "scripts/plugin-boundary-allowlist.json";
const SCOPE = "@blackbelt-technology";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

/** package.json for `packages/<dir>`; `plugin` = manifest object (or undefined for core). */
function pkgJson(dir, { plugin, deps = {}, devDeps = {}, peerDeps = {}, optionalDeps = {}, name } = {}) {
  const json = { name: name ?? `${SCOPE}/pi-dashboard-${dir}`, version: "1.0.0" };
  if (plugin) json["pi-dashboard-plugin"] = { id: dir, displayName: dir, ...plugin };
  if (Object.keys(deps).length) json.dependencies = deps;
  if (Object.keys(devDeps).length) json.devDependencies = devDeps;
  if (Object.keys(peerDeps).length) json.peerDependencies = peerDeps;
  if (Object.keys(optionalDeps).length) json.optionalDependencies = optionalDeps;
  return json;
}

const pkgName = (dir) => `${SCOPE}/pi-dashboard-${dir}`;

/** Base tree: core (shared, server, client, mcp-core) + plugins (roles, goal, apple-tools, ...). */
function makeTree(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-boundary-"));
  tmpDirs.push(root);
  const files = {
    "packages/shared/package.json": pkgJson("shared"),
    "packages/server/package.json": pkgJson("server"),
    "packages/client/package.json": pkgJson("client"),
    "packages/mcp-core/package.json": pkgJson("mcp-core"),
    "packages/roles-plugin/package.json": pkgJson("roles-plugin", { plugin: { client: "./src/index.tsx" } }),
    "packages/goal-plugin/package.json": pkgJson("goal-plugin", { plugin: { client: "./src/client/index.tsx" } }),
    "packages/apple-tools/package.json": pkgJson("apple-tools", { plugin: { client: "./src/client/index.tsx" } }),
    "packages/mcp-server-plugin/package.json": pkgJson("mcp-server-plugin", { plugin: { server: "./src/server/index.ts" } }),
    "packages/chat-gateway/package.json": pkgJson("chat-gateway", { plugin: { client: "./src/client/index.tsx" } }),
    "packages/demo-plugin/package.json": pkgJson("demo-plugin", { plugin: { client: "./src/index.tsx", fixture: true } }),
    "packages/serverless-plugin/package.json": pkgJson("serverless-plugin", { plugin: { server: "./src/s.ts" } }),
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

function run(root, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf8" });
  const out = `${res.stdout}${res.stderr}`;
  const edges = [...out.matchAll(/^NEW \[(\w+)\] (\S+) → (\S+)/gm)].map((m) => ({ kind: m[1], from: m[2], to: m[3] }));
  return { status: res.status, out, edges };
}

const ROLES = `${SCOPE}/pi-dashboard-roles-plugin`;
const readAllowlist = (root) => JSON.parse(fs.readFileSync(path.join(root, ALLOWLIST), "utf8"));
const row = (from, to, kind = "prod", extra = {}) => ({
  from,
  to,
  kind,
  reason: "r",
  disposition: "remove",
  removedBy: "2.1",
  ...extra,
});
const allowlist = (...rows) => ({ rows });

describe("check-plugin-boundary", () => {
  // test-plan #E1
  describe("plugin set is derived from manifests", () => {
    it("a suffix-less plugin is a plugin; a manifest-less library is core", () => {
      const root = makeTree({
        "packages/server/src/x.ts": `import { a } from "${pkgName("apple-tools")}";\nexport const x = a;\n`,
        "packages/goal-plugin/src/a.ts": `import { m } from "${pkgName("mcp-core")}";\nexport const a = m;\n`,
      });
      const r = run(root, ["--no-allowlist"]);
      expect(r.status).not.toBe(0);
      expect(r.edges).toEqual([{ kind: "prod", from: "packages/server/src/x.ts", to: "apple-tools" }]);
    });

    it("an adjacent dashboard-plugin.json also makes a plugin", () => {
      const root = makeTree({
        "packages/legacy-thing/package.json": pkgJson("legacy-thing"),
        "packages/legacy-thing/dashboard-plugin.json": { id: "legacy-thing", displayName: "L" },
        "packages/server/src/x.ts": `import "${pkgName("legacy-thing")}";\n`,
      });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([
        { kind: "prod", from: "packages/server/src/x.ts", to: "legacy-thing" },
      ]);
    });
  });

  // test-plan #E2
  describe("edge forms and exclusions", () => {
    const forms = {
      "type-import": `import type { T } from "${ROLES}";\n`,
      "export-star": `export * from "${ROLES}";\n`,
      "template-import": `export const load = (x: string) => import(\`${ROLES}/\${x}\`);\n`,
      require: `const r = require("${ROLES}");\n`,
      "import-type-expr": `export type T = import("${ROLES}").X;\n`,
    };
    const mocks = {
      "vi-mock": `vi.mock("${ROLES}");\n`,
      "jest-mock": `jest.mock("${ROLES}");\n`,
      "vi-actual": `const a = await vi.importActual("${ROLES}");\n`,
    };

    it("reports all 8 forms with the right kind; ignores comments, strings and self-imports", () => {
      const files = {};
      for (const [k, src] of Object.entries(forms)) files[`packages/shared/src/${k}.ts`] = src;
      for (const [k, src] of Object.entries(mocks)) files[`packages/shared/src/${k}.test.ts`] = src;
      files["packages/shared/src/clean.ts"] = [
        `// import x from "${ROLES}"`,
        `/* vi.mock("${ROLES}") */`,
        `export const s = "${ROLES}";`,
        `export const t = "roles-plugin";`,
      ].join("\n");
      files["packages/roles-plugin/src/self.ts"] = `import "${ROLES}";\n`;
      const r = run(makeTree(files), ["--no-allowlist"]);
      expect(r.edges).toHaveLength(8);
      const byFrom = Object.fromEntries(r.edges.map((e) => [path.basename(e.from), e]));
      for (const k of Object.keys(forms)) expect(byFrom[`${k}.ts`]).toMatchObject({ kind: "prod", to: "roles-plugin" });
      for (const k of Object.keys(mocks)) expect(byFrom[`${k}.test.ts`]).toMatchObject({ kind: "test", to: "roles-plugin" });
      expect(r.edges.some((e) => /clean\.ts|self\.ts/.test(e.from))).toBe(false);
    });

    it("a relative path into another package is an edge", () => {
      const r = run(makeTree({ "packages/shared/src/rel.ts": `import "../../roles-plugin/src/index";\n` }), ["--no-allowlist"]);
      expect(r.edges).toEqual([{ kind: "prod", from: "packages/shared/src/rel.ts", to: "roles-plugin" }]);
    });

    it("a relative path back into the own package is not an edge", () => {
      const r = run(makeTree({ "packages/roles-plugin/src/a.ts": `import "../../roles-plugin/src/b";\n` }), ["--no-allowlist"]);
      expect(r.edges).toEqual([]);
    });
  });

  // test-plan #E3
  describe("dependency and stylesheet edges", () => {
    it("reports 4 dependency-field edges, 1 css edge and a client dep on a client-less plugin", () => {
      const root = makeTree({
        "packages/shared/package.json": pkgJson("shared", {
          deps: { [pkgName("roles-plugin")]: "^1" },
          devDeps: { [pkgName("goal-plugin")]: "^1" },
          peerDeps: { [pkgName("apple-tools")]: "^1" },
          optionalDeps: { [pkgName("chat-gateway")]: "^1" },
        }),
        "packages/client/package.json": pkgJson("client", { deps: { [pkgName("serverless-plugin")]: "^1" } }),
        "packages/client/src/hand.css": `@source "../../goal-plugin/src/client";\n`,
      });
      const r = run(root, ["--no-allowlist"]);
      const pkg = r.edges.filter((e) => e.kind === "pkg");
      expect(pkg).toHaveLength(5);
      expect(pkg.map((e) => `${e.from}>${e.to}`).sort()).toEqual(
        [
          "packages/client/package.json>serverless-plugin",
          "packages/shared/package.json>apple-tools",
          "packages/shared/package.json>chat-gateway",
          "packages/shared/package.json>goal-plugin",
          "packages/shared/package.json>roles-plugin",
        ].sort(),
      );
      expect(r.edges.filter((e) => e.kind === "css")).toEqual([
        { kind: "css", from: "packages/client/src/hand.css", to: "goal-plugin" },
      ]);
    });
  });

  // test-plan #E4
  it("a plugin-to-plugin import fails the gate, naming file and target", () => {
    const root = makeTree({
      "packages/chat-gateway/src/server/team/tier.ts": `import { m } from "${pkgName("mcp-server-plugin")}/manifest";\n`,
      [ALLOWLIST]: allowlist(),
    });
    const r = run(root);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("NEW [prod] packages/chat-gateway/src/server/team/tier.ts → mcp-server-plugin");
  });

  // test-plan #E5
  describe("exemptions are explicit, narrow and manifest-derived", () => {
    const registry = (names) => names.map((n) => `import "${pkgName(n)}";`).join("\n");

    it("(a) the generated registry and plugin-sources.css are exempt", () => {
      const root = makeTree({
        "packages/client/src/generated/plugin-registry.tsx": registry(["roles-plugin", "demo-plugin", "serverless-plugin"]),
        "packages/client/src/generated/plugin-sources.css": `@source "../../../roles-plugin/src";\n@source "../../../demo-plugin/src";\n`,
      });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([]);
    });

    it("(b) a new bundled plugin needs no allowlist row", () => {
      const root = makeTree({
        "packages/new-plugin/package.json": pkgJson("new-plugin", { plugin: { client: "./src/client/index.tsx" } }),
        "packages/client/package.json": pkgJson("client", { deps: { [pkgName("new-plugin")]: "^1" } }),
        "packages/client/src/generated/plugin-sources.css": `@source "../../../new-plugin/src/client";\n`,
        [ALLOWLIST]: allowlist(),
      });
      const before = fs.readFileSync(path.join(root, ALLOWLIST), "utf8");
      expect(run(root).status).toBe(0);
      expect(fs.readFileSync(path.join(root, ALLOWLIST), "utf8")).toBe(before);
    });

    it("(c) a fixture plugin imported from production code is reported", () => {
      const root = makeTree({ "packages/client/src/App.tsx": `import "${pkgName("demo-plugin")}";\n` });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([{ kind: "prod", from: "packages/client/src/App.tsx", to: "demo-plugin" }]);
    });

    it("(d) a fixture plugin from a test file or a devDependency is exempt", () => {
      const root = makeTree({
        "packages/client/src/__tests__/App.test.tsx": `import "${pkgName("demo-plugin")}";\n`,
        "packages/client/package.json": pkgJson("client", { devDeps: { [pkgName("demo-plugin")]: "^1" } }),
      });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([]);
    });

    it("(e) a non-fixture plugin is not exempt in client devDependencies", () => {
      const root = makeTree({
        "packages/client/package.json": pkgJson("client", { devDeps: { [pkgName("roles-plugin")]: "^1" } }),
      });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([
        { kind: "pkg", from: "packages/client/package.json", to: "roles-plugin" },
      ]);
    });
  });

  // test-plan #E6
  describe("ratcheting allowlist", () => {
    const green = () =>
      makeTree({
        "packages/client/src/lib/package/anthropic-peer.ts": `import { P } from "${ROLES}";\nexport const x = P;\n`,
        [ALLOWLIST]: allowlist(row("packages/client/src/lib/package/anthropic-peer.ts", "roles-plugin")),
      });

    it("the matching tree is green", () => {
      expect(run(green()).status).toBe(0);
    });

    it("(a) a new edge fails with a NEW line", () => {
      const root = green();
      write(root, "packages/shared/src/foo.ts", `import {x} from "${ROLES}";\nexport {x};\n`);
      const r = run(root);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("NEW [prod] packages/shared/src/foo.ts → roles-plugin");
    });

    it("(b) a row whose edge is gone fails as STALE", () => {
      const root = green();
      write(root, "packages/client/src/lib/package/anthropic-peer.ts", "export const x = 1;\n");
      const r = run(root);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/STALE allowlist entry .*anthropic-peer\.ts.*delete it/);
    });

    it("a row missing its annotations fails", () => {
      const root = green();
      const al = readAllowlist(root);
      delete al.rows[0].removedBy;
      write(root, ALLOWLIST, al);
      const r = run(root);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/UNANNOTATED/);
    });
  });

  // test-plan #E7
  describe("line churn and re-seeding", () => {
    const src = `import { P } from "${ROLES}";\nexport const x = P;\n`;
    const file = "packages/client/src/a.ts";

    it.each([1, 50])("%i added lines above the import keep the row matching", (n) => {
      const root = makeTree({ [file]: src, [ALLOWLIST]: allowlist(row(file, "roles-plugin")) });
      write(root, file, `${"// pad\n".repeat(n)}${src}`);
      expect(run(root).status).toBe(0);
    });

    it("--write-baseline keeps annotations of surviving rows, drops stale ones, adds new edges", () => {
      const other = "packages/client/src/b.ts";
      const root = makeTree({
        [file]: src,
        [other]: `import "${pkgName("goal-plugin")}";\n`,
        "packages/shared/src/new.ts": `import "${ROLES}";\n`,
        [ALLOWLIST]: allowlist(
          row(file, "roles-plugin", "prod", { reason: "keep-a", disposition: "invert", removedBy: "2.1" }),
          row(other, "goal-plugin", "prod", { reason: "keep-b", disposition: "integration-keep", removedBy: "none" }),
          row("packages/gone.ts", "roles-plugin", "prod", { reason: "stale" }),
        ),
      });
      expect(run(root, ["--write-baseline"]).status).toBe(0);
      const rows = readAllowlist(root).rows;
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.from === file)).toMatchObject({ reason: "keep-a", disposition: "invert", removedBy: "2.1" });
      expect(rows.find((r) => r.from === other)).toMatchObject({ reason: "keep-b", disposition: "integration-keep", removedBy: "none" });
      expect(rows.some((r) => r.from === "packages/gone.ts")).toBe(false);
      expect(rows.find((r) => r.from === "packages/shared/src/new.ts")).toMatchObject({ to: "roles-plugin", kind: "prod" });
    });
  });

  // test-plan #E8
  describe("integration-keep rows", () => {
    const test = "packages/server/src/__tests__/mcp-manifest-completeness.test.ts";
    const setup = "packages/server/vitest.setup.ts";
    const pkgFile = "packages/server/package.json";
    const tree = () =>
      makeTree({
        [test]: `import "${pkgName("mcp-server-plugin")}";\n`,
        [setup]: `import "${pkgName("goal-plugin")}";\n`,
        [pkgFile]: pkgJson("server", { devDeps: { [pkgName("mcp-server-plugin")]: "^1" } }),
        [ALLOWLIST]: allowlist(
          row(test, "mcp-server-plugin", "test", { disposition: "integration-keep", removedBy: "none" }),
          row(setup, "goal-plugin", "test", { disposition: "integration-keep", removedBy: "none" }),
          row(pkgFile, "mcp-server-plugin", "pkg", { disposition: "integration-keep", removedBy: "none" }),
        ),
      });

    it("accepts the three rows; the setup file counts as a test source", () => {
      const root = tree();
      expect(run(root).status).toBe(0);
      expect(run(root, ["--no-allowlist"]).edges.map((e) => `${e.kind}:${path.basename(e.from)}`).sort()).toEqual([
        "pkg:package.json",
        "test:mcp-manifest-completeness.test.ts",
        "test:vitest.setup.ts",
      ]);
    });

    it.each([0, 1, 2])("deleting row %i reports a NEW edge", (i) => {
      const root = tree();
      const al = readAllowlist(root);
      const [gone] = al.rows.splice(i, 1);
      write(root, ALLOWLIST, al);
      const r = run(root);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(`NEW [${gone.kind}] ${gone.from} → ${gone.to}`);
    });
  });

  // plugin non-test source importing the runtime `./host` subpath (task 1.1)
  describe("runtime ./host from plugin source", () => {
    const host = "@blackbelt-technology/dashboard-plugin-runtime/host";
    it("reports plugin production source, not tests, not core", () => {
      const root = makeTree({
        "packages/dashboard-plugin-runtime/package.json": pkgJson("dashboard-plugin-runtime", {
          name: "@blackbelt-technology/dashboard-plugin-runtime",
        }),
        "packages/roles-plugin/src/a.ts": `import { createSlotRegistry } from "${host}";\n`,
        "packages/roles-plugin/src/__tests__/a.test.ts": `import { createSlotRegistry } from "${host}";\n`,
        "packages/client/src/shell.ts": `import { createSlotRegistry } from "${host}";\n`,
      });
      expect(run(root, ["--no-allowlist"]).edges).toEqual([
        { kind: "host", from: "packages/roles-plugin/src/a.ts", to: "dashboard-plugin-runtime/host" },
      ]);
    });
  });

  // test-plan #E9
  describe("real tree", () => {
    // Ratchet: the baseline was 76 rows (prod 11 / test 34 / pkg 6 / css 25); each Phase-1 inversion
    // deletes its rows (decouple-plugins-from-core tasks 2.1-2.7, 2.15). Update the counts WHEN a task
    // removes rows, never up.
    it("is green with 57 rows (prod 1 / test 30 / pkg 1 / css 25)", () => {
      const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      const rows = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALLOWLIST), "utf8")).rows;
      const count = (k) => rows.filter((x) => x.kind === k).length;
      expect({ total: rows.length, prod: count("prod"), test: count("test"), pkg: count("pkg"), css: count("css") }).toEqual({
        total: 57,
        prod: 1,
        test: 30,
        pkg: 1,
        css: 25,
      });
    });

    it("every real row is fully annotated; integration-keep rows name their contract", () => {
      const rows = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALLOWLIST), "utf8")).rows;
      for (const r of rows) {
        expect(r.reason, `${r.from} → ${r.to}`).toBeTruthy();
        expect(r.disposition, `${r.from} → ${r.to}`).toBeTruthy();
        expect(r.removedBy, `${r.from} → ${r.to}`).toBeTruthy();
      }
      const keep = rows.filter((r) => r.disposition === "integration-keep").map((r) => r.from);
      for (const f of [
        "packages/server/package.json",
        "packages/server/src/__tests__/host-gate-inject.test.ts",
        "packages/server/src/__tests__/mcp-manifest-completeness.test.ts",
      ]) {
        expect(keep).toContain(f);
      }
      for (const r of rows.filter((x) => x.disposition === "integration-keep")) {
        expect(r.reason.length, `${r.from} → ${r.to}`).toBeGreaterThan(20);
      }
      // task 2.15 dropped the unused client dependency, so its row is gone.
      expect(rows.find((r) => r.to === "keycloak-resolver-plugin")).toBeUndefined();
    });

    it("a tmp tree with an injected core → plugin import fails with the NEW line", () => {
      const root = makeTree({
        "packages/shared/src/injected.ts": `import "${ROLES}";\n`,
        [ALLOWLIST]: allowlist(),
      });
      const r = run(root);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("NEW [prod] packages/shared/src/injected.ts → roles-plugin");
    });
  });
});
