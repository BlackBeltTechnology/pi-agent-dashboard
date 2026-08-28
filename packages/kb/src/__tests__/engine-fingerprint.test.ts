// Tests for the engine fingerprint lib (bin/lib/engine-fingerprint.mjs) and the
// bin shim branch table (bin/kb.mjs). Folded from
// openspec/changes/fix-kb-eval-measurement-integrity/test-plan.md
// (E12 determinism/normalization, E13 shim decision table).
// Exemplar: packages/kb/src/__tests__/kb.test.ts (sandbox dirs via fs fixtures).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Plain-JS lib, deliberately untyped (zero-dep, shipped as-is).
// @ts-expect-error .mjs lib without type declarations
import { computeDistHash, computeSrcHash, computeTsconfigHash } from "../../bin/lib/engine-fingerprint.mjs";

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const LIB = join(PKG, "bin", "lib", "engine-fingerprint.mjs");
const BIN = join(PKG, "bin", "kb.mjs");

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kb-fp-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A minimal package sandbox. `tsconfig` toggles the dev-checkout shape. */
function makePkg(name: string, opts: { tsconfig?: boolean } = {}): string {
  const pkg = join(root, name);
  mkdirSync(join(pkg, "src"), { recursive: true });
  mkdirSync(join(pkg, "dist"), { recursive: true });
  mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "hello";\n');
  writeFileSync(join(pkg, "dist", "cli.js"), 'console.log("DIST_STUB_OK");\n');
  cpSync(join(PKG, "bin", "kb.mjs"), join(pkg, "bin", "kb.mjs"));
  cpSync(join(PKG, "bin", "lib"), join(pkg, "bin", "lib"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "fake-kb", version: "0.0.0" })); // no "type": CJS fake tsc can require()
  if (opts.tsconfig) {
    writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, outDir: "dist" }, include: ["src/**/*.ts"] }));
  }
  return pkg;
}

function writeFp(pkg: string) {
  const r = spawnSync(process.execPath, [LIB, "--write", pkg], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`fingerprint write failed: ${r.stderr}`);
}

const runBin = (pkg: string) => spawnSync(process.execPath, [join(pkg, "bin", "kb.mjs")], { cwd: pkg, encoding: "utf8" });

describe("engine fingerprint (E12 determinism + normalization)", () => {
  it("same tree hashed twice → identical; CRLF vs LF → identical; write order → identical", () => {
    const pkg = makePkg("e12");
    const a = computeSrcHash(pkg);
    const b = computeSrcHash(pkg);
    expect(b).toBe(a);
    writeFileSync(join(pkg, "src", "crlf.ts"), "export const x = 1;\r\nexport const y = 2;\r\n");
    const crlf = computeSrcHash(pkg);
    writeFileSync(join(pkg, "src", "crlf.ts"), "export const x = 1;\nexport const y = 2;\n");
    expect(computeSrcHash(pkg)).toBe(crlf);
    // Reorder: same files, rewritten in reverse order → unchanged hash.
    const files = ["a.ts", "b.ts", "c.ts"].map((f) => join(pkg, "src", f));
    files.forEach((f) => writeFileSync(f, `export const ${f} = 1;\n`));
    const ordered = computeSrcHash(pkg);
    files.reverse().forEach((f) => writeFileSync(f, readFileSync(f, "utf8")));
    expect(computeSrcHash(pkg)).toBe(ordered);
  });

  it("edited src → different srcHash; edited tsconfig (incl. extends base) → different tsconfigHash; dist changes → different distHash", () => {
    const pkg = makePkg("e12b", { tsconfig: true });
    const s0 = computeSrcHash(pkg);
    const t0 = computeTsconfigHash(pkg);
    const d0 = computeDistHash(pkg);
    writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "changed";\n');
    expect(computeSrcHash(pkg)).not.toBe(s0);
    writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false, outDir: "dist" }, include: ["src/**/*.ts"] }));
    expect(computeTsconfigHash(pkg)).not.toBe(t0);
    writeFileSync(join(pkg, "dist", "cli.js"), 'console.log("other");\n');
    expect(computeDistHash(pkg)).not.toBe(d0);
  });

  it("no tsconfig → tsconfigHash null; no dist → distHash null", () => {
    const pkg = makePkg("e12c");
    expect(computeTsconfigHash(pkg)).toBe(null);
    rmSync(join(pkg, "dist"), { recursive: true, force: true });
    expect(computeDistHash(pkg)).toBe(null);
  });
});

describe("bin shim branch table (E13)", () => {
  it("(a) all hashes match → imports dist, exit 0, silent", () => {
    const pkg = makePkg("e13a"); // no tsconfig = installed shape
    writeFp(pkg);
    const r = runBin(pkg);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("DIST_STUB_OK\n"); // shim itself is silent
    expect(r.stderr).toBe("");
  });

  it("(b) srcHash mismatch + tsconfig resolvable → rebuilds (dist mtime advances, fingerprint refreshed), exit 0", () => {
    const pkg = makePkg("e13b", { tsconfig: true });
    // Fake typescript install: "rebuilds" by writing a NEW dist/cli.js stub.
    const tscDir = join(pkg, "node_modules", "typescript", "lib");
    mkdirSync(tscDir, { recursive: true });
    writeFileSync(
      join(tscDir, "tsc.js"),
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const i = process.argv.indexOf('-p');",
        "const pkg = path.dirname(process.argv[i + 1]);",
        "fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'console.log(\"REBUILT_OK\");\\n');",
      ].join("\n"),
    );
    writeFp(pkg);
    writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "stale now";\n'); // src drifts after the committed build
    const before = statSync(join(pkg, "dist", "cli.js")).mtimeMs;
    const r = runBin(pkg);
    expect(r.status).toBe(0);
    expect(statSync(join(pkg, "dist", "cli.js")).mtimeMs).toBeGreaterThan(before);
    expect(r.stdout).toContain("REBUILT_OK");
    // The rebuild refreshes the committed fingerprint (self-healing).
    const fp = JSON.parse(readFileSync(join(pkg, "engine-fingerprint.json"), "utf8"));
    expect(fp.srcHash).toBe(computeSrcHash(pkg));
  });

  it("(c) mismatch without tsconfig → stderr warning, imports the stale dist, exit 0", () => {
    const pkg = makePkg("e13c");
    writeFp(pkg);
    writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "tampered";\n');
    const r = runBin(pkg);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("DIST_STUB_OK\n");
    expect(r.stderr).toContain("WARNING");
    expect(r.stderr).toContain("different engines");
  });

  it("(d) dist/cli.js missing without tsconfig → non-zero exit naming the divergence", () => {
    const pkg = makePkg("e13d");
    writeFp(pkg);
    rmSync(join(pkg, "dist"), { recursive: true, force: true });
    const r = runBin(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("different engines");
    expect(r.stderr).toContain("dist/cli.js");
    // Fingerprint entirely missing + dist missing → same hard error.
    rmSync(join(pkg, "engine-fingerprint.json"), { force: true });
    expect(runBin(pkg).status).not.toBe(0);
  });
});
