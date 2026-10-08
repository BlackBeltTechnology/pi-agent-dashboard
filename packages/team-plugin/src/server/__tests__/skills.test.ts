/**
 * Skill catalog: normalisation, allowed predicate, managed CRUD, path
 * validation, listings, impact preview, agents skillBlock + ensure parity
 * (test-plan E1–E14, E16–E19, X3, X6). See change: add-team-skill-access.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowed } from "../skills-service.js";
import type { TeamConfig } from "../types.js";
import { API, type Harness, makeHarness, persona } from "./harness.js";

let h: Harness;
afterEach(async () => h?.close());

const ADMIN = { iss: "https://iss", sub: "root" };
const enc = encodeURIComponent;
const admin = (method: string, url: string, body?: unknown) => h.call(method, url, { user: "root", body });

async function mkPersona(user: string, slug: string, extra: Record<string, unknown> = {}) {
  const r = await h.call("POST", `${API}/personas`, { user, body: persona(slug, extra) });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.key as string;
}
const create = (user: string, key: string, t = "_ws") => h.call("POST", `${API}/agents/${enc(key)}/conversations?project=${t}`, { user });
const ensure = (user: string, key: string, c: string, t = "_ws") =>
  h.call("POST", `${API}/agents/${enc(key)}/conversations/${c}/session?project=${t}`, { user });

/** Skill dir under `<tmp>/skills/<name>` with a SKILL.md (frontmatter name defaults to the dir name). */
function skillDir(name: string, o: { fm?: string; body?: string } = {}): string {
  const dir = h.dir(path.join("skills", name));
  const fm = o.fm ?? `name: ${name}\ndescription: ${name} desc`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${fm}\n---\n\n${o.body ?? `${name} body`}\n`);
  return dir;
}
const managedFile = () => path.join(h.home, "skills.json");
const ukOf = async (user: string) => (await h.call("GET", `${API}/me`, { user })).json.uk as string;

/** Absolute path of exactly `total` bytes under tmp, ending in a dir with SKILL.md `<name>`. */
function deepSkillPath(total: number, name: string): string {
  const base = h.tmp;
  const parts: string[] = [];
  let remaining = total - Buffer.byteLength(base, "utf8");
  while (remaining - 1 > 255) {
    parts.push(`d${"x".repeat(254)}`);
    remaining -= 256;
  }
  parts.push(`d${"x".repeat(remaining - 2)}`);
  const p = [base, ...parts].join("/");
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
  expect(Buffer.byteLength(p, "utf8")).toBe(total);
  return p;
}

/** True when the filesystem is case-insensitive: a mis-cased path of an existing file still stats (audit F1). */
const CASE_INSENSITIVE_FS = (() => {
  const probe = path.join(fs.realpathSync(os.tmpdir()), `team-case-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, "x");
    return fs.statSync(probe.toUpperCase()).isFile();
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { force: true });
  }
})();

describe("audit F1: case-insensitive filesystem bypass", () => {
  it.runIf(CASE_INSENSITIVE_FS)("a mis-cased path inside a project is rejected as protected_dir", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const billing = h.dir(path.join("billing"));
    config.projects = { billing: { name: "B", path: billing, users: "*" } };
    const inside = h.dir(path.join("billing", "sub", "review"));
    fs.writeFileSync(path.join(inside, "SKILL.md"), "---\nname: review\n---\nbody\n");
    // Mis-case the PROJECT segment the root is compared against: the typed path resolves on a
    // case-insensitive FS but no longer matches the project root's canonical case lexically.
    const misCased = inside.replace(`${path.sep}billing${path.sep}`, `${path.sep}BILLING${path.sep}`);
    expect(misCased).not.toBe(inside);
    expect(fs.existsSync(misCased)).toBe(true);

    const r = await admin("POST", `${API}/skills`, { name: "review", path: misCased });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json).toMatchObject({ error: "invalid_skill", fields: { path: "protected_dir" } });
  });

  it.runIf(CASE_INSENSITIVE_FS)("a mis-cased path inside the team home is rejected", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    fs.mkdirSync(path.join(h.home, "inhome"), { recursive: true });
    fs.writeFileSync(path.join(h.home, "inhome", "SKILL.md"), "x");
    const misCased = path.join(path.dirname(h.home), path.basename(h.home).toUpperCase(), "inhome");
    expect(misCased).not.toBe(path.join(h.home, "inhome"));
    expect(fs.existsSync(misCased)).toBe(true);

    const r = await admin("POST", `${API}/skills`, { name: "review", path: misCased });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json.fields.path).toBe("protected_dir");
  });
});

