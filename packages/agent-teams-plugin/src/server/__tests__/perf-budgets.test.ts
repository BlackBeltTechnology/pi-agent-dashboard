/**
 * Performance / cost regression gates on the injected clock and the fake host
 * (test-plan S125 store-op tail latency, S128 persistence soak, S129 lead wake
 * cost, S130 no polling). Budgets are generous regression gates (decision A12),
 * not SLOs: they catch O(n²) and sync-IO regressions. S124 delivery latency runs
 * through the REAL bridge entry over the fake host; the REST rows (S126/S127)
 * run over a real Fastify instance (`inject`).
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv, linkBridge, type TeamsEnv } from "../../__tests__/harness/index.js";
import { ENV_MEMBER, ENV_POLICY, ENV_TEAM_ID } from "../../shared/policy.js";
import type { Team } from "../../shared/types.js";
import { nodePersistFs, type PersistFs } from "../persistence.js";
import { API_PREFIX, mountTeamsRoutes } from "../routes.js";

/** `node:fs`-backed persistence that counts the writes it performs. */
function countingFs() {
  const counts = { team: 0, append: 0, other: 0 };
  const io: PersistFs = {
    ...nodePersistFs,
    writeFile: (file, data) => {
      if (file.endsWith(".tmp")) counts.team++;
      else counts.other++;
      return nodePersistFs.writeFile(file, data);
    },
    appendFile: (file, data) => {
      counts.append++;
      return nodePersistFs.appendFile(file, data);
    },
  };
  return { io, counts };
}

const p = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number;

describe("mutation cost (S125)", () => {
  it("3 teams × 50 open tasks × 5 members, a 5000-op claim/complete storm: p99 < 5 ms per store op", async () => {
    const e = createTeamsEnv({ config: { mailRatePerMin: 1_000_000, maxTasks: 200 } });
    const leads = [e.lead, e.fake.addSession("S-lead2", { cwd: "/w2" }), e.fake.addSession("S-lead3", { cwd: "/w3" })];
    const teams: Team[] = [];
    for (const [i, lead] of leads.entries()) {
      const res = await e.fake.call(lead, "TeamCreate", { name: `team-${i}` });
      expect(res.ok).toBe(true);
      const team = e.rt.store.get(res.data.teamId) as Team;
      teams.push(team);
      for (let m = 0; m < 5; m++) e.addMember(team, `m${i}-${m}`, "busy");
      for (let t = 0; t < 50; t++) e.rt.store.addTask(team.id, { title: `t${t}`, description: "d".repeat(300), createdBy: "lead", blockedBy: t > 0 && t % 5 === 0 ? [String(t)] : [] });
    }
    const times: number[] = [];
    const timed = async (who: string, op: string, args: object) => {
      const t0 = performance.now();
      const res = await e.call(who, op, args);
      times.push(performance.now() - t0);
      return res;
    };
    let ops = 0;
    for (let round = 0; ops < 5200; round++) {
      for (const [i, team] of teams.entries()) {
        const who = `m${i}-${round % 5}`;
        const open = team.tasks.find((t) => t.status === "pending" && t.owner === undefined && !e.rt.store.isBlocked(team, t));
        if (!open) continue;
        await timed(who, "TaskUpdate", { id: open.id, status: "in_progress" });
        await timed(who, "TaskUpdate", { id: open.id, status: "completed", result: "ok" });
        await timed(who, "TaskCreate", { title: "replacement", description: "d" });
        ops += 3;
      }
    }
    const warm = times.slice(200).sort((a, b) => a - b);
    expect(warm.length).toBeGreaterThan(4500);
    expect(p(warm, 0.99)).toBeLessThan(5);
  });
});

