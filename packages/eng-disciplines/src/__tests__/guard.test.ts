/**
 * guard.mjs check-dest / sweep / bad input (test-plan E1-E10, E20, X1, X2).
 * Every case runs in a throwaway temp repo laid out like this one, never the real repo.
 * See change: add-reverse-spec-for-rebuild.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guard, SKILL as SKILL_DIR } from "./files";

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

  it("B1(r3): symlink followed by `..` is resolved in traversal order", () => {
    mkdirSync(join(repo, "packages", "sub"));
    mkdirSync(join(repo, "tmp"));
    symlinkSync(join(repo, "packages", "sub"), join(repo, "tmp", "link"));
    // the kernel walks tmp/link -> packages/sub, then `..` -> packages
    expectRefused(guard(repo, "check-dest", "tmp/link/../out"), "packages");
  });

  it("B1(r3): dangling symlink into a protected root is refused", () => {
    mkdirSync(join(repo, "tmp"));
    symlinkSync(join(repo, "docs", "missing"), join(repo, "tmp", "dangling"));
    expectRefused(guard(repo, "check-dest", "tmp/dangling/x"), "docs");
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

  it("B3(r4): a --protect root given through a symlink and `..` is resolved in kernel order", () => {
    mkdirSync(join(repo, "packages", "sub"));
    mkdirSync(join(repo, "tmp"));
    symlinkSync(join(repo, "packages", "sub"), join(repo, "tmp", "link"));
    // tmp/link/../out walks to packages/out
    expectRefused(guard(repo, "check-dest", "packages/out/x", "--protect", "tmp/link/../out"), "tmp/link/../out");
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

  it("B4: an old dir whose owner process is alive survives a plain sweep", () => {
    const specs = join(repo, "openspec", "specs");
    const d = join(specs, "_rsfr-val-slow-cap");
    mkdirSync(d);
    writeFileSync(join(d, ".owner"), `${process.pid}\n`);
    stale(d);
    expect(guard(repo, "sweep").code).toBe(0);
    expect(readdirSync(specs)).toContain("_rsfr-val-slow-cap");
  });

  it("B4: a fresh dir whose owner process is gone is swept at once", () => {
    const specs = join(repo, "openspec", "specs");
    const d = join(specs, "_rsfr-val-dead-cap");
    mkdirSync(d);
    const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(join(d, ".owner"), `${dead}\n`);
    expect(guard(repo, "sweep").code).toBe(0);
    expect(readdirSync(specs)).not.toContain("_rsfr-val-dead-cap");
  });

  it("B4: new-run prints distinct, collision-resistant run ids", () => {
    const ids = Array.from({ length: 5 }, () => guard(repo, "new-run").stdout.trim());
    for (const id of ids) expect(id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(new Set(ids).size).toBe(ids.length);
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

describe("check-cap", () => {
  it.each(["order-pricing", "a", "cap2", "http-api-v2"])("accepts kebab-case %s", (cap) => {
    expect(guard(repo, "check-cap", cap).code).toBe(0);
  });

  it.each(["../x", "a/b", "..", ".", "", "Cap", "a_b", "-a", "a-", "a--b", "a b", "a\\b"])("rejects %j", (cap) => {
    const r = guard(repo, "check-cap", cap);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/capability/i);
  });
});

describe("capability length (B1 r8)", () => {
  it("accepts 60 chars and the longest validation dir is creatable", () => {
    const cap = `a${"-b".repeat(29)}c`.slice(0, 60);
    expect(cap.length).toBe(60);
    expect(guard(repo, "check-cap", cap).code).toBe(0);
    const run = guard(repo, "new-run").stdout.trim();
    mkdirSync(join(repo, "openspec", "specs", `_rsfr-val-${run}-${cap}`));
  });

  it("rejects 61 chars in check-cap and check-manifest", () => {
    const cap = "a".repeat(61);
    expect(guard(repo, "check-cap", cap).code).toBe(2);
    const p = join(repo, "m.json");
    writeFileSync(p, JSON.stringify({ capabilities: [{ capability: cap }] }));
    expect(guard(repo, "check-manifest", p).code).toBe(2);
  });
});

describe("check-run", () => {
  it.each(["20261003T052255Z-a93a5a57", "r1"])("accepts %s", (id) => {
    expect(guard(repo, "check-run", id).code).toBe(0);
  });

  it.each(["", "a/b", "..", "a/../x", "-a", "a b"])("rejects %j", (id) => {
    expect(guard(repo, "check-run", id).code).toBe(2);
  });
});

describe("slug", () => {
  const slug = (cwd: string, t: string) => guard(cwd, "slug", t);

  it("is `root` for the repository root, however it is spelled", () => {
    expect(slug(repo, ".").stdout.trim()).toBe("root");
    mkdirSync(join(repo, "a"));
    expect(slug(join(repo, "a"), "..").stdout.trim()).toBe("root");
  });

  it("refuses a target outside the repository (e.g. `..` from the root)", () => {
    const r = slug(repo, "..");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
  });

  it("is a single safe path component and distinguishes colliding spellings", () => {
    for (const d of ["a/b", "a-b", "a--b", "A B"]) mkdirSync(join(repo, d), { recursive: true });
    const out = ["a/b", "a-b", "a--b", "A B", "./a/../a/b"].map((t) => slug(repo, t).stdout.trim());
    for (const o of out) expect(o).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(new Set(out.slice(0, 4)).size).toBe(4);
    expect(out[4]).toBe(out[0]); // same directory, same slug
  });
});

describe("slug length (B1 r7)", () => {
  it("stays a short, creatable path component for a very deep target", () => {
    const deep = join("a".repeat(200), "b".repeat(200));
    mkdirSync(join(repo, deep), { recursive: true });
    const out = guard(repo, "slug", deep).stdout.trim();
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    mkdirSync(join(repo, ".reverse-spec-scratch", out, "rebuild"), { recursive: true });
  });
});

describe("lock (B2 r7)", () => {
  const lockFile = (slug: string) => join(repo, ".reverse-spec-scratch", `${slug}.lock`);

  it("one run per target: a second live run is refused, the owner may re-lock", () => {
    expect(guard(repo, "lock", "root", "run1").code).toBe(0);
    expect(guard(repo, "lock", "root", "run1").code).toBe(0);
    const r = guard(repo, "lock", "root", "run2");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("run1");
    expect(guard(repo, "lock", "other", "run2").code).toBe(0);
  });

  it("unlock removes only the owner's lock", () => {
    guard(repo, "lock", "root", "run1");
    expect(guard(repo, "unlock", "root", "run2").code).toBe(1);
    expect(existsSync(lockFile("root"))).toBe(true);
    expect(guard(repo, "unlock", "root", "run1").code).toBe(0);
    expect(existsSync(lockFile("root"))).toBe(false);
  });

  it("an old lock never expires: the next run is refused until a human breaks it", () => {
    guard(repo, "lock", "root", "run1");
    const t = new Date(Date.now() - 30 * 24 * 3600_000);
    utimesSync(lockFile("root"), t, t);
    const r = guard(repo, "lock", "root", "run2");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("break-lock root run1");
  });

  it("break-lock removes the lock only for the named owner, then acquisition is exclusive", () => {
    guard(repo, "lock", "root", "run1");
    expect(guard(repo, "break-lock", "root", "run9").code).toBe(1);
    expect(existsSync(lockFile("root"))).toBe(true);
    expect(guard(repo, "break-lock", "root", "run1").code).toBe(0);
    expect(existsSync(lockFile("root"))).toBe(false);
    expect(guard(repo, "lock", "root", "run2").code).toBe(0);
  });

  it("concurrent acquisitions: exactly one run wins", async () => {
    const { spawn } = await import("node:child_process");
    const GUARD = join(SKILL_DIR, "scripts", "guard.mjs");
    const codes = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        new Promise<number | null>((done) => {
          spawn(process.execPath, [GUARD, "lock", "root", `run${i}`], { cwd: repo }).on("exit", (c) => done(c));
        }),
      ),
    );
    expect(codes.filter((c) => c === 0)).toHaveLength(1);
    expect(codes.filter((c) => c === 1)).toHaveLength(5);
  });

  it("racing breakers cannot erase a successor's lock (B1 r9)", async () => {
    const { spawn } = await import("node:child_process");
    const GUARD = join(SKILL_DIR, "scripts", "guard.mjs");
    const run = (args: string[], env: Record<string, string> = {}) =>
      new Promise<number | null>((done) => {
        spawn(process.execPath, [GUARD, ...args], { cwd: repo, env: { ...process.env, ...env } }).on("exit", (c) =>
          done(c),
        );
      });
    guard(repo, "lock", "root", "run1");
    // two breakers both observe run1, then pause between owner check and removal
    // breaker 1 removes after ~200 ms, breaker 2 only after ~1500 ms
    const breakers = [
      run(["break-lock", "root", "run1"], { RSFR_GUARD_TEST_DELAY_MS: "200" }),
      run(["break-lock", "root", "run1"], { RSFR_GUARD_TEST_DELAY_MS: "1500" }),
    ];
    await new Promise((r) => setTimeout(r, 800)); // breaker 1 is done; breaker 2 still waits
    const first = await run(["lock", "root", "runA"]); // a successor acquires it
    await Promise.all(breakers);
    const second = await run(["lock", "root", "runB"]); // must still be refused
    const owner = existsSync(lockFile("root")) ? readFileSync(lockFile("root"), "utf8").trim() : "";
    expect([first, second, owner]).toEqual([0, 1, "runA"]);
  });

  it("rejects unsafe slug or run id", () => {
    expect(guard(repo, "lock", "../x", "run1").code).toBe(2);
    expect(guard(repo, "lock", "root", "a/b").code).toBe(2);
    expect(guard(repo, "lock", "root").code).toBe(2);
  });
});

describe("check-manifest", () => {
  const write = (caps: string[]) => {
    const p = join(repo, "manifest.json");
    writeFileSync(p, JSON.stringify({ capabilities: caps.map((capability) => ({ capability, files: [] })) }));
    return p;
  };

  it("accepts unique kebab-case names", () => {
    expect(guard(repo, "check-manifest", write(["orders", "order-pricing"])).code).toBe(0);
  });

  it("rejects duplicate names (parallel generators would share outputs)", () => {
    const r = guard(repo, "check-manifest", write(["orders", "pricing", "orders"]));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/duplicate.*orders/i);
  });

  it("rejects unsafe names and an empty or malformed manifest", () => {
    expect(guard(repo, "check-manifest", write(["x/../../victim"])).code).toBe(2);
    expect(guard(repo, "check-manifest", write([])).code).toBe(2);
    writeFileSync(join(repo, "bad.json"), "{");
    expect(guard(repo, "check-manifest", join(repo, "bad.json")).code).toBe(2);
    expect(guard(repo, "check-manifest").code).toBe(2);
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
