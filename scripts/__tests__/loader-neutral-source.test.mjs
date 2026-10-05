/**
 * Repo gate for the native-ts-loader "loader-neutral source" requirement:
 * first-party TypeScript the dashboard SERVER loads (its own loader — native by
 * default, jiti on fallback) must not depend on the CommonJS globals jiti
 * injects (`require`, `__dirname`, `__filename`, `module.exports`, `exports.`)
 * and must not value-import `.tsx`. Detection is AST-level; scope is derived
 * from the `serverMain` + `pluginServer` seed kinds of `lib-jiti-scope.mjs`.
 *
 * Fixture + gate harness pattern: `jiti-cjs-transpile-safety.test.mjs`.
 * See change: fix-appimage-cold-boot-latency (test-plan E23–E28, design D5).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoaderNeutralGate } from "../check-loader-neutral-source.mjs";
import { discoverSeeds, repoRoot } from "../lib-jiti-scope.mjs";

const GATE = path.join(repoRoot, "scripts", "check-loader-neutral-source.mjs");
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A fixture repo: a jiti-bootstrapped `serverMain` workspace + `extra` files. */
function fixtureRepo(extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "loader-neutral-"));
  roots.push(root);
  const files = {
    "packages/srv/package.json": JSON.stringify({ name: "srv", main: "src/cli.ts", bin: { srv: "bin/srv.mjs" } }),
    "packages/srv/bin/srv.mjs": "// re-execs cli.ts under the native loader or jiti\n",
    "packages/srv/src/cli.ts": "export const ok: boolean = true;\n",
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const rulesOf = (res) => res.violations.map((v) => `${v.file}:${v.line} ${v.rule}`);

describe("violations (E23)", () => {
  it("reports each CJS global and a value-imported .tsx with file:line; CLI exits non-zero", () => {
    const root = fixtureRepo({
      "packages/srv/src/cli.ts": `import { a } from "./a.js";\nimport { V } from "./view.js";\nexport const all = [a, V];\n`,
      "packages/srv/src/a.ts": `export const a = 1;\nconst x = require("x");\nconsole.log(x);\n`,
      "packages/srv/src/b.ts": `export const b: string = __dirname;\n`,
      "packages/srv/src/c.ts": `const c = 1;\nmodule.exports = { c };\nexports.d = 2;\n`,
      "packages/srv/src/view.tsx": `export const V = 1;\n`,
    });
    const res = runLoaderNeutralGate({ root });
    expect(res.ok).toBe(false);
    const rules = rulesOf(res);
    expect(rules).toContain("packages/srv/src/a.ts:2 require");
    expect(rules).toContain("packages/srv/src/b.ts:1 __dirname");
    expect(rules).toContain("packages/srv/src/c.ts:2 module.exports");
    expect(rules).toContain("packages/srv/src/c.ts:3 exports");
    expect(rules.some((r) => r.startsWith("packages/srv/src/view.tsx:") && r.endsWith(" tsx"))).toBe(true);

    const cli = spawnSync(process.execPath, [GATE, "--root", root], { encoding: "utf8" });
    expect(cli.status).not.toBe(0);
    expect(cli.stderr + cli.stdout).toContain("packages/srv/src/a.ts:2");
  });
});

describe("allowed shapes (E24)", () => {
  it("createRequire binding, local __dirname, template literal text, import type of .tsx → zero violations", () => {
    const root = fixtureRepo({
      "packages/srv/src/cli.ts": [
        `import { createRequire } from "node:module";`,
        `import { dirname } from "node:path";`,
        `import { fileURLToPath } from "node:url";`,
        `import type { Props } from "./view.js";`,
        `const nativeRequire = createRequire(import.meta.url);`,
        `const __dirname = dirname(fileURLToPath(import.meta.url));`,
        "const script = `const fs = require(\"node:fs\"); module.exports = 1;`;",
        `export const out: Props | string = nativeRequire.resolve("x") + __dirname + script;`,
        "",
      ].join("\n"),
      "packages/srv/src/view.tsx": `export interface Props { a: number }\n`,
    });
    const res = runLoaderNeutralGate({ root });
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("scope (E25)", () => {
  const plugin = (entries) => ({
    "packages/plug/package.json": JSON.stringify({ name: "plug", "pi-dashboard-plugin": { id: "plug", ...entries } }),
    "packages/plug/src/shared/helper.ts": `export const where: string = __dirname;\n`,
    "packages/plug/src/bridge/index.ts": `import { where } from "../shared/helper.js";\nexport default where;\n`,
    "packages/plug/src/server/index.ts": `import { where } from "../shared/helper.js";\nexport default where;\n`,
  });

  it("a file reachable only from a plugin bridge seed is not reported", () => {
    const root = fixtureRepo(plugin({ bridge: "src/bridge/index.ts" }));
    const res = runLoaderNeutralGate({ root });
    expect(res.files).not.toContain("packages/plug/src/shared/helper.ts");
    expect(res.violations).toEqual([]);
  });

  it("the same file reached from a pluginServer seed is reported", () => {
    const root = fixtureRepo(plugin({ bridge: "src/bridge/index.ts", server: "src/server/index.ts" }));
    const res = runLoaderNeutralGate({ root });
    expect(rulesOf(res)).toContain("packages/plug/src/shared/helper.ts:1 __dirname");
  });
});

describe("fail closed (E26)", () => {
  it("an empty file set is a gate failure", () => {
    const root = fixtureRepo();
    const res = runLoaderNeutralGate({
      root,
      discoverSeeds: () => ({ piExtensions: [], mainTs: [], pluginEntries: [], tagged: [] }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty file set/);
  });
});

describe("seed discovery reads both manifest forms (E28)", () => {
  it("an adjacent dashboard-plugin.json wins over package.json#pi-dashboard-plugin", () => {
    const root = fixtureRepo({
      "packages/plug/package.json": JSON.stringify({ name: "plug", "pi-dashboard-plugin": { id: "plug", server: "src/old.ts" } }),
      "packages/plug/dashboard-plugin.json": JSON.stringify({ id: "plug", server: "src/new.ts" }),
      "packages/plug/src/old.ts": "export {};\n",
      "packages/plug/src/new.ts": "export {};\n",
    });
    const servers = discoverSeeds(root).tagged.filter((s) => s.kind === "pluginServer").map((s) => s.entry);
    expect(servers).toEqual([path.join("packages", "plug", "src", "new.ts")]);
  });
});

describe("current tree (E27)", () => {
  it("the repo at HEAD has zero violations", () => {
    const res = runLoaderNeutralGate({ root: repoRoot });
    expect(res.error).toBeUndefined();
    expect(res.files.length).toBeGreaterThan(0);
    expect(res.files).toContain("packages/server/src/routes/file-routes.ts");
    expect(rulesOf(res)).toEqual([]);
  }, 120_000);
});
