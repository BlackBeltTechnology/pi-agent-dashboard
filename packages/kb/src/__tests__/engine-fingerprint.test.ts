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

  it("extends chain: a JSONC base (comments + trailing commas) is parsed, and mutating it changes tsconfigHash", () => {
    const pkg = makePkg("e12d", { tsconfig: true });
    writeFileSync(
      join(pkg, "tsconfig.base.json"),
      `{
      // compiler options shared by the workspace
      "strict": true, // trailing comma below is legal JSONC
      "target": "es2022",
      "x-url": "http://example.com//not-a-comment",
    }
`,
    );
    writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { outDir: "dist" } }));
    const t0 = computeTsconfigHash(pkg);
    expect(t0).not.toBe(null); // the chain must PARSE past comments + trailing comma
    writeFileSync(
      join(pkg, "tsconfig.base.json"),
      `{
      "strict": false,
      "target": "es2022",
    }
`,
    );
    expect(computeTsconfigHash(pkg)).not.toBe(t0); // a base-config change must fork the hash
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

  it("(e) malformed fingerprint fails closed — installed hard-errors, dev rebuilds, never warn-and-run", () => {
    // Installed: corrupt fingerprint must NOT degrade to the warn-and-run leg.
    const pkg = makePkg("e13e");
    writeFp(pkg);
    writeFileSync(join(pkg, "engine-fingerprint.json"), "{ not json");
    const r = runBin(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("malformed");
    expect(r.stdout).not.toContain("DIST_STUB_OK");
    // Dev: same corruption self-heals via the rebuild path (rewrites it).
    const dev = makePkg("e13e-dev", { tsconfig: true });
    const tscDir = join(dev, "node_modules", "typescript", "lib");
    mkdirSync(tscDir, { recursive: true });
    writeFileSync(join(tscDir, "tsc.js"), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const i = process.argv.indexOf('-p');",
      "const pkg = path.dirname(process.argv[i + 1]);",
      "fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'console.log(\"REBUILT_OK\");\\n');",
    ].join("\n"));
    writeFp(dev);
    writeFileSync(join(dev, "engine-fingerprint.json"), "{ not json");
    const rd = runBin(dev);
    expect(rd.status).toBe(0);
    expect(rd.stdout).toContain("REBUILT_OK");
  });

  it("(f) incomplete fingerprint (srcHash only) is treated as stale, never fresh", () => {
    const pkg = makePkg("e13f", { tsconfig: true });
    const tscDir = join(pkg, "node_modules", "typescript", "lib");
    mkdirSync(tscDir, { recursive: true });
    writeFileSync(join(tscDir, "tsc.js"), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const i = process.argv.indexOf('-p');",
      "const pkg = path.dirname(process.argv[i + 1]);",
      "fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'console.log(\"REBUILT_OK2\");\\n');",
    ].join("\n"));
    // A fingerprint carrying ONLY srcHash: tsconfigHash/distHash omitted.
    writeFileSync(join(pkg, "engine-fingerprint.json"), JSON.stringify({ srcHash: computeSrcHash(pkg) }));
    const r = runBin(pkg);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("REBUILT_OK2"); // rebuilt, not silently accepted
  });
});
