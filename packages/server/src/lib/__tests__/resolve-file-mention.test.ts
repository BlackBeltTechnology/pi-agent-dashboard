/**
 * Unit tests for `resolveFileMention` — the lazy server-side mention resolver.
 *
 * Fake-HOME harness: `$HOME` is repointed at a tmp dir so `~/.pi/…` mentions
 * resolve under a controlled home without touching the developer's real home.
 * Containment + tilde-expansion + containment-before-stat are the load-bearing
 * behaviors (design D2/D7). See change: server-side-file-mention-resolution.
 */

import fsp from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as accessGrants from "../../access/access-grants.js";
import { resolveFileMention } from "../resolve-file-mention.js";

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
