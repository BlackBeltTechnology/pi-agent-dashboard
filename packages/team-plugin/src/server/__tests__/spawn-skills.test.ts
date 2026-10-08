/**
 * Spawn skill transport, composition refusal, epoch re-check and the
 * server-authority invalidation pass (tasks 5.1–5.3; test-plan E23–E25, X4,
 * X5, X2 server half). See change: add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
const list = (user: string, key: string, t = "_ws") => h.call("GET", `${API}/agents/${enc(key)}/conversations?project=${t}`, { user });
const ukOf = async (user: string) => (await h.call("GET", `${API}/me`, { user })).json.uk as string;

/** Skill dir under `<tmp>/skills/<name>` with a SKILL.md (frontmatter name defaults to the dir name). */
function skillDir(name: string): string {
  const dir = h.dir(path.join("skills", name));
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} desc\n---\n\n${name} body\n`);
  return dir;
}
const recordFile = (uk: string, key: string, t: string, c: string) =>
  path.join(h.home, "users", uk, "conversations", t, key.replace(":", "-"), `${c}.json`);

describe("spawn transport (E23, task 5.1)", () => {
  it("E23: every spawn sets --no-skills; skills travel as argv paths + a JSON-string guard policy", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const root = skillDir("review");
    config.skillCatalog = { review: root };
    const real = fs.realpathSync(root);

    const key = await mkPersona("alice", "w", { skills: ["review"] });
    expect((await create("alice", key)).status).toBe(201);
    const withSkill = h.host.spawns[0];
    expect(withSkill.scope?.noSkills).toBe(true);
    expect(withSkill.scope?.skills).toEqual([real]);
    expect(withSkill.scope?.extensionConfig?.team?.skills).toBe(JSON.stringify([{ name: "review", root: real }]));

    const plain = await mkPersona("alice", "plain");
    expect((await create("alice", plain)).status).toBe(201);
    const noSkill = h.host.spawns[1];
    expect(noSkill.scope?.noSkills).toBe(true);
    expect(noSkill.scope?.skills).toEqual([]);
    expect(noSkill.scope?.extensionConfig?.team?.skills).toBe("[]");
  });
});

describe("start check on every ensure path (E24, task 5.1)", () => {
  it("E24: a config-narrowed catalog ends the live session on reuse and refuses resume + create", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const root = skillDir("review");
    config.skillCatalog = { review: root };
    const key = await mkPersona("alice", "w", { skills: ["review"] });
    const c = (await create("alice", key)).json;
    const uk = await ukOf("alice");
    const file = recordFile(uk, key, "_ws", c.id);
    const before = fs.readFileSync(file, "utf8");

    // config edit: the entry's path turns invalid (no change notification — D6 catches it at the next open)
    config.skillCatalog = { review: path.join(h.tmp, "skills", "gone") };
    const spawns = h.host.spawns.length;

    // reuse: the live session is ended, then 409
    const r1 = await ensure("alice", key, c.id);
    expect(r1.status).toBe(409);
    expect(r1.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "invalid" });
    expect(h.host.aborts.at(-1)).toEqual({ sessionId: c.sessionId, graceful: true });
    expect(h.host.spawns.length).toBe(spawns);
    expect(fs.readFileSync(file, "utf8")).toBe(before); // record unchanged

    // resume: refused before any spawn
    const sess = h.host.sessions.get(c.sessionId);
    if (sess) sess.status = "ended";
    const r2 = await ensure("alice", key, c.id);
    expect(r2.status).toBe(409);
    expect(r2.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "invalid" });
    expect(h.host.spawns.length).toBe(spawns);

    // create: refused
    const r3 = await create("alice", key);
    expect(r3.status).toBe(409);
    expect(r3.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "invalid" });
    expect(h.host.spawns.length).toBe(spawns);
  });
});

describe("cwd-policy composition (E25, task 5.1)", () => {
  it("E25: a host cwd floor that narrows (or forces) the skill set refuses the start", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    let floor: string[] | undefined = [];
    h = await makeHarness({ config, resolveCwdPolicy: () => (floor === undefined ? undefined : { skills: floor }) });
    const root = skillDir("review");
    const real = fs.realpathSync(root);
    config.skillCatalog = { review: root };

    // narrowing to [] refuses, logs, spawns nothing
    const key = await mkPersona("alice", "w", { skills: ["review"] });
    const r = await create("alice", key);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "invalid" });
    expect(h.host.spawns.length).toBe(0);
    expect(h.logs.some((l) => l.startsWith("team.skills_narrowed") && l.includes("name=review") && l.includes("requested=1") && l.includes("composed=0"))).toBe(true);

    // an empty floor over an empty requested set composes to the same set: spawns
    const plain = await mkPersona("alice", "plain");
    expect((await create("alice", plain)).status).toBe(201);

    // a non-empty floor over an empty requested set would FORCE skills in: refuse
    floor = [real];
    const r2 = await create("alice", plain);
    expect(r2.status).toBe(409);
    expect(r2.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "invalid" });

    // no floor (older host): spawns
    floor = undefined;
    expect((await create("alice", key)).status).toBe(201);
  });
});

describe("catalog epoch re-check (X4, task 5.2)", () => {
  it("X4: a managed revocation between the start check and correlation aborts the spawn", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const root = skillDir("review");
    expect((await admin("POST", `${API}/skills`, { name: "review", path: root })).status).toBe(201);
    const key = await mkPersona("alice", "w", { skills: ["review"] });

    h.host.behavior.delayMs = 150;
    const pending = create("alice", key);
    await new Promise((r) => setTimeout(r, 30));
    // revocation lands while the spawn is in flight; no record yet, so the pass itself finds nothing
    expect((await admin("PATCH", `${API}/skills/review`, { targets: ["crm"] })).status).toBe(200);
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "skill_not_allowed", skill: "review", reason: "targets" });
    expect(h.host.aborts.some((a) => a.sessionId === "sess-1" && a.graceful === false)).toBe(true);
    expect((await list("alice", key)).json.conversations).toEqual([]);

    // a widening that keeps the grant passes the same re-check
    h.host.behavior.delayMs = 0;
    expect((await admin("PATCH", `${API}/skills/review`, { targets: "*" })).status).toBe(200);
    expect((await create("alice", key)).status).toBe(201);
  });
});

describe("invalidation pass authority (X5, task 5.3)", () => {
  it("X5: admin-gated, owner-bound; misbound records are skipped; cross-user routes stay 404/403", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const root = skillDir("review");
    expect((await admin("POST", `${API}/skills`, { name: "review", path: root })).status).toBe(201);
    const ka = await mkPersona("alice", "wa", { skills: ["review"] });
    const kb = await mkPersona("bob", "wb", { skills: ["review"] });
    const ca = (await create("alice", ka)).json;
    const cb = (await create("bob", kb)).json;

    // misbind alice's record: the live session is mallory's, so the pass must skip it
    const sa = h.host.sessions.get(ca.sessionId);
    if (!sa) throw new Error("no session");
    sa.principalOwner = { iss: "https://iss", sub: "mallory" };
    const sb = h.host.sessions.get(cb.sessionId);
    if (!sb) throw new Error("no session");

    // non-admin cannot trigger the pass (403) and cannot reach alice's conversation (404)
    expect((await h.call("PATCH", `${API}/skills/review`, { user: "bob", body: { targets: ["crm"] } })).status).toBe(403);
    expect((await ensure("bob", ka, ca.id)).status).toBe(404);
    expect((await h.call("POST", `${API}/agents/${enc(ka)}/conversations/${ca.id}/restart?project=_ws`, { user: "bob" })).status).toBe(404);
    expect(h.host.aborts.length).toBe(0);
    expect(sa.status).not.toBe("ended");
    expect(sb.status).not.toBe("ended");

    // admin revocation (2xx) → the pass ends only bob's owner-bound session, non-gracefully
    expect((await admin("PATCH", `${API}/skills/review`, { targets: ["crm"] })).status).toBe(200);
    expect(sb.status).toBe("ended");
    expect(sa.status).not.toBe("ended");
    expect(h.host.aborts).toContainEqual({ sessionId: cb.sessionId, graceful: false });
    expect(h.host.aborts.some((a) => a.sessionId === ca.sessionId)).toBe(false);
    const ukB = await ukOf("bob");
    const ukR = await ukOf("root");
    expect(h.logs.some((l) => l.includes("team.skill_end") && l.includes("name=review") && l.includes(`uk=${ukB}`) && l.includes(`by=${ukR}`) && l.includes("t=_ws"))).toBe(true);
    expect(h.logs.some((l) => l.includes("team.skill_invalidated") && l.includes("name=review") && l.includes("sessions=1"))).toBe(true);
  });
});

describe("guard never ready (X2 server half, task 5.1)", () => {
  it("X2: no readiness on a resume spawn ⇒ 503 guard_unavailable, aborted, record unchanged", async () => {
    h = await makeHarness({ spawnTimeoutMs: 80 });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    const sess = h.host.sessions.get(c.sessionId);
    if (sess) sess.status = "ended";

    h.host.behavior.ready = false;
    const r = await ensure("alice", key, c.id);
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("guard_unavailable");
    expect(h.host.aborts.some((a) => a.sessionId === "sess-2")).toBe(true);
    const uk = await ukOf("alice");
    const rec = JSON.parse(fs.readFileSync(recordFile(uk, key, "_ws", c.id), "utf8"));
    expect(rec.sessionId).toBe(c.sessionId); // record still names the first session
  });
});
