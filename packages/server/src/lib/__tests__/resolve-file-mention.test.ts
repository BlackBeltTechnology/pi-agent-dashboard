/**
 * Unit tests for `resolveFileMention` — the lazy server-side mention resolver.
 *
 * Fake-HOME harness: `$HOME` is repointed at a tmp dir so `~/.pi/…` mentions
 * resolve under a controlled home without touching the developer's real home.
 * Containment + tilde-expansion + containment-before-stat are the load-bearing
 * behaviors (design D2/D7). See change: server-side-file-mention-resolution.
 */

import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as accessGrants from "../../access/access-grants.js";
import { createMentionFuzzyIndex, type MentionFuzzyIndex } from "../mention-fuzzy-index.js";
import { resolveFileMention, resolveMentionTagged } from "../resolve-file-mention.js";

vi.mock("../../access/access-grants.js", async (orig) => ({
  ...(await orig<typeof import("../../access/access-grants.js")>()),
  grantedSubjects: vi.fn(() => [] as string[]),
}));

describe("resolveFileMention", () => {
  let home: string;
  let cwd: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    // Real path (macOS /tmp is a symlink to /private/tmp) so containment's
    // realpath layer does not spuriously reject.
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-home-")));
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-cwd-")));
    origHome = process.env.HOME;
    process.env.HOME = home; // os.homedir() reads $HOME on POSIX
    await fsp.mkdir(path.join(home, ".pi", "dashboard"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "dashboard", "worktree-init-trust.json"), "{}\n");
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await fsp.rm(home, { recursive: true, force: true });
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("resolves a `~/.pi` home file under home with kind tilde (S2)", async () => {
    const res = await resolveFileMention("~/.pi/dashboard/worktree-init-trust.json", { cwd });
    expect(res).toEqual({
      resolved: path.join(home, ".pi", "dashboard", "worktree-init-trust.json"),
      kind: "tilde",
    });
  });

  // fix-file-link-editor-routing S1: containment failure → `outside:true`, never statted, existence-independent.
  it("a home file outside `~/.pi` returns outside:true identically whether present or absent, no stat (S1)", async () => {
    const expected = { resolved: path.join(home, "Downloads", "x.md"), kind: "tilde", outside: true };
    const statSpy = vi.spyOn(fs, "stat");
    // absent
    expect(await resolveFileMention("~/Downloads/x.md", { cwd })).toEqual(expected);
    // present
    await fsp.mkdir(path.join(home, "Downloads"), { recursive: true });
    await fsp.writeFile(path.join(home, "Downloads", "x.md"), "# x\n");
    statSpy.mockClear();
    expect(await resolveFileMention("~/Downloads/x.md", { cwd })).toEqual(expected);
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("a sensitive home path returns outside:true with no stat (S2)", async () => {
    // File exists so rejection is by containment, not absence.
    await fsp.mkdir(path.join(home, ".ssh"), { recursive: true });
    await fsp.writeFile(path.join(home, ".ssh", "id_rsa"), "PRIVATE\n");
    const statSpy = vi.spyOn(fs, "stat");
    const res = await resolveFileMention("~/.ssh/id_rsa", { cwd });
    expect(res).toEqual({ resolved: path.join(home, ".ssh", "id_rsa"), kind: "tilde", outside: true });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("a tilde traversal escape returns the collapsed path with outside:true, no stat (S3)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    expect(await resolveFileMention("~/../../etc/passwd", { cwd })).toEqual({
      resolved: path.resolve(home, "..", "..", "etc", "passwd"),
      kind: "tilde",
      outside: true,
    });
    expect(await resolveFileMention("~/a/../../b.md", { cwd })).toEqual({
      resolved: path.resolve(home, "..", "b.md"),
      kind: "tilde",
      outside: true,
    });
    // `~/.pi/../.ssh/k` collapses to `<home>/.ssh/k`: NOT contained under the `~/.pi` anchor.
    expect(await resolveFileMention("~/.pi/../.ssh/k", { cwd })).toEqual({
      resolved: path.join(home, ".ssh", "k"),
      kind: "tilde",
      outside: true,
    });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("an absolute mention outside cwd with no grant returns kind abs + outside:true, no stat (S4)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    const res = await resolveFileMention("/Users/u/Downloads/x.md", { cwd });
    expect(res).toEqual({ resolved: path.resolve("/Users/u/Downloads/x.md"), kind: "abs", outside: true });
    expect(statSpy).not.toHaveBeenCalled();
  });

  // S5: containment × existence × grant. `outside` is true iff containment failed; stat only on contained rows.
  describe("decision table: containment × existence × grant (S5)", () => {
    let outside: string;
    beforeEach(async () => {
      outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-dt-")));
      await fsp.writeFile(path.join(outside, "here.md"), "x");
      await fsp.writeFile(path.join(cwd, "here.md"), "x");
    });
    afterEach(async () => {
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([]);
      await fsp.rm(outside, { recursive: true, force: true });
    });

    it("(contained, exists) → { resolved, kind }, no outside key; stat called", async () => {
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveFileMention("here.md", { cwd });
      expect(res).toEqual({ resolved: path.join(cwd, "here.md"), kind: "relative" });
      expect(res).not.toHaveProperty("outside");
      expect(statSpy).toHaveBeenCalled();
    });

    it("(contained, missing) → null", async () => {
      expect(await resolveFileMention("gone.md", { cwd })).toBeNull();
    });

    it("(outside, no grant, exists vs missing) → identical outside:true, no stat", async () => {
      const statSpy = vi.spyOn(fs, "stat");
      const present = await resolveFileMention(path.join(outside, "here.md"), { cwd });
      const missing = await resolveFileMention(path.join(outside, "gone.md"), { cwd });
      expect(present).toEqual({ resolved: path.join(outside, "here.md"), kind: "abs", outside: true });
      expect(missing).toEqual({ resolved: path.join(outside, "gone.md"), kind: "abs", outside: true });
      expect(statSpy).not.toHaveBeenCalled();
    });

    it("(outside, granted (read or write ⊃ read), exists) → { resolved, kind }, no outside key", async () => {
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([outside]);
      const res = await resolveFileMention(path.join(outside, "here.md"), { cwd });
      expect(res).toEqual({ resolved: path.join(outside, "here.md"), kind: "abs" });
      expect(res).not.toHaveProperty("outside");
    });

    it("(outside, granted, missing) → null", async () => {
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([outside]);
      expect(await resolveFileMention(path.join(outside, "gone.md"), { cwd })).toBeNull();
    });
  });

  it("resolves a relative mention rooted at cwd with kind relative (S5)", async () => {
    await fsp.mkdir(path.join(cwd, "sub"), { recursive: true });
    await fsp.writeFile(path.join(cwd, "sub", "file.ts"), "x\n");
    const res = await resolveFileMention("sub/file.ts", { cwd });
    expect(res).toEqual({ resolved: path.join(cwd, "sub", "file.ts"), kind: "relative" });
  });

  it("returns null for a nonexistent mention (S6)", async () => {
    const res = await resolveFileMention("foo.ts", { cwd });
    expect(res).toBeNull();
  });

  it("does not expand `~user/` to another user home (S6)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    // Relative mention under cwd: contained-missing → null, never an `outside` result for another user's home.
    expect(await resolveFileMention("~root/x.md", { cwd })).toBeNull();
    expect(await resolveFileMention("~alice/x.ts", { cwd })).toBeNull();
    for (const call of statSpy.mock.calls) expect(String(call[0]).startsWith(cwd)).toBe(true);
  });

  it("runs fs.stat only AFTER containment passes, never before (S8)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    // Fails containment (outside cwd / git-root / ~/.pi) → must not stat; answers `outside:true`.
    const res = await resolveFileMention("~/../../etc/passwd", { cwd });
    expect(res).toMatchObject({ kind: "tilde", outside: true });
    expect(statSpy).not.toHaveBeenCalled();
  });

  // #E8 (codeql-file-containment-barrier): the passive mention site keeps consuming grants.
  it("a mention outside the anchors resolves only when a grant covers it, otherwise it is `outside` (#E8)", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-out-")));
    try {
      await fsp.writeFile(path.join(outside, "x.txt"), "x");
      await fsp.writeFile(path.join(outside, "y.txt"), "y");
      expect(await resolveFileMention(path.join(outside, "x.txt"), { cwd })).toMatchObject({ kind: "abs", outside: true });
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([outside]);
      expect(await resolveFileMention(path.join(outside, "x.txt"), { cwd })).toMatchObject({ resolved: path.join(outside, "x.txt"), kind: "abs" });
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([path.join(outside, "x.txt")]);
      expect(await resolveFileMention(path.join(outside, "y.txt"), { cwd })).toMatchObject({ kind: "abs", outside: true });
    } finally {
      vi.mocked(accessGrants.grantedSubjects).mockReturnValue([]);
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  // #E10 (close-security-map-high-findings): pi-agent credential files never resolve as a mention.
  it("credential mentions never resolve as a contained file (outside:true, no stat, no denial recorded); a skill file still resolves (#E10)", async () => {
    const agentDir = path.join(home, ".pi", "agent");
    await fsp.mkdir(path.join(agentDir, "skills", "x"), { recursive: true });
    for (const n of ["auth.json", "models.json", "auth.json.bak"]) await fsp.writeFile(path.join(agentDir, n), "SECRET\n");
    await fsp.writeFile(path.join(agentDir, "skills", "x", "SKILL.md"), "# skill\n");
    const homeCwd = home;
    for (const mention of [
      "~/.pi/agent/auth.json",
      path.join(agentDir, "auth.json"),
      ".pi/agent/auth.json", // relative, cwd = $HOME
      "~/.pi/agent/models.json",
      "~/.pi/agent/auth.json.bak",
    ]) {
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveFileMention(mention, { cwd: homeCwd });
      expect(res, mention).toMatchObject({ outside: true });
      expect(res, mention).not.toBeNull();
      expect(statSpy, mention).not.toHaveBeenCalled();
      statSpy.mockRestore();
    }
    const { listPathDenials } = await import("../../access/access-denials.js");
    expect(listPathDenials()).toEqual([]);
    expect(await resolveFileMention("~/.pi/agent/skills/x/SKILL.md", { cwd })).toEqual({
      resolved: path.join(agentDir, "skills", "x", "SKILL.md"),
      kind: "tilde",
    });
  });

  // T.8 (close-local-listener-and-egress-gaps): the mention site decides on REAL paths, passively.
  it("T.8 a mention through an escaping link is `outside`, through an in-anchor link resolves; no denial recorded", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rfm-esc-")));
    try {
      await fsp.writeFile(path.join(outside, "secret.txt"), "SECRET");
      await fsp.symlink(path.join(outside, "secret.txt"), path.join(cwd, "esc"));
      await fsp.writeFile(path.join(cwd, "real.txt"), "ok");
      await fsp.symlink(path.join(cwd, "real.txt"), path.join(cwd, "inl"));

      expect(await resolveFileMention("esc", { cwd })).toMatchObject({ kind: "relative", outside: true });
      expect(await resolveFileMention(path.join(cwd, "esc"), { cwd })).toMatchObject({ kind: "abs", outside: true });
      expect(await resolveFileMention("inl", { cwd })).toEqual({ resolved: path.join(cwd, "inl"), kind: "relative" });

      const { listPathDenials } = await import("../../access/access-denials.js");
      expect(listPathDenials()).toEqual([]);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

/**
 * Tagged pipeline (change: rich-chat-links, design D3/D5): re-rooted → tool-dir → exact → fuzzy, recovery opt-in.
 * Real git in a tmp repo; `fs.stat` is spied to prove containment-before-stat and the per-mention stat budget.
 */
describe("resolveMentionTagged", () => {
  let home: string;
  let cwd: string;
  let origHome: string | undefined;
  const cleanup: string[] = [];

  const put = async (rel: string, body = "x\n"): Promise<void> => {
    await fsp.mkdir(path.dirname(path.join(cwd, rel)), { recursive: true });
    await fsp.writeFile(path.join(cwd, rel), body);
  };
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  };
  const track = (): void => {
    git("init", "-q");
    git("add", "-A");
  };
  const statCalls = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => String(c[0]));
  const ETC = /^\/(private\/)?etc(\/|$)/;
  /** A fresh index wrapped in a `lookup` spy: how the opt-in is observed. */
  const spiedIndex = (): { idx: MentionFuzzyIndex; lookup: ReturnType<typeof vi.spyOn> } => {
    const idx = createMentionFuzzyIndex();
    return { idx, lookup: vi.spyOn(idx, "lookup") };
  };

  beforeEach(async () => {
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rmt-home-")));
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rmt-cwd-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await fsp.rm(home, { recursive: true, force: true });
    await fsp.rm(cwd, { recursive: true, force: true });
    for (const d of cleanup.splice(0)) await fsp.rm(d, { recursive: true, force: true });
  });

  // E12 — recovery opt-in: (recover × toolCwd)
  describe("recovery opt-in (E12)", () => {
    beforeEach(async () => {
      await put("packages/client/src/a.ts");
      track();
    });

    it("recover off, no toolCwd: unresolved, no via, fuzzy index never built", async () => {
      const { idx, lookup } = spiedIndex();
      const res = await resolveMentionTagged("src/a.ts", { cwd, fuzzyIndex: idx });
      expect(res).toEqual({ state: "missing", resolved: null });
      expect(res).not.toHaveProperty("via");
      expect(lookup).not.toHaveBeenCalled();
    });

    it("recover off, toolCwd given: the tool dir is ignored too", async () => {
      const { idx, lookup } = spiedIndex();
      const res = await resolveMentionTagged("src/a.ts", { cwd, toolCwd: "packages/client", fuzzyIndex: idx });
      expect(res).toEqual({ state: "missing", resolved: null });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("recover on, no toolCwd: fuzzy suffix → recovered", async () => {
      const { idx } = spiedIndex();
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, fuzzyIndex: idx });
      expect(res).toEqual({
        state: "recovered",
        resolved: path.join(cwd, "packages", "client", "src", "a.ts"),
        kind: "fuzzy",
        via: "fuzzy",
      });
    });

    it("recover on + toolCwd: found via the tool dir, kind relative", async () => {
      const { idx, lookup } = spiedIndex();
      const res = await resolveMentionTagged("src/a.ts", {
        cwd,
        recover: true,
        toolCwd: "packages/client",
        fuzzyIndex: idx,
      });
      expect(res).toEqual({
        state: "found",
        resolved: path.join(cwd, "packages", "client", "src", "a.ts"),
        kind: "relative",
        via: "tool-dir",
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("an exact hit is `found` with no via, even with recover on", async () => {
      await put("src/own.ts");
      const res = await resolveMentionTagged("src/own.ts", { cwd, recover: true });
      expect(res).toEqual({ state: "found", resolved: path.join(cwd, "src", "own.ts"), kind: "relative" });
    });

    it("absolute and tilde mentions keep their kind and never take the tool dir", async () => {
      await put("src/own.ts");
      const abs = await resolveMentionTagged(path.join(cwd, "src", "own.ts"), { cwd, recover: true, toolCwd: "packages" });
      expect(abs).toEqual({ state: "found", resolved: path.join(cwd, "src", "own.ts"), kind: "abs" });
      await fsp.mkdir(path.join(home, ".pi"), { recursive: true });
      await fsp.writeFile(path.join(home, ".pi", "s.json"), "{}");
      const tilde = await resolveMentionTagged("~/.pi/s.json", { cwd, recover: true });
      expect(tilde).toEqual({ state: "found", resolved: path.join(home, ".pi", "s.json"), kind: "tilde" });
    });
  });

  // E13 — tool dir + cwd candidates
  describe("producing tool's working directory (E13)", () => {
    it("(a) only the tool-dir copy exists → found there", async () => {
      await put("packages/client/src/a.ts");
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, toolCwd: "packages/client" });
      expect(res).toMatchObject({ state: "found", via: "tool-dir", resolved: path.join(cwd, "packages/client/src/a.ts") });
    });

    it("(b) both exist → ambiguous, tool-dir candidate first", async () => {
      await put("packages/client/src/a.ts");
      await put("src/a.ts");
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, toolCwd: "packages/client" });
      expect(res).toEqual({
        state: "ambiguous",
        resolved: null,
        candidates: [path.join(cwd, "packages/client/src/a.ts"), path.join(cwd, "src/a.ts")],
      });
    });

    it("(c) toolCwd `.` equal to cwd → found, never ambiguous", async () => {
      await put("src/a.ts");
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, toolCwd: "." });
      expect(res).toMatchObject({ state: "found", resolved: path.join(cwd, "src/a.ts") });
      expect(res).not.toHaveProperty("candidates");
    });

    it("(c') toolCwd spelled as the absolute cwd → found, never ambiguous", async () => {
      await put("src/a.ts");
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, toolCwd: cwd });
      expect(res.state).toBe("found");
    });

    it("(d) toolCwd = a symlink to cwd → realpath dedupe → found", async () => {
      await put("src/a.ts");
      await fsp.symlink(cwd, path.join(cwd, "selflink"));
      const res = await resolveMentionTagged("src/a.ts", { cwd, recover: true, toolCwd: "selflink" });
      expect(res.state).toBe("found");
      expect(res).not.toHaveProperty("candidates");
    });
  });

  // E14 — out-of-scope tool dir and traversal
  describe("tool dir out of scope / traversal (E14)", () => {
    it("toolCwd `/etc` is ignored: no stat under /etc, result equals the no-toolCwd result", async () => {
      const without = await resolveMentionTagged("hosts.conf", { cwd, recover: true });
      const statSpy = vi.spyOn(fs, "stat");
      const withDir = await resolveMentionTagged("hosts.conf", { cwd, recover: true, toolCwd: "/etc" });
      expect(statCalls(statSpy).filter((p) => ETC.test(p))).toEqual([]);
      expect(withDir).toEqual(without);
      expect(withDir.state).not.toBe("gated");
    });

    it("a traversal out of the tool dir is never statted and equals the no-toolCwd result", async () => {
      await put("packages/client/keep.txt");
      const mention = "../../../etc/x.conf";
      const without = await resolveMentionTagged(mention, { cwd, recover: true });
      const statSpy = vi.spyOn(fs, "stat");
      const withDir = await resolveMentionTagged(mention, { cwd, recover: true, toolCwd: "packages/client" });
      expect(statSpy).not.toHaveBeenCalled();
      expect(withDir).toEqual(without);
    });

    it("an in-repo symlink to /etc as the tool dir is never statted through", async () => {
      await fsp.symlink("/etc", path.join(cwd, "etclink"));
      const without = await resolveMentionTagged("hosts", { cwd, recover: true });
      const statSpy = vi.spyOn(fs, "stat");
      const withDir = await resolveMentionTagged("hosts", { cwd, recover: true, toolCwd: "etclink" });
      expect(statCalls(statSpy).filter((p) => ETC.test(p))).toEqual([]);
      expect(withDir).toEqual(without);
      expect(withDir.state).not.toBe("gated");
    });
  });

  // E16 — fuzzy decision table (tracked × on-disk)
  describe("fuzzy fallback (E16)", () => {
    it("1 tracked match on disk → recovered", async () => {
      await put("deep/dir/target.ts");
      track();
      const res = await resolveMentionTagged("target.ts", { cwd, recover: true });
      expect(res).toMatchObject({ state: "recovered", kind: "fuzzy", via: "fuzzy", resolved: path.join(cwd, "deep/dir/target.ts") });
    });

    it("1 tracked match deleted on disk → missing", async () => {
      await put("deep/dir/target.ts");
      track();
      await fsp.rm(path.join(cwd, "deep/dir/target.ts"));
      expect(await resolveMentionTagged("target.ts", { cwd, recover: true })).toEqual({ state: "missing", resolved: null });
    });

    it("3 tracked matches, 1 on disk → ambiguous with that single candidate (never auto-selected)", async () => {
      for (const d of ["a", "b", "c"]) await put(`${d}/tasks.md`);
      track();
      await fsp.rm(path.join(cwd, "a/tasks.md"));
      await fsp.rm(path.join(cwd, "c/tasks.md"));
      expect(await resolveMentionTagged("tasks.md", { cwd, recover: true })).toEqual({
        state: "ambiguous",
        resolved: null,
        candidates: [path.join(cwd, "b/tasks.md")],
      });
    });

    it("3 tracked matches, 0 on disk → missing", async () => {
      for (const d of ["a", "b", "c"]) await put(`${d}/tasks.md`);
      track();
      for (const d of ["a", "b", "c"]) await fsp.rm(path.join(cwd, `${d}/tasks.md`));
      expect((await resolveMentionTagged("tasks.md", { cwd, recover: true })).state).toBe("missing");
    });

    it("40 tracked matches, 12 on disk → ambiguous with ≤ 10 candidates and ≤ 25 stats", async () => {
      const dirs = Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, "0")}`);
      for (const d of dirs) await put(`${d}/tasks.md`);
      track();
      for (const d of dirs.slice(12)) await fsp.rm(path.join(cwd, `${d}/tasks.md`));
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveMentionTagged("tasks.md", { cwd, recover: true });
      expect(res.state).toBe("ambiguous");
      expect(res.candidates?.length).toBeLessThanOrEqual(10);
      expect(res.candidates?.length).toBeGreaterThan(0);
      expect(statSpy.mock.calls.length).toBeLessThanOrEqual(25 + 4); // 25 fuzzy + the exact-stage stats
    });

    it("a suffix matches only on a segment boundary (`a/b.ts` vs `xa/b.ts`)", async () => {
      await put("xa/b.ts");
      track();
      expect((await resolveMentionTagged("a/b.ts", { cwd, recover: true })).state).toBe("missing");
    });

    it("outside a git repo fuzzy is skipped and no git process is spawned", async () => {
      const exec = vi.fn();
      const idx = createMentionFuzzyIndex({ execFile: exec as never });
      const res = await resolveMentionTagged("target.ts", { cwd, recover: true, fuzzyIndex: idx });
      expect(res).toEqual({ state: "missing", resolved: null });
      expect(exec).not.toHaveBeenCalled();
    });

    it("an index failure still returns the exact result, no exception (X4)", async () => {
      await put("src/own.ts");
      track();
      const idx = createMentionFuzzyIndex({
        execFile: (async () => {
          throw new Error("git exploded");
        }) as never,
        log: () => undefined,
      });
      expect(await resolveMentionTagged("src/own.ts", { cwd, recover: true, fuzzyIndex: idx })).toMatchObject({ state: "found" });
      await expect(resolveMentionTagged("nope.ts", { cwd, recover: true, fuzzyIndex: idx })).resolves.toEqual({
        state: "missing",
        resolved: null,
      });
    });
  });

  // E17 — tracked symlink escaping scope
  describe("fuzzy symlink escape (E17)", () => {
    it("a tracked symlink to /etc/passwd is never statted through and is not recovered", async () => {
      await fsp.mkdir(path.join(cwd, "d"));
      await fsp.symlink("/etc/passwd", path.join(cwd, "d", "pw.conf"));
      track();
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveMentionTagged("pw.conf", { cwd, recover: true });
      expect(statCalls(statSpy).filter((p) => ETC.test(p))).toEqual([]);
      expect(res.state).not.toBe("recovered");
      expect(res.state).not.toBe("found");
    });
  });

  // E22 — worktree re-root, resolver half
  describe("re-rooted candidate (E22)", () => {
    it("(a) re-rooted copy present → found at the worktree copy", async () => {
      await put("wt/src/a.ts");
      const reRooted = path.join(cwd, "wt/src/a.ts");
      const res = await resolveMentionTagged(path.join(cwd, "src/a.ts"), { cwd, recover: true, reRooted });
      expect(res).toEqual({ state: "found", resolved: reRooted, kind: "abs" });
    });

    it("(b) re-rooted copy absent → the original mention decides", async () => {
      await put("src/a.ts");
      const res = await resolveMentionTagged(path.join(cwd, "src/a.ts"), {
        cwd,
        recover: true,
        reRooted: path.join(cwd, "wt/src/a.ts"),
      });
      expect(res).toEqual({ state: "found", resolved: path.join(cwd, "src/a.ts"), kind: "abs" });
    });

    it("(c) re-rooted `/etc/passwd` is never statted and falls through to the original", async () => {
      await put("src/a.ts");
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveMentionTagged(path.join(cwd, "src/a.ts"), { cwd, recover: true, reRooted: "/etc/passwd" });
      expect(statCalls(statSpy).filter((p) => ETC.test(p))).toEqual([]);
      expect(res).toEqual({ state: "found", resolved: path.join(cwd, "src/a.ts"), kind: "abs" });
    });
  });

  // E19 — gated
  describe("out-of-scope → gated (E19)", () => {
    it("an out-of-scope mention is `gated` with the normalised path and no stat", async () => {
      const statSpy = vi.spyOn(fs, "stat");
      const res = await resolveMentionTagged("~/Downloads/a.md", { cwd, recover: true });
      expect(res).toEqual({ state: "gated", resolved: path.join(home, "Downloads", "a.md"), kind: "tilde", outside: true });
      expect(statSpy).not.toHaveBeenCalled();
    });

    it("the legacy `resolveFileMention` shape is untouched by the new pipeline", async () => {
      await put("real.ts");
      expect(await resolveFileMention("real.ts", { cwd })).toEqual({ resolved: path.join(cwd, "real.ts"), kind: "relative" });
      expect(await resolveFileMention("nope.ts", { cwd })).toBeNull();
    });
  });
});