describe("persistence soak (S128)", () => {
  it("100k mails + task churn: mail log stays ≤ its cap, the team file stays small, team-file writes are coalesced, memory is flat after warm-up", async () => {
    v8.setFlagsFromString("--expose_gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const { io, counts } = countingFs();
    const e = createTeamsEnv({ runtime: { fs: io } });
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    const cap = 2 * 1024 * 1024;
    const body = "x".repeat(180);
    let acked = 0;
    const heapAt: number[] = []; // post-GC heap: V8 keeps freed pages in RSS, so RSS alone cannot tell a leak from a high-water mark
    const startClock = e.clock.now();
    for (let i = 1; i <= 100_000; i++) {
      const mail = e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: `${i} ${body}`, wake: false });
      if (mail) {
        e.rt.store.ackMail(team.id, [mail.id]);
        acked++;
      }
      if (i % 50 === 0) {
        const t = e.rt.store.addTask(team.id, { title: `churn ${i}`, description: "d", createdBy: "lead" });
        if (t) e.rt.store.patchTask(team.id, t.id, { status: "completed" });
      }
      if (i % 25 === 0) e.clock.advance(100); // simulated time: 4 mails per 10 ms of wall-time-equivalent
      if (i % 500 === 0 && team.tasks.length > 200) team.tasks.splice(0, team.tasks.length - 50); // a long-lived team keeps a bounded list
      if (i % 2000 === 0) await e.rt.persistence.idle(); // a real server yields between requests: the write queue drains
      if (i === 20_000 || i === 100_000) {
        gc();
        heapAt.push(process.memoryUsage().heapUsed);
      }
    }
    await e.rt.persistence.idle();
    expect(acked).toBe(100_000);
    expect(e.rt.store.mailLog(team.id).length).toBeLessThanOrEqual(1000);
    const dir = path.join(e.fake.dataDir, "teams");
    const log = fs.statSync(path.join(dir, `${team.id}.mail.jsonl`)).size;
    expect(log).toBeLessThanOrEqual(cap + 4096);
    e.rt.persistence.flushSync();
    expect(fs.statSync(path.join(dir, `${team.id}.json`)).size).toBeLessThan(256 * 1024);
    const simulated = e.clock.now() - startClock;
    expect(counts.team).toBeLessThanOrEqual(Math.ceil(simulated / 100) + 2); // ≤ 1 team-file write per 100 ms
    expect(counts.team).toBeLessThan(100_000 / 10);
    const [warm, end] = heapAt as [number, number];
    expect(end).toBeLessThan(warm * 1.1 + 2 * 1024 * 1024); // < 10 % growth after warm-up (plus 2 MiB of allocator noise)
  }, 120_000);
});

describe("lead wake cost (S129)", () => {
  const leadWakes = (e: TeamsEnv): number => e.fake.base.emits.filter((m) => m.sessionId === e.lead && (m.data as { mails: Array<{ wake: boolean }> }).mails.some((x) => x.wake)).length;

  it("3 teammates approving shutdown within 1 s wake the lead exactly once (the spike woke it 3 times)", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    for (const n of ["a", "b", "c"]) e.addMember(team, n, "idle");
    for (const n of ["a", "b", "c"]) await e.call("lead", "ShutdownRequest", { to: n });
    const before = leadWakes(e);
    for (const n of ["a", "b", "c"]) {
      await e.call(n, "ShutdownResponse", { approve: true });
      await e.idle(n, { settleId: 1 });
      e.clock.advance(300);
    }
    await e.settle();
    e.clock.advance(2000);
    expect(leadWakes(e) - before).toBe(1);
  });

  it("5 task completions with immediate self-claim cost the lead 0 extra turns; only the final idle with nothing left wakes it", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    for (let i = 1; i <= 6; i++) e.rt.store.addTask(team.id, { title: `t${i}`, description: "d", createdBy: "lead" });
    const before = leadWakes(e);
    for (let i = 1; i <= 6; i++) {
      await e.idle("alice", { settleId: i, finalText: `finished ${i}` }); // the dispatcher claims the next task at once
      const current = team.tasks.find((t) => t.owner === "alice" && t.status === "in_progress");
      expect(current?.id).toBe(String(i));
      await e.call("alice", "TaskUpdate", { id: current?.id, status: "completed", result: "ok" });
      e.clock.advance(2000);
      await e.busy("alice");
    }
    expect(leadWakes(e) - before).toBe(0); // partial progress: every notice was non-waking
    await e.idle("alice", { settleId: 7, finalText: "all done" }); // nothing left to claim
    e.clock.advance(2000);
    expect(leadWakes(e) - before).toBe(1);
  });

  it("a rejection costs at most one lead turn", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "a", "idle");
    await e.call("lead", "ShutdownRequest", { to: "a" });
    const before = leadWakes(e);
    await e.call("a", "ShutdownResponse", { approve: false, reason: "not yet" });
    e.clock.advance(2000);
    expect(leadWakes(e) - before).toBe(1);
  });
});

describe("no polling (S130)", () => {
  it("an idle team of 5 for 10 simulated minutes: 0 mails, 0 emits, 0 writes, no pending timers", async () => {
    const { io, counts } = countingFs();
    const e = createTeamsEnv({ runtime: { fs: io } });
    const team = await e.createTeam();
    for (let i = 0; i < 5; i++) e.addMember(team, `m${i}`, "idle");
    await e.rt.persistence.idle();
    e.clock.advance(1000);
    await e.rt.persistence.idle();
    const writes = { ...counts };
    const emits = e.fake.base.emits.length;
    const mails = e.log(team).length;
    expect(e.clock.pendingCount).toBe(0);
    for (let i = 0; i < 600; i++) e.clock.advance(1000);
    await e.rt.persistence.idle();
    expect(e.log(team)).toHaveLength(mails);
    expect(e.fake.base.emits).toHaveLength(emits);
    expect(counts).toEqual(writes);
    expect(e.clock.pendingCount).toBe(0);
  });
});

