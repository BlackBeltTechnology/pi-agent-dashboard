/**
 * Repo gate for the native-ts-loader "loader-neutral source" requirement:
 * first-party TypeScript the dashboard SERVER loads (its only loader — the
 * Node-native strip-only one) must not depend on the CommonJS globals a transpiler
 * injects (`require`, `__dirname`, `__filename`, `module.exports`, `exports.`)
 * and must not value-import `.tsx`. Detection is AST-level; scope is derived
 * from the `serverMain` + `pluginServer` seed kinds of `lib-jiti-scope.mjs`.
 *
 * Fixture + gate harness pattern: `jiti-cjs-transpile-safety.test.mjs`.
 * Also hosts the strip-only-native-ts-loader repo gates: E10 (erasable-only
 * type-check), E22 (removed predecessors), E23s (no jiti import in server source).
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E23–E28, design D5);
 *             strip-only-native-ts-loader (test-plan E10, E22, E23).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** A fixture repo: a loader-bootstrapped `serverMain` workspace + `extra` files. */
function fixtureRepo(extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "loader-neutral-"));
  roots.push(root);
  const files = {
    "packages/srv/package.json": JSON.stringify({ name: "srv", main: "src/cli.ts", bin: { srv: "bin/srv.mjs" } }),
    "packages/srv/bin/srv.mjs": "// re-execs cli.ts: node --import native-ts-register.mjs cli.ts\n",
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

// The gate reports repo-relative paths with OS separators (`path.relative`);
// compare in POSIX form so the assertions hold on Windows too.
const posix = (p) => p.replace(/\\/g, "/");
const rulesOf = (res) => res.violations.map((v) => `${posix(v.file)}:${v.line} ${v.rule}`);
const filesOf = (res) => res.files.map(posix);

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
    expect(posix(cli.stderr + cli.stdout)).toContain("packages/srv/src/a.ts:2");
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
    expect(filesOf(res)).not.toContain("packages/plug/src/shared/helper.ts");
    expect(res.violations).toEqual([]);
  });

  it("the same file reached from a pluginServer seed is reported", () => {
    const root = fixtureRepo(plugin({ bridge: "src/bridge/index.ts", server: "src/server/index.ts" }));
    const res = runLoaderNeutralGate({ root });
    expect(rulesOf(res)).toContain("packages/plug/src/shared/helper.ts:1 __dirname");
  });
});

describe("import resolution follows the exact on-disk target", () => {
  it("scans an imported helper.js (not only TS remaps of it)", () => {
    const root = fixtureRepo({
      "packages/srv/package.json": JSON.stringify({ name: "srv", type: "module", main: "src/cli.ts", bin: { srv: "bin/srv.mjs" } }),
      "packages/srv/src/cli.ts": `import { h } from "../lib/helper.js";\nexport const x = h;\n`,
      "packages/srv/lib/helper.js": `export const h = require("x");\n`,
    });
    expect(rulesOf(runLoaderNeutralGate({ root }))).toContain("packages/srv/lib/helper.js:1 require");
  });
});

describe("fail closed (E26)", () => {
  it("a discovered file that cannot be read is a violation, not a clean pass", () => {
    const root = fixtureRepo({
      "packages/plug/package.json": JSON.stringify({ name: "plug", "pi-dashboard-plugin": { id: "plug", server: "src/server/missing.ts" } }),
    });
    const res = runLoaderNeutralGate({ root });
    expect(res.ok).toBe(false);
    expect(rulesOf(res)).toContain("packages/plug/src/server/missing.ts:0 unreadable");
  });

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
    expect(filesOf(res)).toContain("packages/server/src/routes/file-routes.ts");
    expect(rulesOf(res)).toEqual([]);
  }, 120_000);
});

/**
 * E10 — `erasableSyntaxOnly` in `tsconfig.base.json` makes the type-checker
 * reject, per file, the syntax Node's strip-only loader cannot run.
 */
