/**
 * guard.mjs check-dest / sweep / bad input (test-plan E1-E10, E20, X1, X2).
 * Every case runs in a throwaway temp repo laid out like this one, never the real repo.
 * See change: add-reverse-spec-for-rebuild.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guard } from "./files";

let repo: string;

/** A refusal is exit 1 plus a message naming the protected root. */
function expectRefused(r: { code: number | null; stderr: string }, root: string) {
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(new RegExp(`protected root ${root.replace(".", "\\.")}/`));
}

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.name === ".git") continue;
      const r = rel ? `${rel}/${n.name}` : n.name;
      out.push(r);
      if (n.isDirectory()) walk(join(d, n.name), r);
    }
  };
  walk(dir, "");
  return out.sort();
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rsfr-guard-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const d of ["openspec/specs", "docs", "packages", ".pi"]) mkdirSync(join(repo, d), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-dest refuses protected roots", () => {
  it("E1: non-existent leaf under openspec/", () => {
    const r = guard(repo, "check-dest", "openspec/x");
    expectRefused(r, "openspec");
  });

  it("E2: `..` normalisation into docs/", () => {
    const r = guard(repo, "check-dest", "./a/../docs/x");
    expectRefused(r, "docs");
  });

  it("E3: symlink resolving into packages/", () => {
    mkdirSync(join(repo, "tmp"));
    symlinkSync(join(repo, "packages"), join(repo, "tmp", "link"));
    const r = guard(repo, "check-dest", "tmp/link/out");
    expectRefused(r, "packages");
  });

  it("E4: deep non-existent path under .pi/", () => {
    const r = guard(repo, "check-dest", ".pi/new/deep/dir");
    expectRefused(r, ".pi");
    expect(existsSync(join(repo, ".pi", "new"))).toBe(false);
  });

  it("E5: the protected root itself", () => {
    expectRefused(guard(repo, "check-dest", "openspec"), "openspec");
  });
});

describe("check-dest allows everything else", () => {
  it("E6: sibling prefix openspec-extra/ is a segment mismatch", () => {
    expect(guard(repo, "check-dest", "openspec-extra/x").code).toBe(0);
  });

  it("E7: scratch promotion target", () => {
    const r = guard(repo, "check-dest", ".reverse-spec-scratch/promoted/x");
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("E8: outside the repository", () => {
    const outside = mkdtempSync(join(tmpdir(), "rsfr-out-"));
    try {
      expect(guard(repo, "check-dest", join(outside, "rsfr-out")).code).toBe(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("E20: --protect replaces the default roots", () => {
    expect(guard(repo, "check-dest", "docs/x", "--protect", "build").code).toBe(0);
    expectRefused(guard(repo, "check-dest", "build/x", "--protect", "build"), "build");
  });
});

describe("sweep", () => {
  /** Make a dir look like an interrupted run's leftover (older than the stale threshold). */
  function stale(dir: string) {
    const t = new Date(Date.now() - 3600_000);
    utimesSync(dir, t, t);
  }

  it("E9: removes only this skill's stale _rsfr-val- ids", () => {
    const specs = join(repo, "openspec", "specs");
    for (const d of ["_rsfr-val-a", "_rsfr-val-b", "_rsfc-val-x", "real-cap"]) {
      mkdirSync(join(specs, d));
      stale(join(specs, d));
    }
    expect(guard(repo, "sweep").code).toBe(0);
    expect(readdirSync(specs).sort()).toEqual(["_rsfc-val-x", "real-cap"]);
  });

  it("B4: a fresh id of another active run survives a plain sweep", () => {
    const specs = join(repo, "openspec", "specs");
    mkdirSync(join(specs, "_rsfr-val-run2-cap"));
    expect(guard(repo, "sweep").code).toBe(0);
    expect(readdirSync(specs)).toContain("_rsfr-val-run2-cap");
  });

  it("B4: sweep --run removes that run's ids even when fresh, and only those", () => {
    const specs = join(repo, "openspec", "specs");
    for (const d of ["_rsfr-val-run1-a", "_rsfr-val-run1-b", "_rsfr-val-run2-a"]) mkdirSync(join(specs, d));
    expect(guard(repo, "sweep", "--run", "run1").code).toBe(0);
    expect(readdirSync(specs).sort()).toEqual(["_rsfr-val-run2-a"]);
  });

  it("B4: sweep --run without an id is bad input", () => {
    const r = guard(repo, "sweep", "--run");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage/i);
  });

  it("E10: no openspec/specs/ is a no-op", () => {
    rmSync(join(repo, "openspec"), { recursive: true });
    expect(guard(repo, "sweep").code).toBe(0);
    expect(existsSync(join(repo, "openspec"))).toBe(false);
  });
});

describe("bad input", () => {
  it("X1: check-dest without a path, or an empty path", () => {
    const before = snapshot(repo);
    for (const args of [["check-dest"], ["check-dest", ""]]) {
      const r = guard(repo, ...args);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/usage/i);
    }
    expect(snapshot(repo)).toEqual(before);
  });

  it("X2: unknown subcommand", () => {
    const r = guard(repo, "frobnicate");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage/i);
  });
});