describe("audit F2: symlinked SKILL.md", () => {
  it("a SKILL.md symlinked to a regular file outside the root is rejected", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const dir = skillDir("symfile");
    const outside = path.join(h.tmp, "outside.md");
    fs.writeFileSync(outside, "---\nname: review\n---\nbody\n");
    fs.rmSync(path.join(dir, "SKILL.md"));
    fs.symlinkSync(outside, path.join(dir, "SKILL.md"));

    const r = await admin("POST", `${API}/skills`, { name: "review", path: dir });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json.fields.path).toBe("no_skill_md");
  });
});

describe("audit F6: SKILL.md read cap + frontmatter memo", () => {
  it("frontmatter comes from the first 8 KiB only — a description beyond the cap is not read", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const near = h.dir("skills/near");
    // "description:" starts at byte 8012 — inside the 8 KiB head.
    fs.writeFileSync(path.join(near, "SKILL.md"), `---\nname: near\n${"x".repeat(8000)}\ndescription: near desc\n---\nbody\n`);
    const far = h.dir("skills/far");
    // "name: far\n" is 10 bytes + 8182 pad + newline ⇒ "description:" starts at byte 8193 — past the head.
    fs.writeFileSync(path.join(far, "SKILL.md"), `---\nname: far\n${"x".repeat(8182)}\ndescription: far desc\n---\nbody\n`);
    config.skillCatalog = { near, far };

    const rows = (await admin("GET", `${API}/skills`)).json.skills as Array<{ name: string; description?: string }>;
    expect(rows.find((r) => r.name === "near")?.description).toBe("near desc");
    expect(rows.find((r) => r.name === "far")?.description).toBe("");
  });

  it("the memo saves the read: a second listing opens no SKILL.md (same mtimeMs/size)", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    config.skillCatalog = { review: skillDir("review"), solo: skillDir("solo") };
    const open = vi.spyOn(fs, "openSync");
    try {
      await admin("GET", `${API}/skills`);
      const first = open.mock.calls.filter(([p]) => String(p).endsWith("SKILL.md"));
      expect(first.length).toBeGreaterThan(0);
      open.mockClear();

      await admin("GET", `${API}/skills`);
      expect(open.mock.calls.filter(([p]) => String(p).endsWith("SKILL.md"))).toHaveLength(0);
    } finally {
      open.mockRestore();
    }
  });
});

describe("normalisation (E1, E2)", () => {
  it("legacy string and missing users/targets read as *", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const d1 = skillDir("review");
    const d2 = skillDir("objskill");
    config.skillCatalog = { review: d1, objskill: { path: d2 } };
    const rows = (await admin("GET", `${API}/skills`)).json.skills as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.name === "review")).toMatchObject({ source: "config", path: d1, users: "*", targets: "*", valid: true, description: "review desc" });
    expect(rows.find((r) => r.name === "objskill")).toMatchObject({ source: "config", path: d2, users: "*", targets: "*", valid: true });
  });
});

describe("allowed predicate (E3, E4)", () => {
  it("E3: mode × users × targets decision table (12 combos)", () => {
    const alice = { uk: "a", iss: "i", sub: "alice", admin: false };
    const usersCases = [
      ["all", "*"],
      ["match", [{ iss: "i", sub: "alice" }]],
      ["omit", [{ iss: "i", sub: "bob" }]],
    ] as const;
    const targetCases = [
      ["all", "*"],
      ["match", ["billing"]],
      ["omit", ["crm"]],
    ] as const;
    for (const mode of ["single", "multi"] as const) {
      for (const [ulabel, users] of usersCases) {
        for (const [tlabel, targets] of targetCases) {
          const expected = (mode === "single" || ulabel !== "omit") && tlabel !== "omit";
          expect(allowed({ users, targets } as never, alice, "billing", mode), `${mode}/${ulabel}/${tlabel}`).toBe(expected);
        }
      }
    }
  });

  it("E4: principals match exactly (iss and sub)", () => {
    const caller = { uk: "a", iss: "https://idp", sub: "alice", admin: false };
    expect(allowed({ users: [{ iss: "https://idp", sub: "Alice" }], targets: "*" }, caller, "_ws", "multi")).toBe(false);
    expect(allowed({ users: [{ iss: "https://other", sub: "alice" }], targets: "*" }, caller, "_ws", "multi")).toBe(false);
    expect(allowed({ users: [{ iss: "https://idp", sub: "alice" }], targets: "*" }, caller, "_ws", "multi")).toBe(true);
  });
});

