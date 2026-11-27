/**
 * Lead-proxied member identity (test-plan S41-S44): the `as {member, token}` branch of `resolveCaller`, the
 * constant-time token compare, token mint / rotate / persist / delete and the "token never leaks" sweep.
 * See change: add-agent-teams-in-process.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { capturingLogger, createStoreEnv, memberFixture } from "../../__tests__/harness/store-env.js";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/teams-env.js";
import type { Member, Team } from "../../shared/types.js";
import { createInProcDriver } from "../driver-inproc.js";
import { createInProcAvailability } from "../modes-inproc.js";
import { asClaimOf, mintProxyToken, PROXY_TOKEN_HEX_LENGTH, resolveProxied, tokensEqual } from "../proxy-identity.js";
import { snapshotOf } from "../snapshot.js";
import { createPluginCounters } from "../templates-hooks.js";

const AVAILABLE = { available: true } as const;

/** One server with: team A (lead S-lead, in-process: bob, carol), team B (lead S-b, in-process: zed), team C (lead S-c, session mode: sam). */
async function world() {
  const env = createTeamsEnv({ runtime: { inProcess: true } });
  const linkA = linkInProcBridge(env, { lead: "S-lead" });
  linkA.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: `bg-${cmd.member}`, agentId: `agent-${cmd.member}`, status: "running" } } : cmd.cmd === "stop" ? { ack: { cmdId: cmd.cmdId, ok: true } } : undefined));
  await linkA.hello(AVAILABLE);
  const a = await env.fake.call("S-lead", "TeamCreate", { name: "a", mode: "in-process" });
  const teamA = env.rt.store.get(a.data.teamId) as Team;
  const sb = env.fake.addSession("S-b", { cwd: "/work" });
  const linkB = linkInProcBridge(env, { lead: sb, secret: "secret-b" });
  linkB.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: "bg-zed", agentId: "agent-zed", status: "running" } } : undefined));
  await linkB.hello(AVAILABLE);
  const b = await env.fake.call(sb, "TeamCreate", { name: "b", mode: "in-process" });
  const teamB = env.rt.store.get(b.data.teamId) as Team;
  const sc = env.fake.addSession("S-c", { cwd: "/work" });
  const c = await env.fake.call(sc, "TeamCreate", { name: "c" });
  const teamC = env.rt.store.get(c.data.teamId) as Team;
  const sam = env.fake.addSession("S-sam", { cwd: "/work" });
  env.rt.store.reserveMember(teamC.id, memberFixture("sam", { sessionId: sam, status: "idle" }) as Member);
  for (const name of ["bob", "carol"]) expect((await env.fake.call("S-lead", "TeammateSpawn", { name, prompt: `task of ${name}` })).ok).toBe(true);
  expect((await env.fake.call(sb, "TeammateSpawn", { name: "zed", prompt: "z" })).ok).toBe(true);
  await env.settle();
  const tokenOf = (team: Team, name: string): string => (env.rt.store.member(env.rt.store.get(team.id) as Team, name) as Member).proxyToken as string;
  return { env, linkA, linkB, teamA, teamB, teamC, sb, sc, sam, tokenOf };
}

