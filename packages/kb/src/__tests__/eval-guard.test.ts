// Tests for the vacuous-run guard (design D5, cli.ts eval).
// Folded from openspec/changes/fix-kb-eval-measurement-integrity/test-plan.md
// (X1 empty/all-unreachable fixtures, X2 zero recall).
// cli.ts executes main() on import, so these spawn it as a subprocess against a
// tiny indexed project — the exemplar pattern of kb.test.ts's CLI-adjacent tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PKG = join(REPO, "packages", "kb");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");

let proj: string;
let home: string;

function runEval(goldenFile: string, extra: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [TSX, "src/cli.ts", "eval", "--golden", goldenFile, "--cwd", proj, "--no-reindex", ...extra],
    { cwd: PKG, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--experimental-sqlite", HOME: home } },
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeGolden(name: string, raw: unknown): string {
  const p = join(proj, name);
  writeFileSync(p, JSON.stringify(raw));
  return p;
}

beforeAll(() => {
  proj = mkdtempSync(join(tmpdir(), "kb-guard-proj-"));
  home = mkdtempSync(join(tmpdir(), "kb-guard-home-")); // isolate from a real global KB config
  mkdirSync(join(proj, "docs"), { recursive: true });
  mkdirSync(join(proj, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(
    join(proj, ".pi", "dashboard", "knowledge_base.json"),
    JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }),
  );
  writeFileSync(
    join(proj, "docs", "auth.md"),
    "# Auth Guide\nExplains token authentication and the interceptor principal flow in enough detail to exceed the merge threshold cleanly here.\n",
  );
  // Build the index once so eval runs are pure measurements.
  const r = spawnSync(process.execPath, [TSX, "src/cli.ts", "index", "--cwd", proj], {
    cwd: PKG, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--experimental-sqlite", HOME: home },
  });
  if (r.status !== 0) throw new Error(`index failed: ${r.stderr}`);
});

afterAll(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("vacuous-run guard (X1 empty scored set)", () => {
  it("empty fixture → stderr diagnostic + stdout metrics + non-zero exit; --allow-zero exits 0", () => {
    const gf = writeGolden("empty.json", { items: [] });
    const bad = runEval(gf);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("VACUOUS RUN");
    expect(bad.stderr).toMatch(/fixture|unreachable|normalization/);
    const metrics = JSON.parse(bad.stdout); // stdout still carries the payload
    expect(metrics.n).toBe(0);
    const good = runEval(gf, ["--allow-zero"]);
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout).n).toBe(0);
  });

  it("all-unreachable fixture → non-zero with root-normalization diagnostic; --allow-zero exits 0", () => {
    const gf = writeGolden("unreachable.json", { items: [{ q: "token", expect: "tests/foo.md" }, { q: "auth", expect: "Documents/Projektek/a.md" }] });
    const bad = runEval(gf);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("VACUOUS RUN");
    expect(bad.stderr).toContain("unreachable");
    const metrics = JSON.parse(bad.stdout);
    expect(metrics.n).toBe(0);
    expect(metrics.unreachable).toBe(2);
    expect(runEval(gf, ["--allow-zero"]).status).toBe(0);
  });
});

describe("vacuous-run guard (X2 zero recall)", () => {
  it("zero-hit store with n>0 → non-zero; --allow-zero → exit 0 with Recall@K: 0", () => {
    const gf = writeGolden("zero-recall.json", { items: [{ q: "zzqq unfindable widget", expect: "no-such-path.md" }] });
    const bad = runEval(gf);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("VACUOUS RUN");
    expect(bad.stderr).toContain("recall is 0");
    const metrics = JSON.parse(bad.stdout);
    expect(metrics.n).toBe(1);
    expect(metrics["Recall@K"]).toBe(0);
    const good = runEval(gf, ["--allow-zero"]);
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout)["Recall@K"]).toBe(0);
  });
});