describe("managed CRUD (E5–E9, E12, E13, X3)", () => {
  it("E5: name must match the skill's own pi name; file unchanged on refusal", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const dir = h.dir("skills/wrong");
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: code-review\n---\nbody\n");
    const r = await admin("POST", `${API}/skills`, { name: "review", path: dir });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "invalid_skill", fields: { name: "name_mismatch" } });
    expect(fs.existsSync(managedFile())).toBe(false);
  });

  it("E6: directory-name fallback when SKILL.md has no frontmatter name", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const dir = h.dir("skills/review");
    fs.writeFileSync(path.join(dir, "SKILL.md"), "just body text, no frontmatter\n");
    expect((await admin("POST", `${API}/skills`, { name: "review", path: dir })).status).toBe(201);
  });

  it("E7: pi name rule boundaries", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    for (const n of ["a", "a".repeat(64)]) {
      const r = await admin("POST", `${API}/skills`, { name: n, path: skillDir(n) });
      expect(r.status, n.length.toString()).toBe(201);
    }
    for (const n of ["a".repeat(65), "-a", "a-", "a--b", "A", "a:b"]) {
      const r = await admin("POST", `${API}/skills`, { name: n, path: h.tmp });
      expect(r.status, n).toBe(400);
      expect(r.json.error).toBe("invalid_skill");
    }
  });

  it("E8: path length and absolute boundaries", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    expect((await admin("POST", `${API}/skills`, { name: "review", path: deepSkillPath(512, "review") })).status).toBe(201);
    const long = await admin("POST", `${API}/skills`, { name: "review2", path: deepSkillPath(513, "review2") });
    expect(long.status).toBe(400);
    expect(long.json.fields.path).toBe("too_long");
    const rel = await admin("POST", `${API}/skills`, { name: "review3", path: "skills/review" });
    expect(rel.status).toBe(400);
    expect(rel.json.fields.path).toBe("not_absolute");
  });

  it("E9: single-file skills and non-SKILL.md dirs are refused", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const file = path.join(h.tmp, "single.md");
    fs.writeFileSync(file, "x");
    expect((await admin("POST", `${API}/skills`, { name: "review", path: file })).status).toBe(400);
    expect((await admin("POST", `${API}/skills`, { name: "noskill", path: h.dir("skills/noskill") })).status).toBe(400);
    const dir = skillDir("symdir");
    fs.rmSync(path.join(dir, "SKILL.md"));
    fs.symlinkSync(h.dir("skills/otherdir"), path.join(dir, "SKILL.md"));
    expect((await admin("POST", `${API}/skills`, { name: "symdir", path: dir })).status).toBe(400);
  });

  it("E10: bidirectional path exclusion", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const billing = h.dir("billing");
    config.projects = { billing: { name: "B", path: billing, users: "*" } };
    // Existence first, so ~/.pi and ~/.pi/dashboard resolve through realpath below.
    const agentSkill = path.join(os.homedir(), ".pi", "agent", "skills", "review");
    fs.mkdirSync(agentSkill, { recursive: true });
    fs.writeFileSync(path.join(agentSkill, "SKILL.md"), "---\nname: review\n---\nbody\n");
    const dash = path.join(os.homedir(), ".pi", "dashboard");
    fs.mkdirSync(dash, { recursive: true });
    fs.writeFileSync(path.join(dash, "SKILL.md"), "---\nname: review\n---\nbody\n");
    const post = (p: string) => admin("POST", `${API}/skills`, { name: "review", path: p });

    fs.mkdirSync(path.join(h.home, "inhome"), { recursive: true });
    fs.writeFileSync(path.join(h.home, "inhome", "SKILL.md"), "x");
    expect((await post(path.join(h.home, "inhome"))).status, "inside team home").toBe(400);
    fs.mkdirSync(path.join(billing, "review"), { recursive: true });
    fs.writeFileSync(path.join(billing, "review", "SKILL.md"), "x");
    expect((await post(path.join(billing, "review"))).status, "inside project").toBe(400);
    fs.writeFileSync(path.join(billing, "SKILL.md"), "x");
    expect((await post(billing)).status, "equal to project").toBe(400);
    fs.writeFileSync(path.join(h.tmp, "SKILL.md"), "x");
    expect((await post(h.tmp)).status, "ancestor of project + team home").toBe(400);
    expect((await post(path.join(os.homedir(), ".pi"))).status, "contains agent dir + sessions root").toBe(400);
    expect((await post(dash)).status, "equal to dashboard home").toBe(400);
    expect((await post(agentSkill)).status, "inside agent dir stays valid").toBe(201);
  });

  it("review B1: a partial PATCH keeps the omitted users/targets (never widens to \"*\")", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const dir = skillDir("review");
    const bob = { iss: "https://iss", sub: "bob" };
    expect((await admin("POST", `${API}/skills`, { name: "review", path: dir, users: [bob], targets: ["billing"] })).status).toBe(201);
    const t = await admin("PATCH", `${API}/skills/review`, { targets: ["crm"] });
    expect(t.status, JSON.stringify(t.json)).toBe(200);
    const u = await admin("PATCH", `${API}/skills/review`, { users: [bob, { iss: "https://iss", sub: "carol" }] });
    expect(u.status).toBe(200);
    const stored = JSON.parse(fs.readFileSync(managedFile(), "utf8")).skills.find((e: { name: string }) => e.name === "review");
    expect(stored.users).toEqual([bob, { iss: "https://iss", sub: "carol" }]);
    expect(stored.targets).toEqual(["crm"]); // the second PATCH did not reset targets either
  });

  it("E12: config vs managed decision table", async () => {
    // config only: read-only
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const d1 = skillDir("review");
    config.skillCatalog = { review: d1 };
    expect((await admin("PATCH", `${API}/skills/review`, { targets: "*" })).status).toBe(409);
    expect((await admin("DELETE", `${API}/skills/review`)).json.error).toBe("skill_readonly");
    expect((await admin("POST", `${API}/skills`, { name: "review", path: d1 })).json.error).toBe("skill_exists");
    await h.close();

    // managed only: editable + removable
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const d2 = skillDir("solo");
    expect((await admin("POST", `${API}/skills`, { name: "solo", path: d2 })).status).toBe(201);
    expect((await admin("PATCH", `${API}/skills/solo`, { targets: ["billing"] })).status).toBe(200);
    expect((await admin("DELETE", `${API}/skills/solo`)).status).toBe(200);
    await h.close();

    // both sources: config wins, managed row shadowed
    const config2: TeamConfig = { admins: [ADMIN], skillCatalog: {} };
    h = await makeHarness({ config: config2 });
    const d3 = skillDir("both");
    config2.skillCatalog = { both: d3 };
    const d4 = skillDir("both-managed");
    fs.mkdirSync(h.home, { recursive: true });
    fs.writeFileSync(
      managedFile(),
      JSON.stringify({ schemaVersion: 1, skills: [{ name: "both", path: d4, users: "*", targets: "*", createdAt: "", createdBy: "x", updatedAt: "", updatedBy: "x" }] }),
    );
    const rows = (await admin("GET", `${API}/skills`)).json.skills as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.source === "config")).toMatchObject({ name: "both", valid: true });
    expect(rows.find((r) => r.source === "managed")).toMatchObject({ name: "both", valid: false, invalidReason: "shadowed_by_config" });
    expect((await admin("POST", `${API}/skills`, { name: "both", path: d3 })).json.error).toBe("skill_exists");
    await h.close();

    // non-admin refused in multi; operator allowed in single
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const d5 = skillDir("mine");
    expect((await h.call("POST", `${API}/skills`, { user: "alice", body: { name: "mine", path: d5 } })).status).toBe(403);
    expect((await admin("POST", `${API}/skills`, { name: "mine", path: d5 })).status).toBe(201);
    expect((await h.call("PATCH", `${API}/skills/mine`, { user: "alice", body: {} })).status).toBe(403);
    expect((await h.call("DELETE", `${API}/skills/mine`, { user: "alice" })).status).toBe(403);
    await h.close();
    h = await makeHarness({ mode: "single" });
    const d6 = skillDir("opskill");
    expect((await h.call("POST", `${API}/skills`, { body: { name: "opskill", path: d6 } })).status).toBe(201);
  });

  it("E13: bad skills.json — plugin runs, listing reports it, writes refused, bytes unchanged", async () => {
    for (const content of [JSON.stringify({ schemaVersion: 2, skills: [] }), '{"schemaVersion": 1, "skills": [']) {
      h = await makeHarness({ config: { admins: [ADMIN] } });
      const dir = skillDir("review");
      fs.mkdirSync(h.home, { recursive: true });
      fs.writeFileSync(managedFile(), content);
      const before = fs.readFileSync(managedFile(), "utf8");
      expect((await h.call("GET", `${API}/me`, { user: "root" })).status).toBe(200);
      expect((await admin("GET", `${API}/skills`)).json.managedLoadError).toBeTruthy();
      const p = await admin("POST", `${API}/skills`, { name: "review", path: dir });
      expect(p.status).toBe(503);
      expect(p.json.error).toBe("skill_store_unavailable");
      expect((await admin("PATCH", `${API}/skills/review`, {})).status).toBe(503);
      expect((await admin("DELETE", `${API}/skills/review`)).status).toBe(503);
      expect(fs.readFileSync(managedFile(), "utf8")).toBe(before);
      await h.close();
    }
  });

  it("X3: concurrent creates give one 201 and one 409", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const dir = skillDir("review");
    const [r1, r2] = await Promise.all([
      admin("POST", `${API}/skills`, { name: "review", path: dir }),
      admin("POST", `${API}/skills`, { name: "review", path: dir }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(JSON.parse(fs.readFileSync(managedFile(), "utf8")).skills).toHaveLength(1);
  });
});