describe("S41 lead-proxied member identity (decision table)", () => {
  it("only (lead of this in-process team × valid token × live member) is accepted as the member; everything else is forbidden / member_gone with no fallback", async () => {
    const w = await world();
    const { env } = w;
    // carol is gone but her token (still persisted) is valid.
    const carolToken = w.tokenOf(w.teamA, "carol");
    env.rt.ops.releaseMember(env.rt.store.get(w.teamA.id) as Team, "carol", "gone", "stopped");
    const tokens = { bob: w.tokenOf(w.teamA, "bob"), carol: carolToken, zed: w.tokenOf(w.teamB, "zed") };
    expect(tokens.bob).toMatch(/^[0-9a-f]{64}$/);

    const sockets = { leadA: "S-lead", leadB: w.sb, leadSession: w.sc, teammate: w.sam, unrelated: env.fake.addSession("S-x", { cwd: "/work" }) };
    const claims: Array<[string, unknown]> = [
      ["valid", { member: "bob", token: tokens.bob }],
      ["wrong token", { member: "bob", token: "f".repeat(64) }],
      ["missing token", { member: "bob" }],
      ["token of another member", { member: "bob", token: tokens.zed }],
      ["unknown member", { member: "nobody", token: tokens.bob }],
      ["gone member, valid token", { member: "carol", token: tokens.carol }],
      ["array member", { member: ["bob"], token: tokens.bob }],
      ["object token", { member: "bob", token: { x: 1 } }],
      ["number token", { member: "bob", token: 1e3 }],
      ["empty strings", { member: "", token: "" }],
      ["10 KB token", { member: "bob", token: "a".repeat(10_240) }],
      ["as is a string", "bob"],
      ["as is null", null],
    ];
    const before = (): number => (env.rt.store.get(w.teamA.id) as Team).tasks.length;
    let rejected = 0;
    for (const [sockName, sid] of Object.entries(sockets)) {
      for (const [claimName, as] of claims) {
        const n0 = before();
        const res = await env.fake.lane(sid, "agent-teams/call", { op: "TaskCreate", args: { title: `t-${sockName}-${claimName}`, description: "d" }, as });
        const accepted = sockName === "leadA" && claimName === "valid";
        const gone = sockName === "leadA" && claimName === "gone member, valid token";
        if (accepted) {
          expect(res.ok, `${sockName}/${claimName}`).toBe(true);
          expect(res.data.task?.createdBy ?? (env.rt.store.get(w.teamA.id) as Team).tasks.at(-1)?.createdBy).toBe("bob");
          expect(before()).toBe(n0 + 1);
        } else {
          expect(res, `${sockName}/${claimName}`).toMatchObject({ ok: false, error: gone ? "member_gone" : "forbidden" });
          expect(before(), `state unchanged ${sockName}/${claimName}`).toBe(n0); // NO fallback to the socket (lead) identity
          if (!gone) rejected++;
        }
      }
    }
    expect(env.rt.counters.get("inproc_forbidden")).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    // Logs name ids only: never a token.
    const logText = JSON.stringify(env.fake.logs);
    for (const t of Object.values(tokens)) expect(logText).not.toContain(t);
  });

  it("a session-mode lead and a teammate session socket cannot use `as` even with a valid in-process token", async () => {
    const w = await world();
    const bob = w.tokenOf(w.teamA, "bob");
    for (const sid of [w.sc, w.sam]) expect(await w.env.fake.lane(sid, "agent-teams/call", { op: "TeamStatus", args: {}, as: { member: "bob", token: bob } })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("an accepted proxied hello does not overwrite the lead's own session report", async () => {
    const w = await world();
    const bob = w.tokenOf(w.teamA, "bob");
    const before = w.env.rt.ops.reports.get("S-lead");
    const res = await w.env.fake.lane("S-lead", "agent-teams/hello", { isIdle: false, toolsActive: true, guardActive: true, confined: false, as: { member: "bob", token: bob } });
    expect(res).toMatchObject({ ok: true, data: { role: "member", member: "bob" } });
    expect(w.env.rt.ops.reports.get("S-lead")).toBe(before);
  });

  it("without in-process enabled a present `as` is forbidden (never falls back to the socket)", async () => {
    const env = createTeamsEnv();
    const team = await env.createTeam("alpha");
    const out = await env.fake.lane(env.lead, "agent-teams/call", { op: "TaskCreate", args: { title: "x", description: "d" }, as: { member: "bob", token: "a".repeat(64) } });
    expect(out).toMatchObject({ ok: false, error: "forbidden" });
    expect(env.rt.store.get(team.id)?.tasks).toHaveLength(0);
  });
});

describe("S42 constant-time token comparison", () => {
  const real = "ab".repeat(32);
  it.each([
    ["length 0", ""],
    ["length 63", real.slice(0, 63)],
    ["length 65", `${real}a`],
    ["non-hex 64", "z".repeat(64)],
    ["valid prefix only (63 correct chars)", `${real.slice(0, 63)}0`],
  ])("%s is rejected; the primitive is only called on equal-length buffers", (_name, candidate) => {
    const compare = vi.fn((a: Buffer, b: Buffer) => a.equals(b));
    expect(tokensEqual(real, candidate, compare)).toBe(false);
    for (const [a, b] of compare.mock.calls) expect(a.length).toBe(b.length);
    if (candidate.length !== real.length) expect(compare).not.toHaveBeenCalled();
  });

  it("an equal token matches through the primitive; non-strings never match and never throw", () => {
    const compare = vi.fn((a: Buffer, b: Buffer) => a.equals(b));
    expect(tokensEqual(real, real, compare)).toBe(true);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(tokensEqual(real, undefined)).toBe(false);
    expect(tokensEqual(undefined, real)).toBe(false);
    expect(tokensEqual(real, 5 as unknown as string)).toBe(false);
  });

  it("resolveProxied for an unknown member still runs one equal-length compare (no existence oracle) and answers forbidden", async () => {
    const w = await world();
    const compare = vi.fn((a: Buffer, b: Buffer) => a.equals(b));
    const known = resolveProxied(w.env.rt.store, "S-lead", { member: "bob", token: "f".repeat(64) }, compare);
    const unknown = resolveProxied(w.env.rt.store, "S-lead", { member: "nobody", token: "f".repeat(64) }, compare);
    expect(known).toEqual({ ok: false, error: "forbidden" });
    expect(unknown).toEqual({ ok: false, error: "forbidden" });
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("asClaimOf: absent is undefined, malformed is null, a well-formed claim is returned", () => {
    expect(asClaimOf({ op: "x" })).toBeUndefined();
    expect(asClaimOf(undefined)).toBeUndefined();
    expect(asClaimOf({ as: null })).toBeNull();
    expect(asClaimOf({ as: ["bob"] })).toBeNull();
    expect(asClaimOf({ as: { member: "bob" } })).toBeNull();
    expect(asClaimOf({ as: { member: "bob", token: "t" } })).toEqual({ member: "bob", token: "t" });
    expect(asClaimOf(JSON.parse('{"__proto__":{"as":{"member":"bob","token":"t"}}}'))).toBeUndefined(); // own properties only
  });
});

describe("S43 token mint, rotate, persist, delete", () => {
  it("is 32 random bytes as 64 hex chars, unique across 10 000 mints", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(mintProxyToken());
    expect(seen.size).toBe(10_000);
    for (const t of [...seen].slice(0, 50)) expect(t).toMatch(new RegExp(`^[0-9a-f]{${PROXY_TOKEN_HEX_LENGTH}}$`));
  });

  it("T1 is rejected after a respawn, T2 is accepted, survives a server restart, and is deleted when the team closes", async () => {
    const dataDir = fs.mkdtempSync(path.join(await import("node:os").then((m) => m.tmpdir()), "at-token-"));
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: `bg-${link.commands.length}`, agentId: `agent-${link.commands.length}`, status: "running" } } : undefined));
    await link.hello(AVAILABLE);
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    const teamId = created.data.teamId as string;
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "one" });
    await env.settle();
    const t1 = (env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member).proxyToken as string;
    const ask = (token: string) => env.fake.lane(env.lead, "agent-teams/call", { op: "TeamStatus", args: {}, as: { member: "bob", token } });
    expect((await ask(t1)).ok).toBe(true);
    env.rt.ops.releaseMember(env.rt.store.get(teamId) as Team, "bob", "gone", "stopped");
    expect(await ask(t1)).toMatchObject({ error: "member_gone" }); // valid token, gone member
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "two" });
    await env.settle();
    const t2 = (env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member).proxyToken as string;
    expect(t2).not.toBe(t1);
    expect(await ask(t1)).toMatchObject({ ok: false, error: "forbidden" }); // rotated
    expect((await ask(t2)).ok).toBe(true);

    // Persisted (the team file is the only place besides the spawn command) and still accepted after a restart.
    env.rt.persistence.flushSync();
    const file = path.join(dataDir, "teams", `${teamId}.json`);
    expect(fs.readFileSync(file, "utf8")).toContain(t2);
    expect(fs.statSync(path.join(dataDir, "teams")).mode & 0o777).toBe(0o700);
    const restarted = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const loaded = restarted.rt.store.get(teamId) as Team;
    expect(resolveProxied(restarted.rt.store, loaded.leadSessionId as string, { member: "bob", token: t2 })).toMatchObject({ ok: true });
    expect(resolveProxied(restarted.rt.store, loaded.leadSessionId as string, { member: "bob", token: t1 })).toEqual({ ok: false, error: "forbidden" });

    // Deleted with the team.
    env.rt.ops.releaseMember(env.rt.store.get(teamId) as Team, "bob", "gone", "stopped");
    env.rt.ops.teamDelete(env.rt.store.get(teamId) as Team, { actor: "lead" });
    env.rt.persistence.flushSync();
    expect(env.rt.store.get(teamId)?.status).toBe("closed");
    expect((env.rt.store.get(teamId) as Team).members.every((m) => m.proxyToken === undefined)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).not.toContain(t2);
  });
});

