/**
 * Shared-root computation for remote browse/mkdir confinement.
 * See change: harden-server-capability-bounds (test-plan #E16-#E19, #X1, #X2).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BrowseRootSources, isWithinBrowseRoots, resolveBrowseRoots } from "../lib/browse-roots.js";

let tmp: string;
let home: string;
let outside: string;
let env: { homedir: string };

const none = (): readonly string[] => [];
const src = (over: Partial<BrowseRootSources> = {}): BrowseRootSources => ({
  pinned: none, sessionCwds: none, workspaceFolders: none, worktreeRoots: none, projectGrants: none, ...over,
});
const mk = async (...parts: string[]) => {
  const p = path.join(tmp, ...parts);
  await fsp.mkdir(p, { recursive: true });
  return p;
};
const allowed = async (target: string, s: BrowseRootSources) =>
  isWithinBrowseRoots(target, await resolveBrowseRoots(s, env));

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "browse-roots-")));
  home = await mk("home");
  outside = await mk("outside");
  env = { homedir: home };
});
afterEach(() => fsp.rm(tmp, { recursive: true, force: true }));

describe("root sources (E16)", () => {
  it("each shared source makes its directory a root; a session-scope grant does not", async () => {
    const [pinned, cwd, ws, wt, grant, sessionGrant] = await Promise.all(
      ["pinned", "cwd", "ws", "wt", "grant", "session-grant"].map((n) => mk("srv", n)),
    );
    const s = src({
      pinned: () => [pinned],
      sessionCwds: () => [cwd],
      workspaceFolders: () => [ws],
      worktreeRoots: () => [wt],
      projectGrants: () => [grant], // the caller passes only project-scope subjects
    });
    for (const d of [pinned, cwd, ws, wt, grant]) expect(await allowed(d, s)).toBe(true);
    expect(await allowed(sessionGrant, s)).toBe(false);
  });

  it("allows $HOME and its descendants; refuses a sibling, the parent and the filesystem root", async () => {
    const s = src();
    expect(await allowed(home, s)).toBe(true);
    expect(await allowed(path.join(home, "Project", "x"), s)).toBe(true);
    expect(await allowed(outside, s)).toBe(false);
    expect(await allowed(tmp, s)).toBe(false);
    expect(await allowed(path.parse(tmp).root, s)).toBe(false);
  });

  it("refuses a `..` escape out of home", async () => {
    expect(await allowed(path.join(home, "..", "outside"), src())).toBe(false);
  });
});

describe("forbidden filter (E17)", () => {
  it("a pinned filesystem root, system root or ancestor of home never becomes a root", async () => {
    const s = src({ pinned: () => [path.parse(tmp).root, tmp, home] });
    const { roots } = await resolveBrowseRoots(s, env);
    expect(roots).toEqual([home]); // `/` and tmp (ancestor of ~/.ssh) dropped; home is the explicit root
    expect(await allowed("/etc", s)).toBe(false);
    expect(await allowed(outside, s)).toBe(false);
    expect(await allowed(home, s)).toBe(true);
  });
});

describe("sensitive subtrees (E18)", () => {
  it("~/.ssh and ~/.pi are refused although $HOME is a root", async () => {
    const ssh = await mk("home", ".ssh");
    const pi = await mk("home", ".pi", "agent");
    expect(await allowed(ssh, src())).toBe(false);
    expect(await allowed(pi, src())).toBe(false);
    expect(await allowed(path.join(home, ".pi"), src())).toBe(false);
  });

  it("a pinned dir inside a sensitive subtree is not a root", async () => {
    const inPi = await mk("home", ".pi", "agent");
    expect((await resolveBrowseRoots(src({ pinned: () => [inPi] }), env)).roots).toEqual([home]);
  });
});

describe("symlink containment (E19)", () => {
  it("a link inside home pointing out is refused; one pointing in is allowed", async () => {
    await mk("home", "Project");
    await fsp.symlink(outside, path.join(home, "out"));
    await fsp.symlink(path.join(home, "Project"), path.join(home, "in"));
    expect(await allowed(path.join(home, "out"), src())).toBe(false);
    expect(await allowed(path.join(home, "out", "child"), src())).toBe(false);
    expect(await allowed(path.join(home, "in"), src())).toBe(true);
  });

  it("a non-existent tail under a root is allowed (nearest-ancestor realpath)", async () => {
    expect(await allowed(path.join(home, "new", "deep"), src())).toBe(true);
  });

  it("a symlinked $HOME is compared on real paths", async () => {
    const link = path.join(tmp, "home-link");
    await fsp.symlink(home, link);
    const e = { homedir: link };
    const roots = await resolveBrowseRoots(src(), e);
    expect(await isWithinBrowseRoots(path.join(home, "x"), roots)).toBe(true);
    expect(await isWithinBrowseRoots(outside, roots)).toBe(false);
  });
});

describe("fault injection (X1, X2)", () => {
  it("X1 an unreadable / deleted pinned dir is dropped; the others still apply", async () => {
    const gone = path.join(tmp, "gone");
    const good = await mk("srv", "good");
    const s = src({ pinned: () => [gone, good] });
    const { roots } = await resolveBrowseRoots(s, env);
    expect(roots).toContain(good);
    expect(roots).not.toContain(gone);
    expect(await allowed(path.join(home, "Project"), s)).toBe(true);
  });

  it("X2 a source that throws contributes nothing (fail closed) with one warn line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const grantOnly = await mk("srv", "grant-only");
    const s = src({
      projectGrants: () => {
        throw new Error("store read failed");
      },
    });
    expect(await allowed(grantOnly, s)).toBe(false);
    expect(await allowed(path.join(home, "Project"), s)).toBe(true);
    await allowed(grantOnly, s); // second request must not warn again
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes("projectGrants"));
    expect(lines.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });
});
