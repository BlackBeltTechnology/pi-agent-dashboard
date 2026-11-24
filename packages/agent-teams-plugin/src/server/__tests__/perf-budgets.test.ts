/**
 * Performance / cost regression gates on the injected clock and the fake host
 * (test-plan S125 store-op tail latency, S128 persistence soak, S129 lead wake
 * cost, S130 no polling). Budgets are generous regression gates (decision A12),
 * not SLOs: they catch O(n²) and sync-IO regressions. Delivery latency through a
 * real bridge (S124) and the REST rows (S126/S127) belong to the bridge/routes
 * suites.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import type { Team } from "../../shared/types.js";
import { nodePersistFs, type PersistFs } from "../persistence.js";

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