describe("S44 the token never leaks", () => {
  async function sweep(env: TeamsEnv, teamId: string, token: string): Promise<string[]> {
    const team = env.rt.store.get(teamId) as Team;
    const out: Array<[string, unknown]> = [
      ["mail log", env.rt.store.mailLog(teamId)],
      ["TeamStatus", await env.fake.call(env.lead, "TeamStatus", {})],
      ["REST snapshot", snapshotOf(env.rt.store, env.rt.telemetry, team, env.rt.counters.forTeam(teamId))],
      ["REST list", env.rt.store.list().map((t) => ({ id: t.id, name: t.name }))],
      ["logs", env.fake.logs],
      ["telemetry", env.rt.telemetry.stats(teamId)],
      ["counters", env.rt.counters.snapshot()],
      ["emits (non-spawn)", env.fake.base.emits.filter((e) => !(e.eventType === "agent-teams:inproc" && (e.data as { cmd?: string }).cmd === "spawn"))],
      ["spawn calls", env.fake.base.spawns],
    ];
    return out.filter(([, v]) => JSON.stringify(v).includes(token)).map(([name]) => name);
  }

  it("a spawn → mail → idle → stop path leaves the token only in the persisted team file and the spawn command", async () => {
    const dataDir = fs.mkdtempSync(path.join(await import("node:os").then((m) => m.tmpdir()), "at-leak-"));
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => ({ ack: { cmdId: cmd.cmdId, ok: true, ...(cmd.cmd === "spawn" ? { childId: "bg-1", agentId: "agent-1", status: "running" as const } : {}) } }));
    await link.hello(AVAILABLE);
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    const teamId = created.data.teamId as string;
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "do it" });
    await env.settle();
    const spawn = link.commands.find((c) => c.cmd === "spawn") as unknown as { proxyToken: string };
    const token = spawn.proxyToken;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await env.call("lead", "SendMessage", { to: "bob", text: "hello" });
    expect(await env.fake.lane(env.lead, "agent-teams/idle", { settleId: 1, finalText: "all done", as: { member: "bob", token } })).toMatchObject({ ok: true });
    env.flushNotices();
    // Failure paths that stringify a command: a wrong token and a team-level error.
    await env.fake.lane(env.lead, "agent-teams/call", { op: "TeamStatus", args: {}, as: { member: "bob", token: `${token.slice(0, 63)}0` } });
    expect(await sweep(env, teamId, token)).toEqual([]);
    env.rt.persistence.flushSync();
    expect(fs.readFileSync(path.join(dataDir, "teams", `${teamId}.json`), "utf8")).toContain(token); // present ONLY in the persisted team file
    // shutdown path: the stop command carries no token either.
    env.rt.ops.teamDelete(env.rt.store.get(teamId) as Team, { actor: "lead", force: true });
    env.clock.advance(20_000);
    await env.settle();
    expect(link.commands.filter((c) => c.cmd !== "spawn").some((c) => JSON.stringify(c).includes(token))).toBe(false);
    expect(await sweep(env, teamId, token)).toEqual([]);
  });

  it("the failure paths of the command channel (emit_refused, delivery_timeout) never stringify the token", async () => {
    const clock = new FakeClock(1);
    const env = createStoreEnv({ clock });
    const { logger, logs } = capturingLogger();
    const team = env.store.createTeam({ name: "t", leadSessionId: "S-lead", leadCwd: "/w", mode: "in-process", maxTeammates: 5 });
    const availability = createInProcAvailability(clock);
    availability.note("S-lead", { op: "hello", incarnation: "i", commandSecret: "sec", inProcess: { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } } });
    let accept = false;
    const driver = createInProcDriver({
      store: env.store,
      clock,
      logger,
      config: () => ({ inProcessCmdTimeoutMs: 1000, inProcessLeanChildren: false }) as never,
      emit: () => accept,
      isConnected: () => true,
      availability,
      counters: createPluginCounters(),
      newToken: () => "T".repeat(64),
    });
    const spec = { cwd: "/w", noMcp: false, noContextFiles: false, promptFiles: [], env: {} };
    const spawn = async (name: string) => {
      env.store.reserveMember(team.id, memberFixture(name, { status: "spawning" }) as Member);
      return driver.spawn({ teamId: team.id, teamName: "t", member: name, role: "member", spawnToken: `st-${name}`, spec });
    };
    const refused = await spawn("a"); // emit refused while the lead is connected and announced
    accept = true;
    const pending = spawn("b");
    clock.advance(1000);
    // The timed-out spawn reconciles (stop, then snapshot) before it resolves; none of them is acknowledged here, so each times out too.
    for (let i = 0; i < 3; i++) {
      for (let t = 0; t < 12; t++) await Promise.resolve();
      clock.advance(1000);
    }
    const timedOut = await pending; // delivery_timeout
    expect(refused).toMatchObject({ ok: false });
    expect(timedOut).toMatchObject({ ok: false });
    expect(JSON.stringify([refused, timedOut, logs])).not.toContain("T".repeat(64));
    expect(JSON.stringify(refused)).toContain("emit_refused");
    expect(JSON.stringify(timedOut)).toContain("delivery_timeout");
  });
});
