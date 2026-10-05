/**
 * Node-native TypeScript loader (`platform/native-ts-register.mjs`) — L1
 * subprocess tests. Each case writes a tiny fixture tree to a temp dir and
 * runs `node --import <register> <entry>` against it (harness pattern copied
 * from `packages/server/src/lib/__tests__/purify-jiti.test.ts`).
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E1–E6, X1, X2).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

describe("native-ts-register load", () => {
  it("E5: transform mode handles enums + parameter properties under node_modules", () => {
    const dir = fixture({
      "a.ts": `import { E, K } from "./node_modules/x/index.ts";\nconsole.log(E.A, new K(7).v);\n`,
      "node_modules/x/index.ts":
        `export enum E { A = 1 }\nexport class K { constructor(public v: number) {} }\n`,
    });
    const res = run(dir, "a.ts");
    expect(res.stderr).not.toMatch(/Error/);
    expect(res.stderr).not.toContain("ExperimentalWarning");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("1 7");
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
});

describe("native-ts-register guard", () => {
  it("X1: names the jiti escape hatch when stripTypeScriptTypes is missing", () => {
    const dir = fixture({
      "x.ts": `console.log("ran");\n`,
      "preload.mjs": `import mod from "node:module";\ndelete mod.stripTypeScriptTypes;\n`,
    });
    const res = run(dir, "x.ts", [pathToFileURL(path.join(dir, "preload.mjs")).href]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("PI_DASHBOARD_TS_LOADER=jiti");
    expect(res.stdout).not.toContain("ran");
  });
});
