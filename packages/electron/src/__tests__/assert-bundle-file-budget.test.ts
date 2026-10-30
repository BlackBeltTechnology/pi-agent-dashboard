/**
 * E17–E20 (slim-windows-install-file-count, design D3): the packaged file-count
 * budget gate. Drives the CLI over temp `resources/` trees.
 *
 * Symlink case is skipped on win32 (symlink creation needs elevated rights); the
 * win32 CI legs run the gate over the real package output.
 *
 * See change: slim-windows-install-file-count.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/assert-bundle-file-budget.mjs");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** `resources/` tree: `layout` maps a relative dir to how many files it holds. */
function resources(layout: Record<string, number>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-budget-"));
  dirs.push(root);
  for (const [dir, n] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(root, dir, `f${i}`), "x");
  }
  return root;
}

function run(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, root, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("assert-bundle-file-budget", () => {
  it("E17: count equal to the budget passes and prints both numbers", () => {
    const root = resources({ a: 3, b: 2 });
    const r = run(root, ["--platform", "win32", "--arch", "x64", "--budget", "5"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\b5\b.*\b5\b/s);
    expect(r.out).toContain("budget");
  });

  it("E18: one file over the budget fails and lists exactly the 20 largest directories, descending", () => {
    const layout: Record<string, number> = {};
    for (let i = 1; i <= 25; i++) layout[`dir${String(i).padStart(2, "0")}`] = i; // 325 files
    const root = resources(layout);
    const r = run(root, ["--platform", "win32", "--arch", "x64", "--budget", "324"]);
    expect(r.code).toBe(1);
    const rows = r.out.split("\n").filter((l) => /^\s+\d+\s+\S/.test(l));
    expect(rows).toHaveLength(20);
    const counts = rows.map((l) => Number(l.trim().split(/\s+/)[0]));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBe(25);
    expect(rows[0]).toContain("dir25");
    expect(counts[19]).toBe(6);
  });

  it("E19: an unpinned platform/arch reports the count and passes with 'no budget pinned'", () => {
    const root = resources({ a: 4 });
    const r = run(root, ["--platform", "plan9", "--arch", "mips"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no budget pinned");
    expect(r.out).toMatch(/\b4\b/);
  });

  it.skipIf(process.platform === "win32")("E20: symlinks are neither counted nor followed", () => {
    const root = resources({ real: 3, big: 10 });
    fs.rmSync(path.join(root, "big"), { recursive: true, force: true });
    const target = resources({ t: 10 });
    fs.symlinkSync(path.join(target, "t"), path.join(root, "linkdir"));
    fs.symlinkSync(path.join(root, "real", "f0"), path.join(root, "linkfile"));
    const r = run(root, ["--platform", "linux", "--arch", "x64", "--budget", "3"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\b3\b/);
  });

  it("a missing resources dir exits 2 instead of passing vacuously", () => {
    const r = run(path.join(os.tmpdir(), "file-budget-no-such-dir"), ["--platform", "win32", "--arch", "x64", "--budget", "10"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("not found");
  });

  it("usage error without a resources dir exits 2", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