describe("listings (E14, E16)", () => {
  it("E14: caller-scoped listing and /me; admin rows carry source/valid/usage", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    config.projects = {
      billing: { name: "B", path: h.dir("billing"), users: "*" },
      crm: { name: "C", path: h.dir("crm"), users: [{ iss: "https://iss", sub: "nobody" }] },
    };
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review"), targets: ["crm"] });
    const aliceSkills = (await h.call("GET", `${API}/skills`, { user: "alice" })).json.skills as Array<{ name: string }>;
    expect(aliceSkills.map((s) => s.name)).not.toContain("review");
    expect((await h.call("GET", `${API}/me`, { user: "alice" })).json.skills).not.toContain("review");
    const row = (await admin("GET", `${API}/skills`)).json.skills.find((s: { name: string }) => s.name === "review");
    expect(row).toMatchObject({ source: "managed", valid: true, path: path.join(h.tmp, "skills", "review") });
    expect(typeof row.usage.personas).toBe("number");
    expect(typeof row.usage.liveSessions).toBe("number");
  });

  it("E16: /skills/available — admin only, [] without the host service", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    expect((await admin("GET", `${API}/skills/available`)).json).toEqual({ skills: [] });
    expect((await h.call("GET", `${API}/skills/available`, { user: "alice" })).status).toBe(403);
    await h.close();
    h = await makeHarness({
      config: { admins: [ADMIN] },
      listOperatorSkills: async () => [{ name: "g1", description: "d", path: "/p", source: "global" }],
    });
    expect((await admin("GET", `${API}/skills/available`)).json.skills).toEqual([{ name: "g1", description: "d", path: "/p", source: "global" }]);
  });
});

