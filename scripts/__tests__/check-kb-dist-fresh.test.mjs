// C1 (test-plan #C1, ci level — fix-kb-eval-measurement-integrity): stale dist
// fingerprint is rejected. Fault-injection: a sandbox checkout whose src is
// edited after the committed build must exit non-zero printing the mandated
// message; a clean sandbox exits 0. The script checks commit discipline, which
// is the only form the defect can take in CI (dist/ is gitignored, so a CI
// build is fresh by construction).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(REPO, "scripts", "check-kb-dist-fresh.mjs");
const LIB = join(REPO, "packages", "kb", "bin", "lib", "engine-fingerprint.mjs");

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kb-fresh-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function sandbox(name) {
  const pkg = join(root, name);
  mkdirSync(join(pkg, "src"), { recursive: true });
  writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "hello";\n');
  writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  return pkg;
}
const writeFp = (pkg) => execFileSync(process.execPath, [LIB, "--write", pkg], { encoding: "utf8" });
const runCheck = (pkg) => spawnSync(process.execPath, [CHECK, "--pkg", pkg], { encoding: "utf8" });

describe("check-kb-dist-fresh (C1)", () => {
  it("clean checkout (fingerprint matches src + tsconfig) → exit 0", () => {
    const pkg = sandbox("clean");
    writeFp(pkg);
    const r = runCheck(pkg);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("fingerprint matches");
  });

  it("src edited after the committed build → non-zero with the mandated message", () => {
    const pkg = sandbox("stale-src");
    writeFp(pkg);
    writeFileSync(join(pkg, "src", "hello.ts"), 'export const hi = "edited after build";\n');
    const r = runCheck(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("the `kb` bin and the extension would run different engines — rebuild and commit the fingerprint");
  });

  it("tsconfig edited after the committed build → non-zero (emit changes without src bytes)", () => {
    const pkg = sandbox("stale-tsconfig");
    writeFp(pkg);
    writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false } }));
    expect(runCheck(pkg).status).not.toBe(0);
  });

  it("missing fingerprint → non-zero with the mandated message", () => {
    const pkg = sandbox("no-fp");
    const r = runCheck(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("rebuild and commit the fingerprint");
  });

  it("malformed fingerprint → non-zero (unparseable JSON fails closed, never passes)", () => {
    const pkg = sandbox("bad-fp");
    writeFileSync(join(pkg, "engine-fingerprint.json"), "{ not json");
    const r = runCheck(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("rebuild and commit the fingerprint");
  });

  it("dist tampered after the committed build → non-zero when dist exists (leg absent in CI)", () => {
    const pkg = sandbox("stale-dist");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "dist", "cli.js"), "console.log('ok');\n");
    writeFp(pkg); // records distHash of the current dist
    writeFileSync(join(pkg, "dist", "cli.js"), "console.log('tampered');\n");
    const r = runCheck(pkg);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("dist changed after the last build");
  });
});

// change: throttle-kb-reindex (test-plan #S19, R8): the committed fingerprint must carry `rowsHash`
// (the engine value the gates compare) in addition to a matching srcHash/tsconfigHash.
describe("check-kb-dist-fresh decision table (S19)", () => {
  const MSG = "the `kb` bin and the extension would run different engines";
  const fpPath = (pkg) => join(pkg, "engine-fingerprint.json");
  const rewrite = (pkg, fn) => {
    const fp = JSON.parse(readFileSync(fpPath(pkg), "utf8"));
    fn(fp);
    writeFileSync(fpPath(pkg), JSON.stringify(fp, null, 2));
  };
  it.each([
    ["valid", () => {}, true],
    ["missing file", (pkg) => rmSync(fpPath(pkg)), false],
    ["malformed", (pkg) => writeFileSync(fpPath(pkg), "{ not json"), false],
    ["rowsHash absent", (pkg) => rewrite(pkg, (fp) => delete fp.rowsHash), false],
    ["rowsHash mismatch", (pkg) => rewrite(pkg, (fp) => (fp.rowsHash = "0".repeat(64))), false],
    ["srcHash mismatch", (pkg) => rewrite(pkg, (fp) => (fp.srcHash = "0".repeat(64))), false],
    ["tsconfigHash mismatch", (pkg) => rewrite(pkg, (fp) => (fp.tsconfigHash = "0".repeat(64))), false],
  ])("committed fingerprint: %s", (name, tamper, ok) => {
    const pkg = sandbox(`s19-${name.replace(/\W+/g, "-")}`);
    writeFp(pkg);
    tamper(pkg);
    const r = runCheck(pkg);
    if (ok) {
      expect(r.status).toBe(0);
    } else {
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(MSG);
    }
  });
});