describe("erasable-only type-check gate (E10)", () => {
  // Run the repo's own compiler; `node scripts/tsc7.mjs` replaces it once
  // `migrate-typecheck-to-ts7` has landed.
  const tscEntry = existsSync(path.join(repoRoot, "scripts", "tsc7.mjs"))
    ? [path.join(repoRoot, "scripts", "tsc7.mjs")]
    : [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")];

  it("tsc --noEmit exits non-zero with TS1294 for a parameter property and for an enum", () => {
    // Under the repo so `extends` resolves; removed in afterEach via `roots`.
    const dir = mkdtempSync(path.join(repoRoot, "scripts", "__tests__", ".erasable-"));
    roots.push(dir);
    writeFileSync(path.join(dir, "param-prop.ts"), "export class P {\n  constructor(public readonly n: number) {}\n}\n");
    writeFileSync(path.join(dir, "an-enum.ts"), "export enum Color {\n  Red,\n  Green,\n}\n");
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "../../../tsconfig.base.json", compilerOptions: { noEmit: true, types: [] }, include: ["*.ts"] }),
    );
    const res = spawnSync(process.execPath, [...tscEntry, "--noEmit", "-p", dir], { encoding: "utf8", cwd: repoRoot });
    const out = posix(res.stdout + res.stderr);
    expect(res.status, out).not.toBe(0);
    expect(out).toMatch(/param-prop\.ts\(\d+,\d+\): error TS1294/);
    expect(out).toMatch(/an-enum\.ts\(\d+,\d+\): error TS1294/);
  }, 120_000);
});

/**
 * E22 — the removed jiti-selection predecessors stay removed. The two
 * commands are the ones in the `server-launch` spec scenario "Symbol-presence
 * check" ("Removed predecessors"); POSIX classes because `git grep -E` does not
 * honour `\b` / `\s`.
 */
describe("removed predecessors stay removed (E22)", () => {
  const gitGrep = (...args) => spawnSync("git", ["grep", ...args], { cwd: repoRoot, encoding: "utf8" });
  const EXCLUDES = [":!packages/**/dist/**", ":!packages/**/out/**", ":!packages/electron/resources/**", ":!packages/**/__tests__/**"];

  it("no call-shaped mention of a removed resolver/selector under packages/", () => {
    const res = gitGrep(
      "-nwE",
      "(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl|resolveJiti|selectTsLoader|nativeTransformSupported)[[:space:]]*\\(",
      "--",
      "packages/",
      ...EXCLUDES,
    );
    expect(res.status, res.stdout + res.stderr).toBe(1); // git grep: 1 = no match
    expect(res.stdout).toBe("");
  });

  // `:!packages/**/__tests__/**` added to the spec's command: the repo's own
  // `removed-symbols-stay-gone.test.ts` legitimately names the symbol it guards.
  it("no ts-loader-resolver reference in packages TypeScript", () => {
    const res = gitGrep("-nwE", "ts-loader-resolver", "--", "packages/**/*.ts", ...EXCLUDES);
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stdout).toBe("");
  });

  it("no word-match of JitiResolver / JitiNotFoundError / _resolveJiti / selectTsLoader / nativeTransformSupported", () => {
    const res = gitGrep(
      "-nwE",
      "(JitiResolver|JitiNotFoundError|_?resolveJiti|selectTsLoader|nativeTransformSupported)",
      "--",
      "packages/**/*.ts",
      "packages/**/*.mjs",
      "packages/**/*.mts",
      ...EXCLUDES,
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stdout).toBe("");
  });
});

/**
 * E23 — packaging: no dashboard-server source imports jiti. The package keeps
 * `jiti` only as a transitional runtime dependency for restart continuity.
 */
describe("server source never imports jiti (E23)", () => {
  it("no `from \"jiti\"`, `require(\"jiti\")` or `import(\"jiti\")` in packages/server/{src,bin} and packages/shared/src (non-test)", () => {
    const res = spawnSync(
      "git",
      [
        "grep",
        "-nE",
        "(from[[:space:]]*|require[[:space:]]*\\([[:space:]]*|import[[:space:]]*\\([[:space:]]*)[\"'](@mariozechner/)?jiti(/[^\"']*)?[\"']",
        "--",
        "packages/server/src",
        "packages/server/bin",
        "packages/shared/src",
        ":!**/__tests__/**",
        ":!**/*.test.*",
        ":!**/*.spec.*",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stdout).toBe("");
  });
});