describe("impact preview (E17)", () => {
  it("narrowing / removing end 2 sessions and block the persona; widening ends nothing; dry run", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    config.projects = {
      billing: { name: "B", path: h.dir("billing"), users: "*" },
      crm: { name: "C", path: h.dir("crm"), users: "*" },
    };
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review"), targets: "*" });
    const p1 = await admin("POST", `${API}/personas`, { ...persona("p1"), scope: "shared", projects: ["billing", "crm"], skills: ["review"] });
    expect(p1.status).toBe(201);
    expect((await create("alice", "shared:p1", "billing")).status).toBe(201);
    expect((await create("bob", "shared:p1", "billing")).status).toBe(201);
    expect((await admin("PATCH", `${API}/skills/review`, { targets: ["billing"] })).status).toBe(200);
    expect((await h.call("POST", `${API}/personas`, { user: "carol", body: persona("carol-p", { projects: ["billing"], skills: ["review"] }) })).status).toBe(201);

    const dry = async (body: Record<string, unknown>) => admin("POST", `${API}/skills/review/impact`, body);
    const bytes = fs.existsSync(managedFile()) ? fs.readFileSync(managedFile(), "utf8") : null;
    const abortsBefore = h.host.aborts.length;

    const narrow = await dry({ targets: ["crm"] });
    expect(narrow.status).toBe(200);
    expect(narrow.json).toMatchObject({ endSessions: 2, otherUsersPrivate: 1 });
    expect(narrow.json.blockedPersonas).toEqual([{ key: "shared:p1", name: "p1", lostTargets: ["billing"] }]);

    const remove = await dry({ remove: true });
    expect(remove.json).toMatchObject({ endSessions: 2, otherUsersPrivate: 1 });
    expect(remove.json.blockedPersonas).toEqual([{ key: "shared:p1", name: "p1", lostTargets: ["billing"] }]);

    const widen = await dry({ targets: ["billing", "crm"] });
    expect(widen.json).toEqual({ endSessions: 0, blockedPersonas: [], otherUsersPrivate: 0 });

    expect(fs.existsSync(managedFile()) ? fs.readFileSync(managedFile(), "utf8") : null).toBe(bytes);
    expect(h.host.aborts.length).toBe(abortsBefore);
    for (const s of h.host.sessions.values()) expect(s.status).not.toBe("ended");
  });
});

