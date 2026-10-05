/**
 * Conversations, agents, lifecycle, guard/spawn wiring (E20, E25, E32–E36,
 * E43–E46, F1–F9, F23, X1–X4, X6, X7). See change: add-team-plugin.
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

async function mkPersona(user: string | undefined, slug: string, extra: Record<string, unknown> = {}) {
  const r = await h.call("POST", `${API}/personas`, { user, body: persona(slug, extra) });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.key as string;
}
async function create(user: string | undefined, key: string, t = "_ws") {
  return h.call("POST", `${API}/agents/${enc(key)}/conversations?project=${t}`, { user });
}
async function ensure(user: string | undefined, key: string, c: string, t = "_ws") {
  return h.call("POST", `${API}/agents/${enc(key)}/conversations/${c}/session?project=${t}`, { user });
}
const list = (user: string | undefined, key: string, t = "_ws", archived = false) =>
  h.call("GET", `${API}/agents/${enc(key)}/conversations?project=${t}${archived ? "&archived=true" : ""}`, { user });
const agents = (user: string | undefined, t = "_ws") => h.call("GET", `${API}/agents?project=${t}`, { user });
const ukOf = async (user: string) => (await h.call("GET", `${API}/me`, { user })).json.uk as string;

describe("targets and workspaces (E20, E36)", () => {
  it("E20: own workspace is per user, shared by the user's agents; keyed by hashed uk", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const shared = (await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("backend"), scope: "shared" } })).json.key;
    const reviewer = await mkPersona("alice", "reviewer");
    await create("alice", shared);
    await create("alice", reviewer);
    await create("bob", shared);
    const [a1, a2, b1] = h.host.spawns.map((s) => s.cwd);
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    const ukA = await ukOf("alice");
    expect(a1).toBe(path.join(h.home, "users", ukA, "workspace"));
    expect(ukA).toMatch(/^[0-9a-f]{32}$/);
    for (const s of h.host.spawns) expect(s.cwd).not.toContain("alice");
    await h.close();
    h = await makeHarness({ mode: "single" });
    const k = (await h.call("POST", `${API}/personas`, { body: persona("op") })).json.key;
    await create(undefined, k);
    expect(h.host.spawns[0].cwd).toBe(path.join(h.home, "users", "local", "workspace"));
  });

  it("E36: two users on one project share the tree but not owners or records", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const dir = h.dir("billing");
    config.projects = { billing: { name: "B", path: dir, users: "*" } };
    await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("w"), scope: "shared", projects: ["billing"] } });
    await create("alice", "shared:w", "billing");
    await create("bob", "shared:w", "billing");
    expect(h.host.spawns.map((s) => s.cwd)).toEqual([dir, dir]);
    const owners = h.host.spawns.map((s) => (s.pluginRef as { principalOwner: { sub: string } }).principalOwner.sub);
    expect(owners).toEqual(["alice", "bob"]);
    expect((await list("alice", "shared:w", "billing")).json.conversations.length).toBe(1);
    expect((await list("bob", "shared:w", "billing")).json.conversations.length).toBe(1);
  });
});

describe("spawn wiring (D5/D6/D7)", () => {
  it("spawn options carry guard, persona, session dir, no-trust, tools preset, owner and runId", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "w", { tools: "files", model: "prov/m" });
    const r = await create("alice", key);
    expect(r.status).toBe(201);
    const s = h.host.spawns[0];
    expect(s.model).toBe("prov/m");
    expect(s.name).toBeUndefined();
    expect(s.scope?.tools).toEqual(["read", "grep", "find", "ls", "write", "edit"]);
    expect(s.scope?.noContextFiles).toBe(true);
    expect(s.scope?.noProjectTrust).toBe(true);
    expect(s.scope?.extensions?.[0]).toMatch(/extension\/index\.ts$/);
    expect(s.scope?.extensionConfig?.team).toMatchObject({ tools: "files", root: s.cwd });
    expect(s.scope?.appendSystemPrompt).toHaveLength(1);
    expect(fs.readFileSync(s.scope?.appendSystemPrompt?.[0] as string, "utf8")).toContain("be helpful");
    expect(s.scope?.sessionDir).toMatch(/--.*--$/);
    expect(s.lifecycle).toEqual({ recover: false, finalizeOnSocketClose: true });
    expect((s.pluginRef as { team: { runId: string } }).team.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.spawnToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("E35: project context files are appended only when enabled, inside the root, regular, ≤ 64 KiB", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    const dir = h.dir("p");
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "root agents");
    fs.writeFileSync(path.join(path.dirname(dir), "AGENTS.md"), "parent agents");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "x".repeat(65 * 1024));
    config.projects = { on: { name: "On", path: dir, users: "*", contextFiles: true } };
    const key = (await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("w"), scope: "shared", projects: ["on"] } })).json.key;
    await create("alice", key, "on");
    const prompts = h.host.spawns[0].scope?.appendSystemPrompt ?? [];
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toBe(path.join(dir, "AGENTS.md"));
    expect(h.host.spawns[0].scope?.noContextFiles).toBe(true);
    expect(h.host.spawns[0].scope?.noProjectTrust).toBe(true);
    // symlinked AGENTS.md pointing outside is skipped; contextFiles off ⇒ persona only
    fs.rmSync(path.join(dir, "AGENTS.md"));
    const outside = path.join(h.tmp, "secret.md");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(dir, "AGENTS.md"));
    await create("alice", key, "on");
    expect(h.host.spawns[1].scope?.appendSystemPrompt?.length).toBe(1);
    config.projects = { on: { name: "On", path: dir, users: "*", contextFiles: false } };
    fs.rmSync(path.join(dir, "AGENTS.md"));
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "again");
    await create("alice", key, "on");
    expect(h.host.spawns[2].scope?.appendSystemPrompt?.length).toBe(1);
    expect(h.host.spawns[2].scope?.noProjectTrust).toBe(true);
  });
});

describe("agents per target (E33, F5, X6)", () => {
  it("E33: assigned, unassigned-with-conversations, and workspace-only personas", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    config.projects = { billing: { name: "B", path: h.dir("billing"), users: "*" } };
    const adm = async (slug: string, projects: string[]) =>
      (await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona(slug), scope: "shared", projects } })).json.key;
    const backend = await adm("backend", ["billing"]);
    await adm("writer", ["_ws"]);
    const old = await adm("old", ["billing"]);
    const x = await mkPersona("alice", "x", { projects: ["_ws", "billing"] });
    await create("alice", old, "billing");
    await create("alice", old, "billing");
    await h.call("PUT", `${API}/personas/${enc(old)}`, { user: "root", body: { name: "old", instructions: "i", projects: ["_ws"] } });
    const b = (await agents("alice", "billing")).json.agents as Array<{ key: string; status: string; unassigned: boolean; activeCount: number }>;
    expect(b.map((a) => a.key).sort()).toEqual([backend, old, x].sort());
    const oldCard = b.find((a) => a.key === old);
    expect(oldCard).toMatchObject({ status: "unavailable", unassigned: true, activeCount: 2 });
    const ws = (await agents("alice", "_ws")).json.agents as Array<{ key: string }>;
    expect(ws.map((a) => a.key).sort()).toEqual(["private:x", "shared:old", "shared:writer"].sort());
    const blocked = await create("alice", old, "billing");
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("persona_not_in_project");
  });

  it("F5: new / sleeping / running / busy / retired / unavailable; listing never spawns", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const key = await mkPersona("alice", "a");
    expect((await agents("alice")).json.agents[0].status).toBe("new");
    const c = (await create("alice", key)).json;
    const sess = h.host.sessions.get(c.sessionId);
    expect((await agents("alice")).json.agents[0].status).toBe("running");
    if (sess) sess.status = "streaming";
    expect((await agents("alice")).json.agents[0].status).toBe("busy");
    if (sess) sess.status = "ended";
    expect((await agents("alice")).json.agents[0].status).toBe("sleeping");
    const spawns = h.host.spawns.length;
    await agents("alice");
    expect(h.host.spawns.length).toBe(spawns);
    // retired: persona deleted
    await h.call("DELETE", `${API}/personas/${enc(key)}`, { user: "alice" });
    const retired = (await agents("alice")).json.agents[0];
    expect(retired).toMatchObject({ key, status: "retired", name: "a" });
  });

  it("X6: deleting a persona retires it; ensure ⇒ 404; archive/delete still work", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "gone");
    const c = (await create("alice", key)).json;
    await h.call("DELETE", `${API}/personas/${enc(key)}`, { user: "alice" });
    expect((await ensure("alice", key, c.id)).json.error).toBe("persona_not_found");
    expect((await list("alice", key)).json.conversations.length).toBe(1);
    expect((await h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice", body: { archived: true } })).status).toBe(200);
    expect((await h.call("DELETE", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice" })).status).toBe(200);
  });

  it("E25: personaStale per conversation and card", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    const key = (await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("s"), scope: "shared" } })).json.key;
    const c1 = (await create("alice", key)).json.id;
    expect((await agents("alice")).json.agents[0].personaStale).toBe(false);
    await h.call("PUT", `${API}/personas/${enc(key)}`, { user: "root", body: { name: "s", instructions: "changed" } });
    const c2 = (await create("alice", key)).json.id;
    const convs = (await list("alice", key)).json.conversations as Array<{ id: string; personaStale: boolean }>;
    expect(convs.find((c) => c.id === c1)?.personaStale).toBe(true);
    expect(convs.find((c) => c.id === c2)?.personaStale).toBe(false);
    expect((await agents("alice")).json.agents[0].personaStale).toBe(true);
    // a restarted (sleeping) conversation is no longer "stale": its next start uses the new persona
    await h.call("POST", `${API}/agents/${enc(key)}/conversations/${c1}/restart?project=_ws`, { user: "alice" });
    await h.call("POST", `${API}/agents/${enc(key)}/conversations/${c2}/restart?project=_ws`, { user: "alice" });
    const after = (await list("alice", key)).json.conversations as Array<{ personaStale: boolean }>;
    expect(after.every((c) => !c.personaStale)).toBe(true);
    expect((await agents("alice")).json.agents[0].personaStale).toBe(false);
  });
});

describe("conversations (E32, E43–E46, F9)", () => {
  it("E32: many conversations, records per conversation, delete leaves the rest", async () => {
    const config: TeamConfig = { admins: [ADMIN] };
    h = await makeHarness({ config });
    config.projects = { billing: { name: "B", path: h.dir("billing"), users: "*" } };
    const key = (await h.call("POST", `${API}/personas`, { user: "root", body: { ...persona("backend"), scope: "shared", projects: ["billing", "_ws"] } })).json.key;
    const a = (await create("alice", key, "billing")).json.id;
    const b = (await create("alice", key, "billing")).json.id;
    await create("alice", key, "_ws");
    expect(h.host.spawns.length).toBe(3);
    const uk = await ukOf("alice");
    expect(fs.readdirSync(path.join(h.home, "users", uk, "conversations", "billing", "shared-backend")).length).toBe(2);
    expect((await h.call("DELETE", `${API}/agents/${enc(key)}/conversations/${a}?project=billing`, { user: "alice" })).status).toBe(200);
    const left = (await list("alice", key, "billing")).json.conversations;
    expect(left.map((c: { id: string }) => c.id)).toEqual([b]);
    expect((await list("alice", key, "_ws")).json.conversations.length).toBe(1);
  });

  it("E43: limit counts active only; restore re-checks; concurrent creates cannot overshoot (F23)", async () => {
    h = await makeHarness({ config: { maxConversations: 3 } });
    const key = await mkPersona("alice", "a");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await create("alice", key)).json.id);
    const over = await create("alice", key);
    expect(over.status).toBe(409);
    expect(over.json.error).toBe("conversation_limit");
    expect(h.host.spawns.length).toBe(3);
    const patch = (c: string, body: unknown) => h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c}?project=_ws`, { user: "alice", body });
    expect((await patch(ids[0], { archived: true })).status).toBe(200);
    expect((await create("alice", key)).status).toBe(201); // 2 active + 1 new = 3
    const restore = await patch(ids[0], { archived: false });
    expect(restore.status).toBe(409);
    expect(restore.json.error).toBe("conversation_limit");
    // F23: at 2 of 3 active, two creates arrive together
    await h.call("DELETE", `${API}/agents/${enc(key)}/conversations/${ids[1]}?project=_ws`, { user: "alice" });
    const [r1, r2] = await Promise.all([create("alice", key), create("alice", key)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect((await list("alice", key)).json.conversations.length).toBe(3);
  });

  it("E44: titles — user, session name, first prompt excerpt, placeholder; PATCH bounds", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const title = async () => (await list("alice", key)).json.conversations[0].title as string;
    expect(await title()).toMatch(/^Beszélgetés · \d{4}-\d{2}-\d{2}$/);
    const sess = h.host.sessions.get(c.sessionId);
    if (sess) sess.firstMessage = "y".repeat(200);
    expect([...(await title())].length).toBe(60);
    if (sess) sess.name = "Auto name";
    expect(await title()).toBe("Auto name");
    const patch = (t: string) => h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice", body: { title: t } });
    expect((await patch("")).status).toBe(400);
    expect((await patch("x".repeat(80))).status).toBe(200);
    expect((await patch("x".repeat(81))).status).toBe(400);
    await patch("My title");
    expect(await title()).toBe("My title");
  });

  it("E45: delete ends the live session, removes the record, keeps the transcript file", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const file = h.host.sessions.get(c.sessionId)?.sessionFile as string;
    expect((await h.call("DELETE", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice" })).status).toBe(200);
    expect(h.host.aborts.some((a) => a.sessionId === c.sessionId)).toBe(true);
    expect((await ensure("alice", key, c.id)).json.error).toBe("conversation_not_found");
    expect(fs.existsSync(file)).toBe(true);
    const uk = await ukOf("alice");
    expect(fs.readdirSync(path.join(h.home, "users", uk, "conversations", "_ws", "private-a"))).toEqual([]);
  });

  it("E46: another user's conversation id answers 404 on every route", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const base = `${API}/agents/${enc(key)}/conversations/${c.id}`;
    const spawns = h.host.spawns.length;
    const results = await Promise.all([
      h.call("POST", `${base}/session?project=_ws`, { user: "bob" }),
      h.call("PATCH", `${base}?project=_ws`, { user: "bob", body: { title: "x" } }),
      h.call("POST", `${base}/restart?project=_ws`, { user: "bob" }),
      h.call("DELETE", `${base}?project=_ws`, { user: "bob" }),
    ]);
    for (const r of results) expect(r).toEqual({ status: 404, json: { error: "conversation_not_found" } });
    expect(h.host.spawns.length).toBe(spawns);
    expect((await list("alice", key)).json.conversations.length).toBe(1);
  });

  it("F9: restart keeps the record and resumes next; archive ends + hides; restore resumes", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const first = h.host.sessions.get(c.sessionId);
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    expect((await h.call("POST", `${API}/agents/${enc(key)}/conversations/${c.id}/restart?project=_ws`, { user: "alice" })).status).toBe(200);
    expect(first?.status).toBe("ended");
    const r = await ensure("alice", key, c.id);
    expect(r.status).toBe(200);
    expect(h.host.spawns[1].resume?.sessionFile).toBe(first?.sessionFile);
    // archive
    const live = h.host.sessions.get(r.json.sessionId);
    await h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice", body: { archived: true } });
    expect(live?.status).toBe("ended");
    expect((await list("alice", key)).json.conversations).toEqual([]);
    expect((await list("alice", key, "_ws", true)).json.conversations.length).toBe(1);
    expect((await ensure("alice", key, c.id)).status).toBe(409);
    await h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice", body: { archived: false } });
    expect((await ensure("alice", key, c.id)).status).toBe(200);
    expect(h.host.spawns[2].resume?.sessionFile).toBeTruthy();
  });
});

describe("ensure (F1–F4, X1–X4)", () => {
  it("F1: reuse a live session; resume an ended one with the recorded file", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    const re = await ensure("alice", key, c.id);
    expect(re.json.sessionId).toBe(c.sessionId);
    expect(h.host.spawns.length).toBe(1);
    const sess = h.host.sessions.get(c.sessionId);
    const file = sess?.sessionFile;
    if (sess) sess.status = "ended";
    const resumed = await ensure("alice", key, c.id);
    expect(resumed.json.sessionId).not.toBe(c.sessionId);
    expect(h.host.spawns[1].resume?.sessionFile).toBe(file);
    expect((h.host.spawns[1].pluginRef as { principalOwner: { sub: string } }).principalOwner.sub).toBe("alice");
    const uk = await ukOf("alice");
    const rec = JSON.parse(fs.readFileSync(path.join(h.home, "users", uk, "conversations", "_ws", "private-a", `${c.id}.json`), "utf8"));
    expect(rec.sessionId).toBe(resumed.json.sessionId);
  });

  it("F2: foreign owner, missing transcript ⇒ 409 conversation_unrecoverable, no spawn", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    const sess = h.host.sessions.get(c.sessionId);
    if (!sess) throw new Error("no session");
    sess.status = "ended";
    sess.principalOwner = { iss: "https://iss", sub: "mallory" };
    const spawns = h.host.spawns.length;
    const r1 = await ensure("alice", key, c.id);
    expect(r1.status).toBe(409);
    expect(r1.json.error).toBe("conversation_unrecoverable");
    sess.principalOwner = { iss: "https://iss", sub: "alice" };
    fs.rmSync(sess.sessionFile as string);
    const r2 = await ensure("alice", key, c.id);
    expect(r2.json.error).toBe("conversation_unrecoverable");
    expect(h.host.spawns.length).toBe(spawns);
    expect(h.logs.some((l) => l.includes("team.ensure") && l.includes("outcome=unrecoverable"))).toBe(true);
  });

  it("F3: simultaneous ensures share one spawn; different conversations spawn separately", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c1 = (await create("alice", key)).json;
    const c2 = (await create("alice", key)).json;
    for (const id of [c1.sessionId, c2.sessionId]) {
      const s = h.host.sessions.get(id);
      if (s) s.status = "ended";
    }
    h.host.emit(c1.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    h.host.emit(c2.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    const before = h.host.spawns.length;
    const [x, y] = await Promise.all([ensure("alice", key, c1.id), ensure("alice", key, c1.id)]);
    expect(h.host.spawns.length).toBe(before + 1);
    expect(x.json.sessionId).toBe(y.json.sessionId);
    await ensure("alice", key, c2.id);
    expect(h.host.spawns.length).toBe(before + 2);
    const convs = (await list("alice", key)).json.conversations as Array<{ id: string }>;
    expect(convs.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
  });

  it("F4/X1: a timed-out spawn is aborted by token, writes no record, and a late resolve binds nothing", async () => {
    h = await makeHarness({ spawnTimeoutMs: 60 });
    const key = await mkPersona("alice", "a");
    h.host.behavior.resolve = false;
    const r = await create("alice", key);
    expect(r.status).toBe(504);
    expect(r.json.error).toBe("spawn_timeout");
    const token = h.host.spawns[0].spawnToken;
    expect(h.host.aborts).toContainEqual({ spawnToken: token, graceful: undefined });
    expect((await list("alice", key)).json.conversations).toEqual([]);
    const runIdA = (h.host.spawns[0].pluginRef as { team: { runId: string } }).team.runId;
    h.host.behavior.resolve = true;
    const ok = await create("alice", key);
    expect(ok.status).toBe(201);
    h.host.resolveLate(runIdA);
    const convs = (await list("alice", key)).json.conversations as Array<{ id: string }>;
    expect(convs.length).toBe(1);
    const uk = await ukOf("alice");
    const rec = JSON.parse(fs.readFileSync(path.join(h.home, "users", uk, "conversations", "_ws", "private-a", `${convs[0].id}.json`), "utf8"));
    expect(rec.sessionId).toBe(ok.json.sessionId);
    expect(h.logs.some((l) => l.includes("outcome=timeout"))).toBe(true);
  });

  it("X2: missing guard extension ⇒ 503 guard_unavailable, 0 spawns", async () => {
    h = await makeHarness({ guardExtensionPath: "/nonexistent/guard.ts" });
    const key = await mkPersona("alice", "a");
    const r = await create("alice", key);
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("guard_unavailable");
    expect(h.host.spawns.length).toBe(0);
  });

  it("X3: session resolves but never signals ready ⇒ aborted, 503, no record", async () => {
    h = await makeHarness({ spawnTimeoutMs: 60 });
    const key = await mkPersona("alice", "a");
    h.host.behavior.ready = false;
    const r = await create("alice", key);
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("guard_unavailable");
    expect(h.host.aborts.some((a) => a.sessionId === "sess-1")).toBe(true);
    expect((await list("alice", key)).json.conversations).toEqual([]);
  });

  it("X4: persona file vanishing between render and spawn ⇒ no spawn, 500 persona_render_failed", async () => {
    h = await makeHarness({
      renderPersona: (_p, uk) => {
        const f = path.join(h.home, "users", uk, "runtime", "gone.md");
        return f; // never written
      },
    });
    const key = await mkPersona("alice", "a");
    const r = await create("alice", key);
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("persona_render_failed");
    expect(h.host.spawns.length).toBe(0);
    expect(h.logs.some((l) => l.includes("team.persona_render_failed"))).toBe(true);
    expect((await list("alice", key)).json.conversations).toEqual([]);
  });

  it("X7: one team.ensure line per outcome, ids only — no persona text, title or path", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "secretname", { name: "Secret Persona", instructions: "TOP-SECRET-INSTRUCTIONS" });
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    await ensure("alice", key, c.id); // reuse
    const sess = h.host.sessions.get(c.sessionId);
    if (sess) sess.status = "ended";
    await ensure("alice", key, c.id); // resume
    const lines = h.logs.filter((l) => l.startsWith("team.ensure"));
    expect(lines.map((l) => /outcome=(\w+)/.exec(l)?.[1])).toEqual(["create", "reuse", "resume"]);
    for (const l of lines) {
      expect(l).toMatch(/uk=[0-9a-f]{32} personaKey=private:secretname t=_ws c=\S{22} outcome=\w+ sessionId=sess-\d+/);
      expect(l).not.toContain("Secret Persona");
      expect(l).not.toContain("TOP-SECRET");
      expect(l).not.toContain(h.tmp);
    }
  });
});

describe("hardening from the security audit", () => {
  it("a `full` (bash) persona never launches in multi-user mode, even if authored in single-user mode", async () => {
    h = await makeHarness({ config: { admins: [ADMIN] } });
    fs.mkdirSync(path.join(h.home, "personas"), { recursive: true });
    fs.writeFileSync(
      path.join(h.home, "personas", "bash.json"),
      JSON.stringify({ schemaVersion: 1, key: "shared:bash", scope: "shared", name: "Bash", description: "", avatar: { kind: "initials" }, role: "member", instructions: "", tools: "full", projects: ["_ws"], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "x" }),
    );
    const r = await create("alice", "shared:bash");
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("persona_unavailable");
    expect(h.host.spawns.length).toBe(0);
  });

  it("live pi processes are capped per user (429 session_limit); an ended session frees capacity", async () => {
    h = await makeHarness({ config: { maxLiveSessions: 2 } });
    const a = await mkPersona("alice", "a");
    const b = await mkPersona("alice", "b");
    const c1 = (await create("alice", a)).json;
    await create("alice", b);
    const over = await create("alice", a);
    expect(over.status).toBe(429);
    expect(over.json.error).toBe("session_limit");
    expect(h.host.spawns.length).toBe(2);
    // bela is unaffected
    expect((await create("bela", await mkPersona("bela", "x"))).status).toBe(201);
    const sess = h.host.sessions.get(c1.sessionId);
    if (sess) sess.status = "ended";
    expect((await create("alice", a)).status).toBe(201);
  });

  it("readiness is per RUN: a ready signal for another run (or a stale one) does not credit this spawn", async () => {
    h = await makeHarness({ spawnTimeoutMs: 80 });
    const key = await mkPersona("alice", "a");
    h.host.behavior.ready = false;
    const pending = create("alice", key);
    await new Promise((r) => setTimeout(r, 20));
    h.host.piHandlers.get("team_guard_ready")?.({ payload: { runId: "some-other-run" } }, "sess-1");
    h.host.piHandlers.get("team_guard_ready")?.({ payload: {} }, "sess-1");
    const r = await pending;
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("guard_unavailable");
    expect((await list("alice", key)).json.conversations).toEqual([]);
  });

  it("archiving while a resume is still spawning never resurrects the conversation; the new session is ended", async () => {
    h = await makeHarness();
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: Date.now() });
    const first = h.host.sessions.get(c.sessionId);
    if (first) first.status = "ended";
    h.host.behavior.delayMs = 120;
    const ensuring = ensure("alice", key, c.id);
    await new Promise((r) => setTimeout(r, 30));
    await h.call("PATCH", `${API}/agents/${enc(key)}/conversations/${c.id}?project=_ws`, { user: "alice", body: { archived: true } });
    const r = await ensuring;
    expect(r.status).toBe(409);
    expect(h.host.aborts.some((a) => a.sessionId === "sess-2" && a.graceful === true)).toBe(true);
    expect((await list("alice", key)).json.conversations).toEqual([]);
    expect((await list("alice", key, "_ws", true)).json.conversations.length).toBe(1);
  });

  it("streaming activity writes are coalesced; the turn end is always persisted", async () => {
    const clock = { t: Date.parse("2026-01-01T12:00:00Z") };
    h = await makeHarness({ now: () => clock.t });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const uk = await ukOf("alice");
    const file = path.join(h.home, "users", uk, "conversations", "_ws", "private-a", `${c.id}.json`);
    const at = () => JSON.parse(fs.readFileSync(file, "utf8")).lastActivityAt as string;
    clock.t += 11_000;
    h.host.emit(c.sessionId, { eventType: "message_start", timestamp: clock.t });
    const first = at();
    clock.t += 2_000;
    h.host.emit(c.sessionId, { eventType: "message_start", timestamp: clock.t });
    expect(at()).toBe(first); // within the coalescing window
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).lastAgentEndAt).toBe(new Date(clock.t).toISOString());
  });
});

describe("idle ending (F6–F8)", () => {
  const withClock = async (cfg: TeamConfig = {}) => {
    const clock = { t: Date.parse("2026-01-01T12:00:00Z") };
    h = await makeHarness({ config: cfg, now: () => clock.t });
    return clock;
  };
  const MIN = 60_000;

  it("F6: ends sessions idle past idleMinutes; never busy; 0 disables", async () => {
    const clock = await withClock({ idleMinutes: 30 });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t });
    clock.t += 29 * MIN;
    h.team.conversations.sweepIdle();
    expect(h.host.sessions.get(c.sessionId)?.status).toBe("idle");
    clock.t += 2 * MIN;
    h.team.conversations.sweepIdle();
    expect(h.host.sessions.get(c.sessionId)?.status).toBe("ended");
    expect(h.host.aborts.some((a) => a.sessionId === c.sessionId && a.graceful === true)).toBe(true);
    // busy for 45 min is never ended
    const c2 = (await create("alice", key)).json;
    const s2 = h.host.sessions.get(c2.sessionId);
    if (s2) s2.status = "streaming";
    clock.t += 45 * MIN;
    h.team.conversations.sweepIdle();
    expect(s2?.status).toBe("streaming");
  });

  it("F6: idleMinutes 0 never ends", async () => {
    const clock = await withClock({ idleMinutes: 0 });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    clock.t += 24 * 60 * MIN;
    h.team.conversations.sweepIdle();
    expect(h.host.sessions.get(c.sessionId)?.status).toBe("idle");
  });

  it("F7: replayed or foreign agent_end does not move lastAgentEndAt", async () => {
    const clock = await withClock({ idleMinutes: 30 });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    const uk = await ukOf("alice");
    const file = path.join(h.home, "users", uk, "conversations", "_ws", "private-a", `${c.id}.json`);
    clock.t += 5 * MIN;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t, replay: true });
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t - 10 * MIN });
    h.host.emit("not-ours", { eventType: "agent_end", timestamp: clock.t });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).lastAgentEndAt).toBeUndefined();
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).lastAgentEndAt).toBe(new Date(clock.t).toISOString());
  });

  it("F8: idleness survives a plugin restart (persisted in the record)", async () => {
    const clock = await withClock({ idleMinutes: 30 });
    const key = await mkPersona("alice", "a");
    const c = (await create("alice", key)).json;
    h.host.emit(c.sessionId, { eventType: "agent_end", timestamp: clock.t });
    clock.t += 31 * MIN;
    h.team.conversations.stop();
    h.team.conversations.start(0); // activation sweep
    expect(h.host.sessions.get(c.sessionId)?.status).toBe("ended");
  });
});
