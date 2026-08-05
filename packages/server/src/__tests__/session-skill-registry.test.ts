/**
 * Retention + join tests for the live skill provenance.
 * See change: fix-skill-discovery-parity (test-plan E15, E16, E17, X3, X4, X5).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinSkillProvenance, SessionCommandRegistry } from "../pi/session-skill-registry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-join-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function realSkill(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${name}.\n---\nBody`);
  return file;
}

function skill(name: string, filePath: string, enabled = true): PiResource {
  return { name, filePath, type: "skill", enabled };
}

function emptyScope() {
  return { extensions: [], skills: [], prompts: [], agents: [], themes: [] };
}

function result(parts: Partial<PiResourcesResult> = {}): PiResourcesResult {
  return { local: emptyScope(), global: emptyScope(), packages: [], ...parts };
}

function cmd(name: string, filePath?: string): CommandInfo {
  return { name, source: "skill", ...(filePath ? { path: filePath } : {}) };
}

describe("SessionCommandRegistry retention (4.1, X4)", () => {
  it("retains on receipt and replaces on a re-report carrying skills", () => {
    const reg = new SessionCommandRegistry();
    reg.retain("s1", [cmd("a", "/a.md")]);
    expect(reg.get("s1")?.map((c) => c.name)).toEqual(["a"]);

    reg.retain("s1", [cmd("b", "/b.md")]);
    expect(reg.get("s1")?.map((c) => c.name)).toEqual(["b"]);
  });

  it("never replaces a non-empty skill set with an empty one (C2 settling rule)", () => {
    const reg = new SessionCommandRegistry();
    reg.retain("s1", [cmd("a", "/a.md")]);

    reg.retain("s1", [{ name: "help", source: "builtin" }]); // mid-reload, no skills
    expect(reg.get("s1")?.map((c) => c.name)).toEqual(["a"]);

    reg.retain("s1", []); // fully empty
    expect(reg.get("s1")?.map((c) => c.name)).toEqual(["a"]);
  });

  it("records a session that reported a genuinely skill-less list", () => {
    const reg = new SessionCommandRegistry();
    reg.retain("s1", [{ name: "help", source: "builtin" }]);
    expect(reg.hasReported("s1")).toBe(true);
    expect(reg.get("s1")).toEqual([{ name: "help", source: "builtin" }]);
  });

  it("distinguishes never-reported from reported-empty", () => {
    const reg = new SessionCommandRegistry();
    expect(reg.hasReported("s1")).toBe(false);
    reg.retain("s1", []);
    expect(reg.hasReported("s1")).toBe(true);
  });

  it("drops a session's retained list on removal", () => {
    const reg = new SessionCommandRegistry();
    reg.retain("s1", [cmd("a", "/a.md")]);
    reg.remove("s1");
    expect(reg.hasReported("s1")).toBe(false);
  });
});

describe("joinSkillProvenance statuses (4.2, E15)", () => {
  it("assigns active / not-loaded / loaded-elsewhere across the matrix", () => {
    const both = realSkill("both");
    const resolvedOnly = realSkill("resolved-only");
    const liveOnly = realSkill("live-only");

    const payload = result({
      local: { ...emptyScope(), skills: [skill("both", both), skill("resolved-only", resolvedOnly)] },
    });

    const joined = joinSkillProvenance(payload, [
      { sessionId: "s1", cwd: tmpDir, commands: [cmd("both", both), cmd("live-only", liveOnly)] },
    ]);

    const byName = new Map(joined.local.skills.map((s) => [s.name, s]));
    expect(byName.get("both")?.status).toBe("active");
    expect(byName.get("resolved-only")?.status).toBe("not-loaded");
    expect(byName.get("live-only")?.status).toBe("loaded-elsewhere");
    expect(byName.get("live-only")?.sessionPath).toBe(liveOnly);
    // no/no is simply absent
    expect(byName.has("nothing")).toBe(false);
  });

  it("identifies the contributing session and its working directory (4.7)", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(
      result({ local: { ...emptyScope(), skills: [skill("a", s)] } }),
      [{ sessionId: "s1", cwd: tmpDir, commands: [cmd("a", s)] }],
      tmpDir,
    );
    expect(joined.contributingSession).toEqual({ sessionId: "s1", cwd: tmpDir, differsFromFolder: false });
  });

  it("flags a session working directory that differs from the scanned folder (5.4)", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(
      result({ local: { ...emptyScope(), skills: [skill("a", s)] } }),
      [{ sessionId: "s1", cwd: path.join(tmpDir, "worktree"), commands: [cmd("a", s)] }],
      tmpDir,
    );
    expect(joined.contributingSession?.differsFromFolder).toBe(true);
  });

  it("joins paths that differ textually but share a realpath (4.3, E15)", () => {
    const target = realSkill("linked");
    const linkDir = path.join(tmpDir, "alias");
    fs.symlinkSync(path.dirname(target), linkDir);
    const aliasPath = path.join(linkDir, "SKILL.md");

    const joined = joinSkillProvenance(
      result({ local: { ...emptyScope(), skills: [skill("linked", target)] } }),
      [{ sessionId: "s1", cwd: tmpDir, commands: [cmd("linked", aliasPath)] }],
    );

    expect(joined.local.skills[0].status).toBe("active");
    expect(joined.local.skills.filter((s) => s.status === "loaded-elsewhere")).toEqual([]);
  });

  it("keeps two resolved skills sharing a name distinct (4.4, E17)", () => {
    const a = realSkill("copy-a");
    const b = realSkill("copy-b");
    const joined = joinSkillProvenance(
      result({ local: { ...emptyScope(), skills: [skill("release-revoke", a), skill("release-revoke", b)] } }),
      [{ sessionId: "s1", cwd: tmpDir, commands: [cmd("release-revoke", a)] }],
    );

    expect(joined.local.skills).toHaveLength(2);
    expect(joined.local.skills.map((s) => s.status).sort()).toEqual(["active", "not-loaded"]);
  });

  it("reports a disabled skill as disabled, never not-loaded (4.6, E16)", () => {
    const present = realSkill("present");
    const absent = realSkill("absent");

    const joined = joinSkillProvenance(
      result({
        local: {
          ...emptyScope(),
          skills: [skill("present", present, false), skill("absent", absent, false)],
        },
      }),
      [{ sessionId: "s1", cwd: tmpDir, commands: [cmd("present", present)] }],
    );

    for (const s of joined.local.skills) {
      expect(s.enabled).toBe(false);
      expect(s.status).toBeUndefined();
    }
  });

  it("joins skills contributed by package rows too", () => {
    const pkgSkill = realSkill("pkg-skill");
    const payload = result({
      packages: [
        {
          name: "pkg",
          source: "npm:pkg",
          scope: "local",
          resources: { ...emptyScope(), skills: [skill("pkg-skill", pkgSkill)] },
        },
      ],
    });
    const joined = joinSkillProvenance(payload, [
      { sessionId: "s1", cwd: tmpDir, commands: [cmd("pkg-skill", pkgSkill)] },
    ]);
    expect(joined.packages[0].resources.skills[0].status).toBe("active");
  });
});

describe("joinSkillProvenance scan-only and degraded (4.5, 4.6a, 4.6b, X3, X5)", () => {
  it("is scan-only with no not-loaded labels when nobody reported (4.5)", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(result({ local: { ...emptyScope(), skills: [skill("a", s)] } }), []);

    expect(joined.scanOnly).toBe(true);
    expect(joined.local.skills.every((k) => k.status === undefined)).toBe(true);
    expect(joined.contributingSession).toBeUndefined();
  });

  it("is scan-only when two sessions report for one folder (4.6a, X5)", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(result({ local: { ...emptyScope(), skills: [skill("a", s)] } }), [
      { sessionId: "s1", cwd: tmpDir, commands: [cmd("a", s)] },
      { sessionId: "s2", cwd: tmpDir, commands: [] },
    ]);

    expect(joined.scanOnly).toBe(true);
    expect(joined.local.skills.every((k) => k.status === undefined)).toBe(true);
  });

  it("reports path-less skill commands instead of flipping everything (4.6b, X3)", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(result({ local: { ...emptyScope(), skills: [skill("a", s)] } }), [
      { sessionId: "s1", cwd: tmpDir, commands: [cmd("a"), cmd("b")] },
    ]);

    expect(joined.pathlessCommands).toBe(true);
    expect(joined.scanOnly).toBe(true);
    expect(joined.local.skills.every((k) => k.status === undefined)).toBe(true);
  });

  it("labels every resolved skill not-loaded when the session genuinely loaded none", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(result({ local: { ...emptyScope(), skills: [skill("a", s)] } }), [
      { sessionId: "s1", cwd: tmpDir, commands: [{ name: "help", source: "builtin" }] },
    ]);

    expect(joined.scanOnly).toBeUndefined();
    expect(joined.local.skills[0].status).toBe("not-loaded");
  });

  it("assigns no status on a degraded payload", () => {
    const s = realSkill("a");
    const joined = joinSkillProvenance(
      result({ degraded: true, local: { ...emptyScope(), skills: [skill("a", s)] } }),
      [{ sessionId: "s1", cwd: tmpDir, commands: [cmd("a", s)] }],
    );

    expect(joined.degraded).toBe(true);
    expect(joined.local.skills[0].status).toBeUndefined();
  });
});