describe("agents skillBlock + ensure parity (E18, E19)", () => {
  async function fixture(mode: "invalid" | "missing" | "users" | "targets") {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    await admin("POST", `${API}/skills`, { name: "review", path: skillDir("review") });
    const legacyDir = skillDir("legacy");
    if (mode === "invalid") config.skillCatalog = { legacy: legacyDir };
    else if (mode === "missing") await admin("POST", `${API}/skills`, { name: "legacy", path: legacyDir });
    else if (mode === "users") await admin("POST", `${API}/skills`, { name: "legacy", path: legacyDir, users: "*" });
    else await admin("POST", `${API}/skills`, { name: "legacy", path: legacyDir, targets: "*" });

    const key = await mkPersona("alice", "w", { skills: ["review", "legacy"] });
    const c = await create("alice", key);
    expect(c.status).toBe(201);

    if (mode === "invalid") config.skillCatalog = { legacy: h.dir("skills/broken") };
    else if (mode === "missing") expect((await admin("DELETE", `${API}/skills/legacy`)).status).toBe(200);
    else if (mode === "users") expect((await admin("PATCH", `${API}/skills/legacy`, { users: [{ iss: "https://iss", sub: "bob" }] })).status).toBe(200);
    else expect((await admin("PATCH", `${API}/skills/legacy`, { targets: ["crm"] })).status).toBe(200);

    const reason = mode === "invalid" ? "invalid" : mode;
    const item = (await h.call("GET", `${API}/agents?project=_ws`, { user: "alice" })).json.agents.find((a: { key: string }) => a.key === key);
    expect(item.skillBlock).toEqual({ skill: "legacy", reason });
    expect(item.effectiveSkills).toEqual(["review"]);
    expect(item.status).toBe("unavailable");
    expect(JSON.stringify(item)).not.toContain(legacyDir);

    const e = await ensure("alice", key, c.json.id);
    expect(e.status).toBe(409);
    expect(e.json).toMatchObject({ error: "skill_not_allowed", skill: item.skillBlock.skill, reason: item.skillBlock.reason });
    await h.close();
  }

  it("invalid path / missing / users-denied / targets-denied; 409 equals skillBlock (E18, E19)", async () => {
    for (const mode of ["invalid", "missing", "users", "targets"] as const) await fixture(mode);
  });
});

describe("observability (X6)", () => {
  it("refusal, catalog write and invalidation lines; no paths or skill text", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] }, onManagedWrite: async () => 2 });
    const body = "VERYSECRET Skill body text";
    const dir2 = skillDir("review", { body });
    await admin("POST", `${API}/skills`, { name: "review", path: dir2 });
    const key = await mkPersona("alice", "w", { skills: ["review"] });
    expect((await admin("PATCH", `${API}/skills/review`, { targets: ["crm"] })).status).toBe(200);
    const r = await create("alice", key);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "skill_not_allowed", skill: "review", reason: "targets" });

    const rootUk = await ukOf("root");
    expect(h.logs.some((l) => l.includes("team.skill_write") && l.includes("op=update") && l.includes("name=review") && l.includes(`by=${rootUk}`))).toBe(true);
    expect(h.logs.some((l) => l.includes("team.skill_not_allowed") && l.includes("name=review") && l.includes("reason=targets"))).toBe(true);
    expect(h.logs.some((l) => l.includes("team.skill_invalidated") && l.includes("name=review") && l.includes("sessions=2"))).toBe(true);
    expect(h.logs.every((l) => !l.includes(dir2) && !l.includes(body) && !l.includes("VERYSECRET"))).toBe(true);
  });
});
