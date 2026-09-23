/**
 * Denial registry, offered-ancestor ladder, and forbidden subjects.
 *
 * Covers test-plan E16, E17, E22, E23, X17, X18 and the ladder rules of task
 * 7b.1a. These three modules are what make design D15's "a grant may only name
 * a subject a recorded denial actually named" testable — before them, nothing in
 * the repo recorded a filesystem denial at all.
 *
 * See change: add-access-grants-and-review.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPathDenials,
  DENIAL_TTL_MS,
  getPathDenial,
  listPathDenials,
  recordPathDenial,
} from "../../access/access-denials.js";
import { offeredAncestorLadder } from "../../access/ancestor-ladder.js";
import { evaluateContainment } from "../../access/containment-gate.js";
import { forbiddenGrantSubjects, isForbiddenGrantSubject, subsumesForbiddenGrantSubject } from "../../access/forbidden-subjects.js";

let root: string;

function mkdir(...segs: string[]): string {
  const p = path.join(root, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "denials-"));
  __resetPathDenials();
});

afterEach(() => {
  __resetPathDenials();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("7b.0 / 9a.26–9a.27 denial registry", () => {
  it("9a.26 records subject, id, site, session and timestamp", () => {
    const subject = mkdir("s");
    const entry = recordPathDenial({
      subject,
      site: "file-routes:661",
      session: "sess-7",
      now: 5000,
    });
    expect(entry.subject).toBe(subject);
    expect(entry.site).toBe("file-routes:661");
    expect(entry.session).toBe("sess-7");
    expect(entry.at).toBe(5000);
    expect(entry.denialId).toMatch(/^[0-9a-f-]{36}$/);
    expect(getPathDenial(entry.denialId, 5001)).toEqual(entry);
  });

  it("9a.26 an unknown denial id resolves to undefined", () => {
    expect(getPathDenial("does-not-exist")).toBeUndefined();
  });

  it("9a.27 expires entries past the TTL", () => {
    const entry = recordPathDenial({ subject: mkdir("ttl"), site: "s", now: 1000 });
    expect(getPathDenial(entry.denialId, 1000 + DENIAL_TTL_MS - 1)).toBeDefined();
    expect(getPathDenial(entry.denialId, 1000 + DENIAL_TTL_MS)).toBeUndefined();
    expect(listPathDenials(1000 + DENIAL_TTL_MS)).toEqual([]);
  });

  it("9a.27 caps the registry with oldest evicted", () => {
    const first = recordPathDenial({ subject: mkdir("c", "0"), site: "s", now: 1 });
    for (let i = 1; i < 250; i += 1) {
      recordPathDenial({ subject: mkdir("c", String(i)), site: "s", now: 1 + i });
    }
    expect(listPathDenials(9999)).toHaveLength(200);
    expect(getPathDenial(first.denialId, 9999)).toBeUndefined();
  });

  it("records the ladder on the entry when one is offered", () => {
    const entry = recordPathDenial({
      subject: mkdir("l"),
      site: "s",
      ancestors: ["/a", "/a/b"],
    });
    expect(entry.ancestors).toEqual(["/a", "/a/b"]);
  });

  it("omits the ladder field when empty", () => {
    expect(recordPathDenial({ subject: mkdir("e"), site: "s" }).ancestors).toBeUndefined();
    expect(recordPathDenial({ subject: mkdir("e2"), site: "s", ancestors: [] }).ancestors).toBeUndefined();
  });

  it("expired entries are pruned on the next record", () => {
    recordPathDenial({ subject: mkdir("old"), site: "s", now: 0 });
    recordPathDenial({ subject: mkdir("new"), site: "s", now: DENIAL_TTL_MS + 1 });
    expect(listPathDenials(DENIAL_TTL_MS + 2)).toHaveLength(1);
  });
});

describe("7b.2 / 9a.20 / 9a.30 forbidden subjects", () => {
  it("9a.20 refuses the root, home, ~/.ssh and ~/.pi", () => {
    const home = mkdir("home");
    mkdir("home", ".ssh");
    mkdir("home", ".pi");
    expect(isForbiddenGrantSubject("/", { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject(home, { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject(path.join(home, ".ssh"), { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject(path.join(home, ".pi"), { homedir: home })).toBe(true);
  });

  it("7b.2 refuses platform system directories", () => {
    const home = mkdir("home");
    for (const p of ["/etc", "/usr", "/var", "/Library"]) {
      expect(isForbiddenGrantSubject(p, { homedir: home })).toBe(true);
    }
  });

  it("7b.2 refuses anything UNDER a secret store, so a ladder cannot climb in", () => {
    const home = mkdir("home");
    expect(isForbiddenGrantSubject(path.join(home, ".ssh", "keys"), { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject(path.join(home, ".pi", "dashboard"), { homedir: home })).toBe(true);
  });

  it("2b.3 / #E16 refuses a candidate that CONTAINS a forbidden subject (the ancestor direction)", () => {
    // The direction an equality test cannot express, and the reason this rule is
    // a real-path SUBTREE relation rather than a set membership: `outer` is not
    // itself forbidden, yet granting it admits `outer/home` — the home
    // directory — and every secret beneath it. `/Users` for a real home is the
    // production shape of this case (task 10.23 / #E16).
    const outer = mkdir("outer");
    const home = mkdir("outer", "home");
    mkdir("outer", "home", ".ssh");
    expect(subsumesForbiddenGrantSubject(outer, { homedir: home })).toBe(true);
    expect(subsumesForbiddenGrantSubject(home, { homedir: home })).toBe(true);
    expect(subsumesForbiddenGrantSubject(path.join(home, ".ssh"), { homedir: home })).toBe(true);
    // A candidate containing nothing forbidden must still be grantable, or the
    // rule would refuse every directory on the filesystem.
    expect(subsumesForbiddenGrantSubject(mkdir("proj"), { homedir: home })).toBe(false);
  });

  it("7b.2 a system directory is refused exactly; a data root beneath it is not", () => {
    // The spec's forbidden list names the platform system directories
    // themselves (task 7b.2 / 9a.20). Matching them as SUBTREES would forbid
    // every project under $HOME (they all live under it) and macOS temp dirs
    // under /private/var — making the feature unable to grant anything.
    const home = mkdir("home");
    expect(isForbiddenGrantSubject("/etc", { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject("/var", { homedir: home })).toBe(true);
    expect(isForbiddenGrantSubject(mkdir("proj", "src"), { homedir: home })).toBe(false);
  });

  it("9a.30 catches a symlink alias to a forbidden subject", () => {
    const home = mkdir("home");
    const link = path.join(root, "etc-alias");
    // On macOS /etc is /private/etc; the realpath compare must catch the alias.
    fs.symlinkSync("/etc", link);
    expect(isForbiddenGrantSubject(link, { homedir: home })).toBe(true);
  });

  it("allows an ordinary project directory", () => {
    const home = mkdir("home");
    expect(isForbiddenGrantSubject(mkdir("proj", "src"), { homedir: home })).toBe(false);
  });

  it("reports the forbidden sets as real paths", () => {
    const home = mkdir("home");
    mkdir("home", ".ssh");
    mkdir("home", ".pi");
    const { whole, sensitive } = forbiddenGrantSubjects({ homedir: home });
    expect(whole).toContain(fs.realpathSync("/"));
    expect(whole).toContain(fs.realpathSync(home));
    expect(whole).toContain(fs.realpathSync("/etc"));
    expect(sensitive).toContain(fs.realpathSync(path.join(home, ".ssh")));
    expect(sensitive).toContain(fs.realpathSync(path.join(home, ".pi")));
    expect([...whole, ...sensitive].every((p) => path.isAbsolute(p))).toBe(true);
  });
});

describe("7b.1a / 9a.20–9a.21 offered-ancestor ladder", () => {
  it("returns an empty ladder when the parent is $HOME", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder5");
    const subject = path.join(home, "child");
    fs.mkdirSync(subject, { recursive: true });
    expect(await offeredAncestorLadder(subject, { homedir: home })).toEqual([]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("stops BELOW $HOME when there is no repository", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder");
    fs.mkdirSync(home, { recursive: true });
    const deep = path.join(home, "work", "proj", "src", "sub");
    fs.mkdirSync(deep, { recursive: true });
    const ladder = await offeredAncestorLadder(deep, { homedir: home });
    // Nearest-first, and $HOME itself is never a rung.
    expect(ladder[0]).toBe(fs.realpathSync(path.join(home, "work", "proj", "src")));
    expect(ladder).not.toContain(fs.realpathSync(home));
    expect(ladder.every((r) => r.startsWith(fs.realpathSync(home)))).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("includes the checkout root and stops there inside a repo", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder2");
    const repo = path.join(home, "work", "repo");
    fs.mkdirSync(repo, { recursive: true });
    // A REAL repo: `mkdir .git` is not one, and the git probe correctly returns
    // null for it (that is the degraded-git path, covered separately below).
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const deep = path.join(repo, "src", "sub");
    fs.mkdirSync(deep, { recursive: true });

    const ladder = await offeredAncestorLadder(deep, { homedir: home });
    expect(ladder).toContain(fs.realpathSync(repo));
    // The checkout root terminates the ladder — the directory HOLDING the repo
    // is never offered.
    expect(ladder[ladder.length - 1]).toBe(fs.realpathSync(repo));
    expect(ladder).not.toContain(fs.realpathSync(path.join(home, "work")));
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("stops at the checkout root when the subject IS the repo root", async () => {
    // The most common denial shape is a file directly under the repo root, so
    // the subject IS the boundary and the first rung would already sit above it.
    // The old boundary guards nulled themselves in exactly this case and offered
    // `work` — every sibling repo in one click (task 8.7 review).
    const home = path.join(os.homedir(), "fake-home-ladder7");
    const repo = path.join(home, "work", "repo");
    fs.mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });

    expect(await offeredAncestorLadder(repo, { homedir: home })).toEqual([]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("stops at the checkout root when the subject is its direct child", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder8");
    const repo = path.join(home, "work", "repo");
    fs.mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const child = path.join(repo, "src");
    fs.mkdirSync(child, { recursive: true });

    // Exactly the repo root — the boundary — and nothing above it. This is the
    // legitimate rung, so the fix must keep it while refusing `work`.
    const ladder = await offeredAncestorLadder(child, { homedir: home });
    expect(ladder).toEqual([fs.realpathSync(repo)]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("never offers a symlink's lexical parent", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder6");
    const realDir = path.join(home, "work", "real");
    const linkDir = path.join(home, "work", "links");
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(linkDir, { recursive: true });
    const link = path.join(linkDir, "cur");
    fs.symlinkSync(realDir, link);

    const ladder = await offeredAncestorLadder(path.join(link, "sub"), { homedir: home });
    // Derived from the real path: the first rung is the real directory, and no
    // rung is ever the link's lexical parent.
    expect(ladder[0]).toBe(fs.realpathSync(realDir));
    expect(ladder).not.toContain(fs.realpathSync(linkDir));
    expect(ladder.some((r) => r.startsWith(fs.realpathSync(linkDir)))).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("filters a forbidden rung out of the ladder", async () => {
    const home = mkdir("home");
    fs.mkdirSync(path.join(home, ".ssh", "keys"), { recursive: true });
    const ladder = await offeredAncestorLadder(path.join(home, ".ssh", "keys"), {
      homedir: home,
    });
    expect(ladder).toEqual([]);
  });

  it("a ladder stops rather than climbing through a secret store", async () => {
    const home = mkdir("home");
    mkdir("home", ".ssh");
    mkdir("home", ".pi");
    const deep = mkdir("home", "work", "proj");
    const ladder = await offeredAncestorLadder(deep, { homedir: home });
    expect(ladder).not.toContain(fs.realpathSync(path.join(home, ".ssh")));
    expect(ladder).not.toContain(fs.realpathSync(path.join(home, ".pi")));
    expect(ladder).not.toContain(fs.realpathSync(home));
  });

  it("degrades to the no-repo boundary when git is unavailable", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder3");
    const deep = path.join(home, "work", "proj", "src");
    fs.mkdirSync(deep, { recursive: true });
    const original = process.env.PATH;
    process.env.PATH = "";
    try {
      const ladder = await offeredAncestorLadder(deep, { homedir: home });
      expect(ladder[0]).toBe(fs.realpathSync(path.join(home, "work", "proj")));
      expect(ladder).not.toContain(fs.realpathSync(home));
    } finally {
      process.env.PATH = original;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("never offers the filesystem root", async () => {
    const home = path.join(os.homedir(), "fake-home-ladder4");
    const deep = path.join(home, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    const ladder = await offeredAncestorLadder(deep, { homedir: home });
    expect(ladder).not.toContain(fs.realpathSync("/"));
    expect(ladder).not.toContain(path.parse(root).root);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("returns an empty ladder for a subject inside a secret store", async () => {
    const home = mkdir("home");
    fs.mkdirSync(path.join(home, ".ssh", "keys"), { recursive: true });
    expect(await offeredAncestorLadder(path.join(home, ".ssh", "keys"), { homedir: home })).toEqual([]);
  });
});

describe("4.5 review #4 — the remedy names the resource, not its parent", () => {
  it("a FILE denial names its containing directory", async () => {
    const session = mkdir("sess");
    const outside = mkdir("outside", "project");

    const d = await evaluateContainment(path.join(outside, "f.txt"), [session], {
      site: "test:file",
    });
    expect(d.allowed).toBe(false);
    expect(d.remedy?.subject).toBe(outside);
  });

  it("a DIRECTORY denial names the directory itself, never the parent holding siblings", async () => {
    // Pre-fix the subject was the lexical dirname — `outside/` — so accepting the
    // remedy granted every SIBLING tree in one click, and a directory sitting
    // directly under `$HOME` named `$HOME`, which the forbidden filter refuses,
    // making the directory impossible to grant at all. (Task 4.5 review, #4.)
    const session = mkdir("sess");
    const outside = mkdir("outside", "project");
    const sibling = mkdir("outside", "sibling-secret");

    const d = await evaluateContainment(outside, [session], {
      site: "test:tree",
      subjectKind: "directory",
    });
    expect(d.allowed).toBe(false);
    expect(d.remedy?.subject).toBe(outside);
    expect(d.remedy?.subject).not.toBe(path.dirname(outside));
    expect(sibling.startsWith(`${d.remedy?.subject}/`)).toBe(false);
  });

  it("subjectKind 'auto' names a refused DIRECTORY itself and a refused FILE's parent", async () => {
    // `"auto"` is for polymorphic sites (`/api/file`, `/api/file/exists`) that
    // admit files AND directories, so the target's own kind must decide. Passing
    // the default would leave the sibling-widening bug in place at those two
    // routes; passing a blanket "directory" would be wrong for a refused FILE.
    const session = mkdir("sess");
    const outside = mkdir("outside", "project");
    mkdir("outside", "sibling-secret");
    const file = path.join(outside, "f.txt");
    fs.writeFileSync(file, "x");

    const dir = await evaluateContainment(outside, [session], {
      site: "test:auto-dir",
      subjectKind: "auto",
    });
    expect(dir.allowed).toBe(false);
    expect(dir.remedy?.subject).toBe(outside);

    const asFile = await evaluateContainment(file, [session], {
      site: "test:auto-file",
      subjectKind: "auto",
    });
    expect(asFile.allowed).toBe(false);
    expect(asFile.remedy?.subject).toBe(outside);
  });

  it("allowGrant:false originates NO remedy and records nothing (environment-free)", async () => {
    // The route-level test in granted-read-verification.test.ts can only observe
    // this on a host that CAN spawn: on a headless CI runner the route
    // short-circuits at its capability check first, before the gate, so it would
    // pass there even without the fix. This asserts the gate itself, so the
    // contract is proven everywhere.
    //
    // A site that cannot be ADMITTED by a grant must not ORIGINATE one: no remedy
    // fields means no `denialId`, so the operator has nothing to accept and the
    // site cannot mint a grant that could not remedy the refused operation.
    const session = mkdir("sess");
    const outside = mkdir("outside", "project");

    const d = await evaluateContainment(outside, [session], {
      site: "test:nogrant",
      allowGrant: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.viaGrant).toBe(false);
    expect(d.remedy).toBeUndefined();
    expect(listPathDenials()).toEqual([]);
  });
});

describe("9a.31 / 9c.6 no inbound write path to the registry", () => {
  it("9a.31 the registry is written only by recordPathDenial", async () => {
    // Route-inventory half: the module exports no route/handler registration.
    const mod = await import("../../access/access-denials.js");
    const exports = Object.keys(mod);
    expect(exports).toContain("recordPathDenial");
    expect(exports.filter((e) => /route|handler|endpoint|post|create/i.test(e))).toEqual([]);
  });
});
