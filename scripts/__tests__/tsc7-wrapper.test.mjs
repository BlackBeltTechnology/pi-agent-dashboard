/**
 * TypeScript 7 wrapper (`scripts/tsc7.mjs`) + the two-version split
 * (TS 7 compiles, `typescript` stays 5.x for the JS API).
 * test-plan E1–E6, E8, E9, E11, X4. E7 lives in
 * packages/kb/src/__tests__/engine-fingerprint.test.ts, E10 in
 * tests/e2e/helpers/__tests__/anchor-probe-send.test.ts.
 * Pattern: loader-neutral-source.test.mjs (spawn + temp fixtures).
 * See change: migrate-typecheck-to-ts7.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRAPPER = path.join(ROOT, "scripts", "tsc7.mjs");
const require = createRequire(import.meta.url);

const dirs = [];
const tmp = (prefix) => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const run = (cwd, args, script = WRAPPER) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

describe("wrapper resolves TypeScript 7 from any cwd (E1, E2)", () => {
  it("E1: repo root cwd", () => {
    const r = run(ROOT, ["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Version 7\./);
  });
  it("E2: package directory cwd", () => {
    const r = run(path.join(ROOT, "packages", "kb"), ["--version"], path.join("..", "..", "scripts", "tsc7.mjs"));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Version 7\./);
  });
});

describe("wrapper forwards the compiler's exit code (E3)", () => {
  it("type error → non-zero + TS2322; clean file → 0 and empty output", () => {
    const bad = tmp("tsc7-bad-");
    writeFileSync(path.join(bad, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, files: ["a.ts"] }));
    writeFileSync(path.join(bad, "a.ts"), 'export const n: number = "x";\n');
    const rb = run(ROOT, ["--noEmit", "-p", bad]);
    expect(rb.status).not.toBe(0);
    expect(rb.stdout).toContain("TS2322");

    const ok = tmp("tsc7-ok-");
    writeFileSync(path.join(ok, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, files: ["a.ts"] }));
    writeFileSync(path.join(ok, "a.ts"), "export const n: number = 1;\n");
    const rg = run(ROOT, ["--noEmit", "-p", ok]);
    expect(rg.status).toBe(0);
    expect(rg.stdout + rg.stderr).toBe("");
  });
});

describe("wrapper with the alias missing (E4)", () => {
  it("exits 1 with one stderr line naming the alias and `pnpm install`, no stack", () => {
    const d = tmp("tsc7-noalias-");
    const copy = path.join(d, "tsc7.mjs");
    copyFileSync(WRAPPER, copy);
    const r = run(d, ["--version"], copy);
    expect(r.status).toBe(1);
    const lines = r.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("typescript-7");
    expect(lines[0]).toContain("pnpm install");
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

/** A command string runs a bare `tsc` (not the wrapper `tsc7.mjs`). */
const BARE_TSC = /(^|[\s&;|(])(npx\s+)?tsc(\s|$)|\.bin\/tsc\b/;

describe("no bare tsc in type-check invocations (E5)", () => {
  const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
  const scriptsOf = (rel) => Object.entries(JSON.parse(read(rel)).scripts ?? {});

  it("package.json scripts of the root and every workspace", () => {
    const manifests = ["package.json", ...readdirSync(path.join(ROOT, "packages")).map((p) => `packages/${p}/package.json`)];
    const offenders = [];
    for (const rel of manifests) {
      try {
        statSync(path.join(ROOT, rel));
      } catch {
        continue;
      }
      for (const [name, cmd] of scriptsOf(rel)) if (BARE_TSC.test(cmd)) offenders.push(`${rel}#${name}: ${cmd}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the type-check scripts are wired to the wrapper", () => {
    const root = Object.fromEntries(scriptsOf("package.json"));
    for (const k of ["lint", "lint:e2e", "quality:changed"]) expect(root[k]).toContain("scripts/tsc7.mjs");
    expect(Object.fromEntries(scriptsOf("packages/team-app/package.json")).typecheck).toContain("scripts/tsc7.mjs");
    for (const p of ["app-kit", "bus-client", "context-budget", "kb"]) {
      expect(Object.fromEntries(scriptsOf(`packages/${p}/package.json`)).build).toContain("scripts/tsc7.mjs");
    }
  });

  it("shell scripts and send-types.test.ts", () => {
    for (const rel of ["scripts/reload-all.sh", "scripts/build.sh", "scripts/rebuild-restart.sh"]) {
      const code = read(rel).split("\n").filter((l) => !/^\s*(#|echo\b)/.test(l));
      expect(code.filter((l) => BARE_TSC.test(l)), rel).toEqual([]);
      expect(code.join("\n"), rel).toContain("scripts/tsc7.mjs");
    }
    const t = read("packages/bus-client/src/__tests__/send-types.test.ts");
    expect(t).toContain("tsc7.mjs");
    expect(t).not.toMatch(/\.bin["',\s]+["']?tsc|"\.bin"/);
  });
});

describe("require('typescript') stays on 5.x (E6)", () => {
  it("is a 5.x compiler exposing createSourceFile", () => {
    const ts = require("typescript");
    expect(ts.version).toMatch(/^5\./);
    expect(typeof ts.createSourceFile).toBe("function");
  });
});

describe("built-package emit is identical on 5.9 and the wrapper (E8)", () => {
  const files = (d, base = d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))],
    );
  const tsc5 = path.join(ROOT, "node_modules", "typescript", "lib", "tsc.js");

  for (const [pkg, cfg] of [
    ["app-kit", "tsconfig.build.json"],
    ["bus-client", "tsconfig.json"],
    ["context-budget", "tsconfig.json"],
    ["kb", "tsconfig.json"],
  ]) {
    it(pkg, () => {
      const cwd = path.join(ROOT, "packages", pkg);
      const out5 = tmp(`emit5-${pkg}-`);
      const out7 = tmp(`emit7-${pkg}-`);
      const common = ["-p", cfg, "--incremental", "false"];
      const r5 = spawnSync(process.execPath, [tsc5, ...common, "--outDir", out5], { cwd, encoding: "utf8" });
      const r7 = spawnSync(process.execPath, [WRAPPER, ...common, "--outDir", out7], { cwd, encoding: "utf8" });
      expect(r5.status, r5.stdout).toBe(0);
      expect(r7.status, r7.stdout).toBe(0);
      const f5 = files(out5).sort();
      expect(files(out7).sort()).toEqual(f5);
      expect(f5.length).toBeGreaterThan(0);
      for (const f of f5) expect(readFileSync(path.join(out7, f), "utf8"), f).toBe(readFileSync(path.join(out5, f), "utf8"));
    });
  }
}, 120_000);

describe("codegen still runs on the 5.x API (E9)", () => {
  const tools = path.join(ROOT, "packages/mcp-server-plugin/src/server/generated/tools.ts");
  const verbs = path.join(ROOT, "packages/bus-client/src/generated/verbs.ts");
  it("both generators exit 0; the mcp tool table is byte-identical to the committed file", () => {
    const savedTools = readFileSync(tools, "utf8");
    const savedVerbs = readFileSync(verbs, "utf8");
    try {
      const v = spawnSync("npx", ["tsx", "src/codegen/generate-verbs.ts"], { cwd: path.join(ROOT, "packages/bus-client"), encoding: "utf8" });
      expect(v.status, v.stderr).toBe(0);
      const t = spawnSync("npx", ["tsx", "codegen/generate-tools.ts"], { cwd: path.join(ROOT, "packages/mcp-server-plugin"), encoding: "utf8" });
      expect(t.status, t.stderr).toBe(0);
      expect(readFileSync(tools, "utf8")).toBe(savedTools);
    } finally {
      writeFileSync(tools, savedTools);
      writeFileSync(verbs, savedVerbs);
    }
  }, 120_000);
});

describe("docs and skills name the wrapper (E11)", () => {
  it("every `tsc --noEmit` mention in docs/ and .pi/skills/ is the wrapper", () => {
    const r = spawnSync(
      "git",
      ["grep", "-nE", "(npx )?tsc --noEmit", "--", "docs", ".pi/skills", ":!docs/qa/archived-*", ":!*.AGENTS.md"],
      { cwd: ROOT, encoding: "utf8" },
    );
    // A mention is fine only when it is the wrapper invocation itself.
    const bad = r.stdout
      .split("\n")
      .filter(Boolean)
      .filter((l) => /(npx )?tsc --noEmit/.test(l.replace(/scripts\/tsc7\.mjs --noEmit/g, "")));
    expect(bad).toEqual([]);
  });
});

describe("team-app does not regress on TS 7 (X4)", () => {
  it("≤ 8 errors, only TS18049 / TS2339 / TS2345", () => {
    const r = run(ROOT, ["--noEmit", "-p", "packages/team-app"]);
    const codes = [...r.stdout.matchAll(/error (TS\d+)/g)].map((m) => m[1]);
    expect(codes.length).toBeLessThanOrEqual(8);
    for (const c of codes) expect(["TS18049", "TS2339", "TS2345"]).toContain(c);
  }, 120_000);
});
