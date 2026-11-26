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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials, listPathDenials } from "../../access/access-denials.js";
import { __resetAccessGrants, recordGrant } from "../../access/access-grants.js";
import { decidePassive, evaluateContainment } from "../../access/containment-gate.js";
import { checkoutAnchors, isAllowed, isAllowedReal, within } from "../path-containment.js";

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

// close-local-listener-and-egress-gaps — layer ① compares REAL paths (D1).
describe("isAllowedReal — real-path layer ① (close-local-listener-and-egress-gaps)", () => {
  it("T.3 an in-anchor link (pnpm-style node_modules) is admitted with ZERO git spawns, bytes equal", async () => {
    const cwd = subdir(fx.normal, "t3");
    const real = subdir(cwd, "node_modules", ".pnpm", "a@1", "node_modules", "a");
    writeFileSync(path.join(real, "index.js"), "module.exports = 1;\n");
    symlinkSync(real, path.join(cwd, "node_modules", "a"));

    const link = path.join(cwd, "node_modules", "a", "index.js");
    const verdict = await isAllowedReal(link, { anchors: [cwd] });
    expect(verdict.allowed).toBe(true);
    expect(verdict.real).toBe(await fsp.realpath(path.join(real, "index.js")));
    expect(await fsp.readFile(verdict.real, "utf-8")).toBe("module.exports = 1;\n");
    expect(gitMod.checkoutRootsAsync).not.toHaveBeenCalled();
    expect(gitMod.isBoundCheckoutAsync).not.toHaveBeenCalled();
  });

  it.skipIf(isWin)("T.11 a worktree link into the MAIN checkout (above the worktree) is admitted via layer ②", async () => {
    const repo = cloneFixture("t11-repo");
    const wt = path.join(repo, ".worktrees", "x");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "t11", wt]);
    const target = path.join(subdir(repo, "node_modules", "vitest"), "package.json");
    writeFileSync(target, "{}\n");
    symlinkSync(target, path.join(wt, "l"));

    const verdict = await isAllowedReal(path.join(wt, "l"), { anchors: [wt] });
    expect(verdict).toEqual({ allowed: true, real: await fsp.realpath(target) });
    // Layer ① missed (the real path leaves the anchor), so git WAS consulted: that is layer ②.
    expect(gitMod.checkoutRootsAsync).toHaveBeenCalled();
    // A link from the same worktree to a file outside every bound checkout stays refused.
    const outside = path.join(subdir(fx.root, "t11-outside"), "s.txt");
    writeFileSync(outside, "s\n");
    symlinkSync(outside, path.join(wt, "l2"));
    expect((await isAllowedReal(path.join(wt, "l2"), { anchors: [wt] })).allowed).toBe(false);
  });

  it.skipIf(isWin)("T.160 with git missing an in-anchor link is admitted (layer ① needs no git); an escaping link is refused", async () => {
    const repo = cloneFixture("t160-repo");
    const wt = path.join(fx.root, "t160-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "t160", wt]);
    writeFileSync(path.join(wt, "in.txt"), "in\n");
    symlinkSync(path.join(wt, "in.txt"), path.join(wt, "inlink"));
    symlinkSync(path.join(repo, "seed.txt"), path.join(wt, "mainlink"));

    // Control (git present): the main-checkout link IS reachable through layer ②.
    expect((await isAllowedReal(path.join(wt, "mainlink"), { anchors: [wt] })).allowed).toBe(true);

    const restore = useGitPath(null);
    try {
      expect((await isAllowedReal(path.join(wt, "inlink"), { anchors: [wt] })).allowed).toBe(true);
      expect((await isAllowedReal(path.join(wt, "mainlink"), { anchors: [wt] })).allowed).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("real-path layer ① — structural budget (P1)", () => {
  it("T.138 one layer-① decision over 3 anchors spawns no git and keeps realpath calls structurally bounded", async () => {
    const cwd = subdir(fx.normal, "t138");
    writeFileSync(path.join(cwd, "f.txt"), "f\n");
    symlinkSync(path.join(cwd, "f.txt"), path.join(cwd, "inlink"));
    const pi = subdir(fx.root, "t138-home", ".pi");
    const pinned = subdir(fx.root, "t138-pinned");
    const anchors = [cwd, pi, pinned];

    const rootReal = await fsp.realpath(fx.root);
    const spy = vi.spyOn(fsp, "realpath");
    try {
      for (const name of ["f.txt", "inlink"]) {
        spy.mockClear();
        const target = path.join(cwd, name);
        expect((await isAllowedReal(target, { anchors })).allowed, name).toBe(true);
        // Only calls on the fixture tree count: the dashboard-state guard pre-check also resolves
        // pi-agent credential files under HOME, which is not part of the layer-① cost.
        const calls = spy.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith(fx.root) || p.startsWith(rootReal));
        // 1 decision realpath + ≤ 3 anchor realpaths (this hit stops at the first anchor) + the state
        // guard's own single resolution of the same path = 5 at most; never one per match × anchor.
        expect(calls.length, `${name}: ${calls.join(", ")}`).toBeLessThanOrEqual(5);
        expect(calls.filter((p) => !p.endsWith(name)).length, "anchor realpaths").toBeLessThanOrEqual(3);
        expect(gitMod.checkoutRootsAsync).not.toHaveBeenCalled();
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("empty grant store ≡ layers ①–② alone (T.39)", () => {
  it.skipIf(isWin)("T.39 decidePassive with an empty grant list decides exactly as isAllowed on a fixed corpus", async () => {
    const repo = cloneFixture("t39-repo");
    const wt = path.join(fx.root, "t39-wt");
    fixtureGit(repo, ["worktree", "add", "-q", "-b", "t39", wt]);
    const outside = subdir(fx.root, "t39-outside");
    writeFileSync(path.join(outside, "o.txt"), "o\n");
    writeFileSync(path.join(wt, "in.txt"), "i\n");
    symlinkSync(path.join(wt, "in.txt"), path.join(wt, "in-link"));
    symlinkSync(path.join(outside, "o.txt"), path.join(wt, "out-link"));
    const corpus: Array<[string, boolean]> = [
      [path.join(wt, "in.txt"), true], // in-anchor
      [path.join(wt, "in-link"), true], // symlinked, stays inside
      [path.join(repo, "seed.txt"), true], // checkout root (layer ②)
      [path.join(outside, "o.txt"), false], // outside
      [path.join(wt, "out-link"), false], // symlinked, escapes
    ];
    for (const [p, expected] of corpus) {
      const bare = await isAllowed(p, { anchors: [wt] });
      const withEmptyGrants = await decidePassive(p, [wt], { allowGrant: true, grantSubjects: [] });
      expect(bare, p).toBe(expected);
      expect(withEmptyGrants.allowed, p).toBe(bare);
      expect(withEmptyGrants.viaGrant, p).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// fix-file-link-editor-routing 3b: containment for a WRITE. `action:"write"`
// disables the checkout-root widening (layer ②) and admits only write grants.
// test-plan #S23, #S24.
// ---------------------------------------------------------------------------
describe("evaluateContainment action:'write' (S23, S24)", () => {
  let grantsDir: string;
  let prevStore: string | undefined;

  beforeEach(() => {
    grantsDir = mkdtempSync(path.join(os.tmpdir(), "pc-write-"));
    prevStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(grantsDir, "grants.json");
    __resetAccessGrants();
    __resetPathDenials();
  });

  afterEach(() => {
    if (prevStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = prevStore;
    __resetAccessGrants();
    __resetPathDenials();
    rmSync(grantsDir, { recursive: true, force: true });
  });

  const decide = async (p: string, anchors: string[], action?: "read" | "write") =>
    (await evaluateContainment(p, anchors, { site: "t", ...(action ? { action } : {}) })).allowed;

  it("S23: the matrix — location × action", async () => {
    const cwd = subdir(fx.worktree, "packages", "s23");
    const inCwd = path.join(cwd, "in.md");
    // Bound checkout roots: the worktree's own root and the MAIN checkout (layer ②).
    const checkoutFile = path.join(fx.normal, "s23-checkout.md");
    const worktreeRootFile = path.join(fx.worktree, "s23-root.md");
    const readGrantDir = subdir(fx.root, "s23-read");
    const writeGrantDir = subdir(fx.root, "s23-write");
    const noneDir = subdir(fx.root, "s23-none");
    const readFile = path.join(readGrantDir, "r.md");
    const writeFile = path.join(writeGrantDir, "w.md");
    const noneFile = path.join(noneDir, "n.md");
    for (const f of [inCwd, checkoutFile, worktreeRootFile, readFile, writeFile, noneFile]) writeFileSync(f, "x");
    recordGrant({ subject: readGrantDir });
    recordGrant({ subject: writeGrantDir, mode: "write" });

    // [location, path, readOrNone, write]
    const rows: Array<[string, string, boolean, boolean]> = [
      ["under cwd", inCwd, true, true],
      ["bound checkout root (own)", worktreeRootFile, true, false],
      ["bound checkout root (main)", checkoutFile, true, false],
      ["under a read grant", readFile, true, false],
      ["under a write grant (write ⊃ read)", writeFile, true, true],
      ["none", noneFile, false, false],
    ];
    for (const [name, p, readOk, writeOk] of rows) {
      expect(await decide(p, [cwd]), `${name} / no action`).toBe(readOk);
      expect(await decide(p, [cwd], "read"), `${name} / read`).toBe(readOk);
      expect(await decide(p, [cwd], "write"), `${name} / write`).toBe(writeOk);
    }
  });

  it("S23: a no-action evaluation is byte-identical to pre-change (decision shape and denial record)", async () => {
    const cwd = subdir(fx.normal, "s23b");
    const miss = path.join(fx.root, "s23b-miss", "m.md");
    mkdirSync(path.dirname(miss), { recursive: true });
    writeFileSync(miss, "x");
    const d = await evaluateContainment(miss, [cwd], { site: "t" });
    expect(d.allowed).toBe(false);
    expect(Object.keys(d).sort()).toEqual(["allowed", "real", "remedy", "resolved", "viaGrant"]);
    const [denial] = listPathDenials();
    expect(denial).toBeDefined();
    expect("action" in denial).toBe(false); // a read denial carries no `action` key
  });

  it("S23: a write refusal records action:'write' on the denial", async () => {
    const cwd = subdir(fx.normal, "s23c");
    const miss = path.join(fx.root, "s23c-miss", "m.md");
    mkdirSync(path.dirname(miss), { recursive: true });
    writeFileSync(miss, "x");
    await evaluateContainment(miss, [cwd], { site: "t", action: "write" });
    expect(listPathDenials()[0]).toMatchObject({ action: "write" });
  });

  it("S24: a write grant admits its subtree, not a prefix-sibling, parent, or a symlink escaping it", async () => {
    const cwd = subdir(fx.normal, "s24");
    const grant = subdir(fx.root, "s24", "Downloads");
    const old = subdir(fx.root, "s24", "Downloads-old");
    const secretDir = subdir(fx.root, "s24", "secret");
    const nested = path.join(subdir(grant, "a", "b"), "x.md");
    const prefixSibling = path.join(old, "x.md");
    const parent = path.join(fx.root, "s24", "x.md");
    const secret = path.join(secretDir, "l.md");
    const link = path.join(grant, "l.md");
    for (const f of [nested, prefixSibling, parent, secret]) writeFileSync(f, "x");
    symlinkSync(secret, link);
    recordGrant({ subject: grant, mode: "write" });

    expect(await decide(nested, [cwd], "write"), "nested").toBe(true);
    expect(await decide(prefixSibling, [cwd], "write"), "Downloads-old").toBe(false);
    expect(await decide(parent, [cwd], "write"), "parent").toBe(false);
    expect(await decide(link, [cwd], "write"), "symlink judged on realpath").toBe(false);
  });
});
