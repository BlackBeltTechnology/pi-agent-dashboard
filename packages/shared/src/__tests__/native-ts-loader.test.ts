/**
 * Node-native TypeScript loader (`platform/native-ts-register.mjs`) — L1
 * subprocess tests. Each case writes a tiny fixture tree to a temp dir and
 * runs `node --import <register> <entry>` against it (harness pattern copied
 * from `packages/server/src/lib/__tests__/purify-jiti.test.ts`).
 *
 * Strip-only on `module.registerHooks` (tier 1), with `module.register` + native
 * strip (tier 2) and bundled `amaro` (tier 3) fallbacks, forced here by a
 * preload that deletes the APIs from `node:module`.
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E1–E6, X1, X2);
 * strip-only-native-ts-loader (test-plan #E1–#E9).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { selectLoaderTier } from "../platform/native-ts-tier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const register = pathToFileURL(path.resolve(here, "..", "platform", "native-ts-register.mjs")).href;

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "native-ts-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function run(dir: string, entry: string, preImports: string[] = []) {
  const args = [...preImports.flatMap((p) => ["--import", p]), "--import", register, path.join(dir, entry)];
  return spawnSync(process.execPath, args, { encoding: "utf8", cwd: dir, timeout: 30_000 });
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("native-ts-register resolve", () => {
  it("E1: rewrites ./b.js to ./b.ts when only the .ts exists", () => {
    const dir = fixture({
      "a.ts": `import { v } from "./b.js";\nconsole.log(v);\n`,
      "b.ts": `export const v: string = "from-b-ts";\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.stderr).not.toMatch(/Error/);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("from-b-ts");
  });

  it("E2: prefers an existing b.js over b.ts", () => {
    const dir = fixture({
      "a.ts": `import { v } from "./b.js";\nconsole.log(v);\n`,
      "b.ts": `export const v: string = "from-b-ts";\n`,
      "b.js": `export const v = "from-b-js";\n`,
      "package.json": `{"type":"module"}`,
    });
    const res = run(dir, "a.ts");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("from-b-js");
  });

  it("E3: resolves a directory import to index.ts and an extensionless import to .ts", () => {
    const dir = fixture({
      "a.ts": `import { d } from "./dir";\nimport { c } from "./c";\nconsole.log(d, c);\n`,
      "dir/index.ts": `export const d: number = 1;\n`,
      "c.ts": `export const c: number = 2;\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("1 2");
  });

  it("E4: never rewrites a bare specifier", () => {
    const dir = fixture({
      "a.ts": `import "no-such-pkg";\n`,
      "no-such-pkg.ts": `console.log("SIBLING-LOADED");\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("ERR_MODULE_NOT_FOUND");
    expect(res.stderr).toContain("no-such-pkg");
    expect(res.stdout).not.toContain("SIBLING-LOADED");
  });

  it("E6: adds the json attribute to an attribute-less JSON import", () => {
    const dir = fixture({
      "a.ts": `import data from "./d.json";\nconsole.log(data.k);\n`,
      "d.json": `{"k":"json-value"}`,
    });
    const res = run(dir, "a.ts");
    expect(res.stderr).not.toContain("ERR_IMPORT_ATTRIBUTE_MISSING");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("json-value");
  });
});

describe("native-ts-register load (strip-only)", () => {
  it("E5: rejects an enum and a parameter property, naming the file, without running the module body", () => {
    for (const [name, body] of [
      ["enum.ts", `console.log("BODY-RAN");\nexport enum E { A = 1 }\n`],
      ["pp.ts", `console.log("BODY-RAN");\nexport class K { constructor(public v: number) {} }\n`],
    ] as const) {
      const dir = fixture({ [name]: body, "a.ts": `import "./${name}";\n` });
      const res = run(dir, "a.ts");
      expect(res.error).toBeUndefined(); // not a timeout
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain(path.join(dir, name).replace(/^\/private/, ""));
      expect(res.stdout).not.toContain("BODY-RAN");
    }
  });

  it("X2: unsupported syntax fails loudly and names the file", () => {
    const dir = fixture({
      "bad.ts": `import x = require("y");\nconsole.log(x);\n`,
    });
    const res = run(dir, "bad.ts");
    expect(res.error).toBeUndefined(); // not a timeout
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("bad.ts");
  });

  it("strips erasable syntax under node_modules (where Node refuses native stripping)", () => {
    const dir = fixture({
      "a.ts": `import { K } from "./node_modules/x/index.ts";\nconsole.log(new K(7).v);\n`,
      "node_modules/x/index.ts": `export class K { readonly v: number; constructor(v: number) { this.v = v; } }\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.stderr).not.toMatch(/Error/);
    expect(res.stderr).not.toContain("ExperimentalWarning");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("7");
  });

  it("E8: amaro is not loaded on tier 1", () => {
    const dir = fixture({
      "a.ts": `import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);\nconsole.log(Object.keys(r.cache).some((k) => k.includes("/amaro/")));\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("false");
  });

  it("E9: only the stripTypeScriptTypes ExperimentalWarning is filtered", () => {
    const dir = fixture({
      "a.ts": `const n: number = 1;\nprocess.emitWarning("custom experimental thing", "ExperimentalWarning");\nconsole.log(n);\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("stripTypeScriptTypes");
    expect(res.stderr).toContain("custom experimental thing");
  });
});

/** Force a lower tier by deleting APIs from `node:module` before the register runs. */
describe("native-ts-register tiers", () => {
  const prelude = (deleted: string[]) =>
    `import mod from "node:module";\n${deleted.map((d) => `delete mod.${d};`).join("\n")}\n`;
  const body = {
    "a.ts": `import { v } from "./b.js";\nimport d from "./d.json";\nconsole.log(v, d.k);\n`,
    "b.ts": `export const v: string = "from-b";\n`,
    "d.json": `{"k":"json"}`,
  };

  it.each([
    ["tier 2 (register + native strip)", ["registerHooks"]],
    ["tier 3 (register + bundled amaro)", ["registerHooks", "stripTypeScriptTypes"]],
  ] as const)("%s resolves .js→.ts, JSON, and strips types", (_label, deleted) => {
    const dir = fixture({ ...body, "preload.mjs": prelude([...deleted]) });
    const res = run(dir, "a.ts", [pathToFileURL(path.join(dir, "preload.mjs")).href]);
    expect(res.stderr).not.toMatch(/Error/);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("from-b json");
  });

  it("tier 3 also rejects non-erasable syntax naming the file", () => {
    const dir = fixture({
      "e.ts": `export enum E { A = 1 }\n`,
      "a.ts": `import "./e.ts";\n`,
      "preload.mjs": prelude(["registerHooks", "stripTypeScriptTypes"]),
    });
    const res = run(dir, "a.ts", [pathToFileURL(path.join(dir, "preload.mjs")).href]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("e.ts");
  });

  // #E1 — decision table for the tier selector.
  it.each([
    [true, true, 1],
    [false, true, 2],
    [false, false, 3],
    [true, false, 3],
  ] as const)("E1: registerHooks=%s stripTypeScriptTypes=%s → tier %s", (hooks, strip, tier) => {
    const mod = { ...(hooks ? { registerHooks: () => {} } : {}), ...(strip ? { stripTypeScriptTypes: () => "" } : {}) };
    expect(selectLoaderTier(mod)).toBe(tier);
  });
});

describe("native-ts-register guard", () => {
  it("E2: with neither registerHooks nor register, names the supported Node range and never mentions jiti", () => {
    const dir = fixture({
      "x.ts": `console.log("ran");\n`,
      "preload.mjs": `import mod from "node:module";\ndelete mod.registerHooks;\ndelete mod.register;\n`,
    });
    const res = run(dir, "x.ts", [pathToFileURL(path.join(dir, "preload.mjs")).href]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain(">=22.19.0 <27");
    expect(res.stderr).not.toMatch(/jiti|PI_DASHBOARD_TS_LOADER/);
    expect(res.stdout).not.toContain("ran");
  });
});