describe("delivery latency (S124)", () => {
  it("500 sequential mails to an idle recipient: server emit → bridge custom message p95 < 100 ms", async () => {
    const env = createTeamsEnv();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    env.fake.addSession("S-alice");
    env.fake.resolveSession("S-alice", { "agent-teams": { teamId: team.id, member: "alice", role: "member" } });
    const scope = env.fake.base.spawns[0]?.scope as { extensionConfig: Record<string, Record<string, string>> } | undefined;
    const ext = scope?.extensionConfig["agent-teams"] as Record<string, string>;
    const alice = linkBridge(env, "alice", { env: { [ENV_TEAM_ID]: ext.teamId as string, [ENV_MEMBER]: "alice", [ENV_POLICY]: ext.policy as string } });
    await alice.pi.fire("session_start", {});
    await env.settle();
    await env.idle("alice", { settleId: 1, finalText: "ready" });
    alice.pi.sent.length = 0;
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      env.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: `mail ${i}`, wake: false });
      samples.push(performance.now() - t0);
      expect(alice.pi.sent).toHaveLength(i + 1); // handed to pi within the emit itself
      for (let k = 0; k < 6; k++) await Promise.resolve(); // let the ack round trip finish
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(100);
    expect(env.mailsTo(team, "alice").filter((m) => m.kind === "notice" && m.ackedAt === undefined)).toEqual([]);
  });
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function restApp(e: TeamsEnv): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  await mountTeamsRoutes(app, { store: e.rt.store, telemetry: e.rt.telemetry, ext: e.rt.ext, logger: e.fake.host.logger });
  await app.ready();
  return app;
}

describe("snapshot size/time (S126)", () => {
  it("50 tasks + 120 mails of 5000 chars: mail ≤ 100 entries of ≤ 2000 chars (truncated), p95 < 100 ms, JSON < 400 KB", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    for (let i = 0; i < 50; i++) e.rt.store.addTask(team.id, { title: `task ${i}`, description: "d".repeat(500), createdBy: "lead" });
    for (let i = 0; i < 120; i++) e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: "m".repeat(5000) });
    const app = await restApp(e);
    const url = `${API_PREFIX}/teams/${team.id}`;
    await app.inject({ method: "GET", url }); // warm-up (counts toward the 16-request burst)
    const samples: number[] = [];
    let size = 0;
    for (let i = 0; i < 14; i++) {
      const t0 = performance.now();
      const res = await app.inject({ method: "GET", url });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      size = res.body.length;
    }
    samples.sort((a, b) => a - b);
    expect(p(samples, 0.95)).toBeLessThan(100);
    expect(size).toBeLessThan(400 * 1024);
  });

  it("the bounded view is what is served: ≤ 100 entries, each ≤ 2000 chars and flagged", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    for (let i = 0; i < 120; i++) e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: "m".repeat(5000) });
    const app = await restApp(e);
    const body = (await app.inject({ method: "GET", url: `${API_PREFIX}/teams/${team.id}` })).json() as { mail: Array<{ text: string; truncated: boolean }>; mailTotal: number };
    expect(body.mail).toHaveLength(100);
    expect(body.mailTotal).toBe(120);
    for (const m of body.mail) {
      expect(m.text).toHaveLength(2000);
      expect(m.truncated).toBe(true);
    }
  });
});

describe("REST rate limit (S127)", () => {
  it("8 requests in a second are never limited; 30 more yield a 429; the limit is per client, not global", async () => {
    const e = createTeamsEnv();
    const app = await restApp(e);
    const hit = async (remoteAddress: string) => (await app.inject({ method: "GET", url: `${API_PREFIX}/teams`, remoteAddress })).statusCode;
    for (let i = 0; i < 8; i++) expect(await hit("10.0.0.1")).toBe(200);
    const next: number[] = [];
    for (let i = 0; i < 30; i++) next.push(await hit("10.0.0.1"));
    expect(next.filter((c) => c === 429).length).toBeGreaterThanOrEqual(1);
    expect(next.filter((c) => c === 200).length).toBe(8); // burst 16 = 8 + 8, the rest limited
    expect(await hit("10.0.0.2")).toBe(200); // another client is untouched
  });

  it("a limited response says so in the body", async () => {
    const e = createTeamsEnv();
    const app = await restApp(e);
    let last = await app.inject({ method: "GET", url: `${API_PREFIX}/teams` });
    for (let i = 0; i < 20; i++) last = await app.inject({ method: "GET", url: `${API_PREFIX}/teams` });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toEqual({ error: "rate_limited" });
  });
});
