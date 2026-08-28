// C1 (test-plan #C1, ci level — fix-kb-eval-measurement-integrity): stale dist
// fingerprint is rejected. Fault-injection: a sandbox checkout whose src is
// edited after the committed build must exit non-zero printing the mandated
// message; a clean sandbox exits 0. The script checks commit discipline, which
// is the only form the defect can take in CI (dist/ is gitignored, so a CI
// build is fresh by construction).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
