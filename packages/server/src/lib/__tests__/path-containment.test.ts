/**
 * Unit tests for the shared path-containment helper.
 *
 * Exercised over the REAL nine fixture states from
 * `test-support/git-fixtures.ts`: containment is a boundary over real git
 * layouts — a submodule's git dir lives inside its superproject, a worktree's
 * main checkout sits beside it, `--separate-git-dir` puts the git dir in an
 * unrelated directory — and none of that is reproducible by reasoning about
 * path strings.
 *
 * Covers test-plan E12–E22, E30, P2, X1, X2, X6, X7.
 * See change: widen-containment-to-resolved-checkout.
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitMod from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import {
  buildGitFixtures,
  fixtureGit,
  type GitFixtures,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-fixtures.js";
import {
  cleanupGitShims,
  makeGitShim,
  useGitPath,
} from "@blackbelt-technology/pi-dashboard-shared/test-support/git-shim.js";
import { checkoutAnchors, isAllowed, within } from "../path-containment.js";

// Spy on the resolver/binding seams so "git was never spawned" is assertable.
// `importOriginal` keeps the real implementations in place. `vi.mock` is
// hoisted above the imports, so `path-containment.ts` gets this same mock.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git.js")>();
  return {
    ...actual,
    checkoutRootsAsync: vi.fn(actual.checkoutRootsAsync),
    isBoundCheckoutAsync: vi.fn(actual.isBoundCheckoutAsync),
  };
});

const isWin = process.platform === "win32";

let fx: GitFixtures;

beforeAll(() => {
  fx = buildGitFixtures();
});

afterAll(() => {
  fx.cleanup();
  cleanupGitShims();
});

beforeEach(() => {
  vi.mocked(gitMod.checkoutRootsAsync).mockClear();
  vi.mocked(gitMod.isBoundCheckoutAsync).mockClear();
});

/** Create (if needed) and return a subdirectory of `base`. */
function subdir(base: string, ...segs: string[]): string {
  const dir = path.join(base, ...segs);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A throwaway ordinary checkout under the fixture root. */
function cloneFixture(name: string): string {
  const dir = path.join(fx.root, name);
  fixtureGit(fx.root, ["clone", "-q", fx.normal, dir]);
  return dir;
}

describe("within", () => {
  it("matches equality and subtree, rejects siblings", () => {
    expect(within("/a/b", "/a/b")).toBe(true);
    expect(within(`/a/b${path.sep}c`, "/a/b")).toBe(true);
    expect(within("/a/bc", "/a/b")).toBe(false); // prefix but not subtree
    expect(within("/a", "/a/b")).toBe(false); // ancestor
  });

  it("matches a child once both sides are path.resolve-normalized (G2)", () => {
    // gitRoot's replacement normalizes via the shared resolver; emulate the same
    // on both sides so a mixed-separator checkout root compares equal to a
    // native-separator resolved path.
    const root = path.resolve("/repo/.git/..");
    const child = path.resolve(root, "node_modules/vitest/package.json");
    expect(within(child, root)).toBe(true);
  });

  it.skipIf(!isWin)("E30: a drive-letter / separator difference does not defeat the compare", () => {
    // Windows only: on POSIX, `path.relative` cannot parse drive letters, and
    // the production compare is native by construction.
    expect(within("C:\\repo\\x", "C:\\repo")).toBe(true);
    expect(within("C:/repo/x", "C:/repo")).toBe(true);
    expect(within("c:\\repo\\x", "C:\\repo")).toBe(true);
    expect(within("C:\\other\\x", "C:\\repo")).toBe(false);
  });
});

describe("isAllowed — layer ① (cwd fast path)", () => {
  it("E12: an in-cwd path is allowed and git is never spawned", async () => {
    const resolved = path.join(fx.normalSubdir, "in-cwd.txt");
    expect(await isAllowed(resolved, { anchors: [fx.normalSubdir] })).toBe(true);
    expect(vi.mocked(gitMod.checkoutRootsAsync)).not.toHaveBeenCalled();
  });

  it("P2: 100 in-cwd reads spawn git zero times", async () => {
    for (let i = 0; i < 100; i++) {
      expect(await isAllowed(path.join(fx.normal, `f${i}.txt`), { anchors: [fx.normal] })).toBe(true);
    }
    expect(vi.mocked(gitMod.checkoutRootsAsync)).not.toHaveBeenCalled();
  });
});

describe("isAllowed — layer ② widens to the anchor's OWN checkout", () => {
  it("E13: a subdir cwd reaches its own checkout root, for every widening state", async () => {
    const cases: Array<[string, string]> = [
      ["normal", fx.normal],
      ["submodule", fx.submodule],
      ["bareWorktree", fx.bareWorktree],
      ["separateGitDir", fx.separateGitDir],
      ["dotGitNamedCheckout", fx.dotGitNamedCheckout],
    ];
    for (const [name, checkout] of cases) {
      const cwd = subdir(checkout, "deep", "dir");
      expect(await isAllowed(path.join(checkout, "README.md"), { anchors: [cwd] }), name).toBe(true);
    }
  });

  it("E14: a worktree subdir reaches the MAIN checkout (hoisted node_modules)", async () => {
    const cwd = subdir(fx.worktree, "packages", "app");
    expect(await isAllowed(path.join(fx.normal, "node_modules", "x", "package.json"), { anchors: [cwd] })).toBe(
      true,
    );
  });
});

describe("isAllowed — layer ② never reaches outside the repository's own checkouts", () => {
  it("E15: a submodule reaches its own checkout, never the superproject", async () => {
    const cwd = subdir(fx.submodule, "deep");
    expect(await isAllowed(path.join(fx.submodule, "README.md"), { anchors: [cwd] })).toBe(true);
    expect(await isAllowed(path.join(fx.superproject, ".env"), { anchors: [cwd] })).toBe(false);
  });

  it("E16: a worktree of a submodule reaches the submodule, not the modules dir", async () => {
    const cwd = subdir(fx.submoduleWorktree, "deep");
    expect(await isAllowed(path.join(fx.superproject, "models", "sub", "README.md"), { anchors: [cwd] })).toBe(
      true,
    );
    expect(
      await isAllowed(path.join(fx.superproject, ".git", "modules", "models", "x"), { anchors: [cwd] }),
    ).toBe(false);
  });

  it("E17: a --separate-git-dir session never reaches the directory holding its git dir", async () => {
    const cwd = subdir(fx.separateGitDir, "deep");
    expect(await isAllowed(path.join(fx.separateGitDir, "README.md"), { anchors: [cwd] })).toBe(true);
    expect(await isAllowed(path.join(fx.separateGitDirGitDir, "x"), { anchors: [cwd] })).toBe(false);
  });

  it("E18: a worktree of a bare hub never reaches the hub's parent", async () => {
    const cwd = subdir(fx.bareWorktree, "deep");
    expect(await isAllowed(path.join(fx.bareWorktree, "seed.txt"), { anchors: [cwd] })).toBe(true);
    expect(await isAllowed(path.join(fx.root, "hubs-x"), { anchors: [cwd] })).toBe(false);
  });

  it("E19: a bare cwd is cwd-only", async () => {
    expect(await isAllowed(path.join(fx.root, "x"), { anchors: [fx.bare] })).toBe(false);
  });

  it("E21: a path outside every anchor is rejected", async () => {
    expect(await isAllowed(isWin ? "C:\\Windows\\win.ini" : "/etc/passwd", { anchors: [fx.normal] })).toBe(false);
  });
});

describe("isAllowed — an UNBOUND core.worktree does not widen", () => {
  it("E20: a core.worktree aimed at an unrelated checkout is dropped", async () => {
    const repo = cloneFixture("e20-repo");
    const unrelated = cloneFixture("e20-other");
    const wt = path.join(fx.root, "e20-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e20", wt]);
    fixtureGit(repo, ["config", "--local", "core.worktree", unrelated]);
    const cwd = subdir(wt, "deep");

    expect(await isAllowed(path.join(unrelated, "seed.txt"), { anchors: [cwd] })).toBe(false);
    // Control: the worktree itself stays reachable…
    expect(await isAllowed(path.join(wt, "seed.txt"), { anchors: [cwd] })).toBe(true);
    // …while the main checkout is DROPPED with the unbound value that replaced
    // it: the failure mode is narrowing, never over-reach.
    expect(await isAllowed(path.join(repo, "seed.txt"), { anchors: [cwd] })).toBe(false);
  });

  it.skipIf(isWin)("E20b: a core.worktree of `/` is dropped, so /etc/passwd stays rejected", async () => {
    const repo = cloneFixture("e20b-repo");
    const wt = path.join(fx.root, "e20b-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "e20b", wt]);
    fixtureGit(repo, ["config", "--local", "core.worktree", "/"]);
    const cwd = subdir(wt, "deep");

    expect(await isAllowed("/etc/passwd", { anchors: [cwd] })).toBe(false);
    expect(await isAllowed(path.join(wt, "seed.txt"), { anchors: [cwd] })).toBe(true);
    expect(await isAllowed(path.join(repo, "seed.txt"), { anchors: [cwd] })).toBe(false);
  });
});

describe("checkoutAnchors", () => {
  it("E22: a non-worktree state is deduplicated and bound ONCE", async () => {
    const anchors = await checkoutAnchors(fx.normal);
    expect(anchors).toEqual([fx.normal]);
    expect(vi.mocked(gitMod.isBoundCheckoutAsync)).toHaveBeenCalledTimes(1);
  });

  it("E22b: a linked worktree yields both roots, each bound once", async () => {
    expect((await checkoutAnchors(fx.worktree)).slice().sort()).toEqual([fx.normal, fx.worktree].sort());
    expect(vi.mocked(gitMod.isBoundCheckoutAsync)).toHaveBeenCalledTimes(2);
  });

  it("a non-repository anchor yields no roots", async () => {
    expect(await checkoutAnchors(fx.nonRepo)).toEqual([]);
  });
});

describe("isAllowed — degraded git fails closed", () => {
  it.skipIf(isWin)("X6: git unavailable degrades to cwd-only", async () => {
    const restore = useGitPath(null);
    try {
      expect(await isAllowed(path.join(fx.normal, "seed.txt"), { anchors: [fx.worktree] })).toBe(false);
      // Control: an in-cwd read still works with no git at all.
      expect(await isAllowed(path.join(fx.worktree, "seed.txt"), { anchors: [fx.worktree] })).toBe(true);
    } finally {
      restore();
    }
  });

  it.skipIf(isWin)("X1: a probe timeout fails closed, never to a derived path", async () => {
    const restore = useGitPath(makeGitShim("sleep 5"));
    try {
      // The 200 ms budget the test-plan names, exercised where a timeout IS
      // injectable (the containment path uses the design's 2 s per probe).
      const started = Date.now();
      expect(await gitMod.checkoutRootsAsync({ cwd: fx.worktree, timeout: 200 })).toBeNull();
      expect(Date.now() - started).toBeLessThan(1_500);
      // …and the containment path it feeds fails closed too.
      expect(await isAllowed(path.join(fx.normal, "seed.txt"), { anchors: [fx.worktree] })).toBe(false);
    } finally {
      restore();
    }
  });

  it.skipIf(isWin)("X2: the event loop stays responsive while a containment probe is pending", async () => {
    const app = Fastify({ logger: false });
    app.get("/api/health", async () => ({ ok: true }));
    await app.ready();
    const restore = useGitPath(makeGitShim("sleep 5"));
    try {
      const pending = isAllowed(path.join(fx.normal, "seed.txt"), { anchors: [fx.worktree] });
      const started = Date.now();
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(Date.now() - started).toBeLessThan(200);
      expect(health.statusCode).toBe(200);
      expect(await pending).toBe(false);
    } finally {
      restore();
      await app.close();
    }
  });

  it.skipIf(isWin)("X7: a symlink escaping every bound root is rejected on real paths", async () => {
    const repo = cloneFixture("x7-repo");
    const outside = subdir(fx.root, "x7-outside");
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    symlinkSync(outside, path.join(repo, "esc"));
    const cwd = subdir(repo, "sub");

    expect(await isAllowed(path.join(repo, "esc", "secret.txt"), { anchors: [cwd] })).toBe(false);
    // Control: a real file in the checkout is allowed.
    expect(await isAllowed(path.join(repo, "seed.txt"), { anchors: [cwd] })).toBe(true);
  });
});
