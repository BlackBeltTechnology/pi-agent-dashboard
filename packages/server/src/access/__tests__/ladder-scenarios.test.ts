/**
 * Offered-ancestor ladder edge cases (change: add-access-grant-dialog, tasks
 * 10.25-10.28, 10.30, 10.52; test-plan #E24-#E27, #E29, #X8).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offeredAncestorLadder } from "../ancestor-ladder.js";
import { forbiddenGrantSubjects, isUngrantableSubject } from "../forbidden-subjects.js";

let home: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
const mk = (...segs: string[]) => {
  const p = path.join(home, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const real = (p: string) => fs.realpathSync(p);

beforeEach(() => {
  // Under the real home, like the prerequisite's ladder tests, so no forbidden
  // system prefix (e.g. /private on macOS tmp) stops the climb early.
  home = fs.mkdtempSync(path.join(os.homedir(), "ladder-scn-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("ladder edge cases", () => {
  it("#E24 a checkout nested in a checkout truncates at the INNER root", async () => {
    const outer = mk("a");
    git(outer, "init", "-q");
    const inner = mk("a", "b");
    git(inner, "init", "-q");
    const ladder = await offeredAncestorLadder(mk("a", "b", "src", "x"), { homedir: home });
    expect(ladder.at(-1)).toBe(real(inner));
    expect(ladder).not.toContain(real(outer));
  });

  it("#E25 a linked worktree (.git is a FILE) is recognised as its own checkout root", async () => {
    const repo = mk("repo");
    git(repo, "init", "-q");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = path.join(home, "wt");
    git(repo, "worktree", "add", "-q", wt);
    expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);
    const ladder = await offeredAncestorLadder(mk("wt", "src", "deep"), { homedir: home });
    expect(ladder.at(-1)).toBe(real(wt));
    expect(ladder).not.toContain(real(home));
  });

  it("#E26 through a symlinked checkout: root found on the real path, every rung an ancestor of it", async () => {
    const repo = mk("real-repo");
    git(repo, "init", "-q");
    mk("real-repo", "src", "sub");
    const link = path.join(home, "link-repo");
    fs.symlinkSync(repo, link);
    const ladder = await offeredAncestorLadder(path.join(link, "src", "sub"), { homedir: home });
    const realSubject = real(path.join(link, "src", "sub"));
    expect(ladder.at(-1)).toBe(real(repo));
    for (const rung of ladder) expect(realSubject.startsWith(rung + path.sep)).toBe(true);
    expect(ladder.some((r) => r.startsWith(path.join(home, "link-repo")))).toBe(false);
  });

  it("#E27 with $HOME unset, outside any checkout: bounded, never the fs root, every rung grantable", async () => {
    const saved = process.env.HOME;
    delete process.env.HOME;
    try {
      const deep = mk("x", "y", "z");
      const ladder = await offeredAncestorLadder(deep);
      expect(ladder).not.toContain(path.parse(deep).root);
      for (const rung of ladder) expect(isUngrantableSubject(rung)).toBe(false);
    } finally {
      process.env.HOME = saved;
    }
  });

  it("#E29 the subject IS the home directory: empty ladder", async () => {
    expect(await offeredAncestorLadder(home, { homedir: home })).toEqual([]);
  });

  it("#X8 an unresolvable subject is refused (empty ladder), never compared unresolved", async () => {
    const dangling = path.join(home, "work", "gone");
    mk("work");
    fs.symlinkSync(path.join(home, "nowhere"), dangling);
    expect(await offeredAncestorLadder(path.join(dangling, "sub"), { homedir: home })).toEqual([]);
    expect(await offeredAncestorLadder(path.join(home, "work", "not-yet"), { homedir: home })).toEqual([]);
  });
});

describe("platform-scoped forbidden list (change: surface-denial-remedy-in-previews)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("#E23 POSIX entries: no Windows junk, the server cwd and its parent stay grantable", () => {
    if (process.platform === "win32") return; // POSIX-host scenario; Windows is #E24's smoke
    const cwd = mk("proj", "srv");
    // Pin the server cwd below the fixture home: the old junk entries were
    // `<cwd>/C:\Windows`, which made the cwd and its ancestors ungrantable.
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const { whole, sensitive } = forbiddenGrantSubjects({ homedir: home });
    for (const entry of [...whole, ...sensitive]) {
      expect(entry).not.toContain("\\");
      expect(entry).not.toMatch(/^[A-Za-z]:/);
    }
    expect(isUngrantableSubject(cwd, { homedir: home })).toBe(false);
    expect(isUngrantableSubject(path.dirname(cwd), { homedir: home })).toBe(false);
    expect(isUngrantableSubject(path.dirname(home), { homedir: home })).toBe(true);
  });

  it("Windows entries come from the environment, not the POSIX list", () => {
    const { whole } = forbiddenGrantSubjects({
      homedir: "D:\\Users\\op",
      platform: "win32",
      env: { SystemRoot: "D:\\Windows", ProgramFiles: "D:\\Programs" },
    });
    expect(whole).toContain("D:\\Windows");
    expect(whole).toContain("D:\\Programs");
    expect(whole).toContain("C:\\ProgramData"); // unset variable → literal fallback
    expect(whole).toContain("D:\\");
    expect(whole.some((e) => e.startsWith("/") || /\\(etc|usr|var)$/.test(e))).toBe(false);
  });

  it("the predicates use Windows semantics end to end under a simulated win32", () => {
    const env = {
      homedir: "D:\\Users\\op",
      platform: "win32" as const,
      env: { SystemRoot: "D:\\Windows" },
    };
    expect(isUngrantableSubject("d:\\windows", env)).toBe(true); // exact, case-insensitive
    expect(isUngrantableSubject("D:\\Users", env)).toBe(true); // contains $HOME
    expect(isUngrantableSubject("D:\\Users\\op\\.ssh\\keys", env)).toBe(true); // under a sensitive dir
    expect(isUngrantableSubject("D:\\Users\\op\\proj", env)).toBe(false);
    expect(isUngrantableSubject("E:\\data", env)).toBe(false);
  });
});
