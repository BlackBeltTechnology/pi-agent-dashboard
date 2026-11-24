/**
 * Store persistence (test-plan S74 restart reload, S77 crash-safe write, S78
 * write-through, S79 mutation order, S80 mail-log compaction, S81 quarantine,
 * S82 retention pruning, S83 persist failure; S84 redelivery persistence half).
 * "Kill" = a second store over the same directory WITHOUT a flush.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createFakeRuntimeHost, createStoreEnv, FakeClock, memberFixture, type StoreEnv } from "../../__tests__/harness/index.js";
import type { TeamListResponse, TeamSnapshot } from "../../shared/snapshot.js";
import { createExtensionPoints } from "../extension-points.js";
import { mailLineBytes, nodePersistFs, type PersistFs, selectCompaction } from "../persistence.js";
import { API_PREFIX, mountTeamsRoutes } from "../routes.js";
import { createTeamsRuntime } from "../runtime.js";
import { createTelemetry } from "../telemetry.js";
import { silentLogger } from "../types.js";

const DAY = 86_400_000;

/** `GET` against the real REST routes mounted over a store env's store. */
async function restGet<T>(env: StoreEnv, url: string): Promise<{ status: number; body: T }> {
  const app = Fastify();
  try {
    await mountTeamsRoutes(app, { store: env.store, telemetry: createTelemetry(silentLogger), ext: createExtensionPoints(), logger: silentLogger });
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}${url}` });
    return { status: res.statusCode, body: res.json() as T };
  } finally {
    await app.close();
  }
}

function seedTeam(env: StoreEnv) {
  const team = env.store.createTeam({ name: "alpha", leadSessionId: "S-lead", leadCwd: "/work", mode: "session", maxTeammates: 5 });
  env.store.reserveMember(team.id, { ...memberFixture("alice"), sessionId: "S-alice", status: "busy" } as never);
  env.store.reserveMember(team.id, { ...memberFixture("bob"), sessionId: "S-bob" } as never);
  const t1 = env.store.addTask(team.id, { title: "one", description: "d1", createdBy: "lead" });
  env.store.addTask(team.id, { title: "two", description: "d2", createdBy: "lead", blockedBy: ["1"] });
  env.store.addTask(team.id, { title: "three", description: "d3", createdBy: "lead" });
  if (!t1) throw new Error("task");
  env.store.patchTask(team.id, "1", { status: "in_progress", owner: "alice" });
  const m1 = env.store.appendMail(team.id, { from: "alice", to: "lead", kind: "message", text: "hello" });
  const m2 = env.store.appendMail(team.id, { from: "lead", to: "bob", kind: "message", text: "acked one" });
  env.store.ackMail(team.id, [m2?.id as number]);
  return { team, unackedId: m1?.id as number };
}

function failingFs(over: Partial<PersistFs>): PersistFs {
  return { ...nodePersistFs, ...over };
}

describe("restart reload (S74)", () => {
  it("reloads team, tasks and mail; members and lead come back disconnected; index rebuilt", async () => {
    const env = createStoreEnv();
    const { team, unackedId } = seedTeam(env);
    await env.persistence.flush();
    const before = structuredClone(env.store.get(team.id));
    const mailBefore = structuredClone(env.store.mailLog(team.id));

    const env2 = env.restart();
    const after = env2.store.get(team.id);
    expect(after).toBeDefined();
    if (!before || !after) return;
    expect(after.leadConnected).toBe(false);
    expect(after.members.map((m) => [m.name, m.status])).toEqual([
      ["alice", "disconnected"],
      ["bob", "disconnected"],
    ]);
    // Deep-equal modulo the disconnected marking.
    const normalised = structuredClone(before);
    normalised.leadConnected = false;
    for (const m of normalised.members) m.status = "disconnected";
    expect(after).toEqual(normalised);
    expect(env2.store.mailLog(team.id)).toEqual(mailBefore);
    expect(env2.store.pendingMail(team.id, "lead").map((m) => m.id)).toEqual([unackedId]);
    expect(env2.store.findBySession("S-lead")).toEqual({ teamId: team.id, who: "lead" });
    expect(env2.store.findBySession("S-alice")).toEqual({ teamId: team.id, who: "alice" });
    expect(env2.store.findBySession("S-bob")).toEqual({ teamId: team.id, who: "bob" });
    expect(env2.store.task(after, "1")?.status).toBe("in_progress");
  });

  it("keeps `spawning` (for reconciliation) and terminal statuses across a restart", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    env.store.reserveMember(team.id, memberFixture("s", { status: "spawning" }) as never);
    env.store.reserveMember(team.id, memberFixture("g", { status: "gone", sessionId: "S-g" }) as never);
    env.store.reserveMember(team.id, memberFixture("f", { status: "failed" }) as never);
    await env.persistence.flush();
    const t2 = env.restart().store.get(team.id);
    expect(t2?.members.map((m) => m.status)).toEqual(["spawning", "gone", "failed"]);
    expect(env.restart().store.findBySession("S-g")).toBeUndefined();
  });

  it("a closed team is loaded but its sessions are not indexed", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    env.store.setTeamStatus(team.id, "closed", { closeReason: "team_delete" });
    await env.persistence.flush();
    const env2 = env.restart();
    expect(env2.store.get(team.id)?.status).toBe("closed");
    expect(env2.store.findBySession("L")).toBeUndefined();
  });
});

describe("redelivery persistence (S84, store half)", () => {
  it("unacked mail reloads once; acked mail is never pending again", async () => {
    const env = createStoreEnv();
    const { team, unackedId } = seedTeam(env);
    await env.persistence.idle();
    for (let i = 0; i < 2; i++) {
      const e = env.restart();
      expect(e.store.pendingMail(team.id, "lead").map((m) => m.id)).toEqual([unackedId]);
      expect(e.store.pendingMail(team.id, "bob")).toEqual([]);
    }
    const e = env.restart();
    e.store.ackMail(team.id, [unackedId]);
    await e.persistence.idle();
    expect(env.restart().store.pendingMail(team.id, "lead")).toEqual([]);
  });

  it("an ack for an already-acked or unknown id is a no-op", () => {
    const env = createStoreEnv();
    const { team, unackedId } = seedTeam(env);
    expect(env.store.ackMail(team.id, [unackedId])).toEqual([unackedId]);
    const rev = env.store.rev(team.id);
    expect(env.store.ackMail(team.id, [unackedId, 9999])).toEqual([]);
    expect(env.store.rev(team.id)).toBe(rev);
  });
});

describe("crash-safe write (S77)", () => {
  it("a process killed between temp write and rename leaves the previous file; temp is cleaned on load", async () => {
    let failRename = false;
    const env = createStoreEnv({
      fs: failingFs({
        async rename(from, to) {
          if (failRename) throw new Error("killed before rename");
          await nodePersistFs.rename(from, to);
        },
      }),
    });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    await env.persistence.flush();
    const complete = fs.readFileSync(env.persistence.teamFile(team.id), "utf8");

    failRename = true;
    env.store.addTask(team.id, { title: "lost", description: "d", createdBy: "lead" });
    await env.persistence.flush();
    const stray = fs.readdirSync(env.teamsDir).filter((f) => f.endsWith(".tmp"));
    expect(stray.length).toBeGreaterThan(0);
    expect(fs.readFileSync(env.persistence.teamFile(team.id), "utf8")).toBe(complete);

    const env2 = env.restart({ fs: nodePersistFs });
    expect(fs.readdirSync(env.teamsDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(env2.store.get(team.id)?.tasks).toEqual([]);
    expect(env2.store.get(team.id)?.name).toBe("t");
  });
});

describe("write-through and shutdown flush (S78)", () => {
  it("claim and completion hit disk immediately; ordinary mutations lag ≤100 ms; flushSync writes the rest", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const env = createStoreEnv({ clock });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    env.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead" });
    env.store.addTask(team.id, { title: "b", description: "d", createdBy: "lead" });
    env.store.patchTask(team.id, "1", { status: "in_progress", owner: "alice" }); // claim: write-through
    clock.advance(10); // "SIGKILL at +10 ms"
    await env.persistence.idle();

    const killed = env.restart().store.get(team.id);
    expect(killed?.tasks.map((t) => [t.id, t.status, t.owner])).toEqual([
      ["1", "in_progress", "alice"],
      ["2", "pending", undefined],
    ]);

    env.store.addTask(team.id, { title: "c", description: "d", createdBy: "lead" }); // ordinary: coalesced
    clock.advance(10);
    await env.persistence.idle();
    expect(env.restart().store.get(team.id)?.tasks).toHaveLength(2);

    env.store.patchTask(team.id, "1", { status: "completed", result: "done" }); // completion: write-through
    await env.persistence.idle();
    const completed = env.restart().store.get(team.id);
    expect(completed?.tasks[0]).toMatchObject({ status: "completed", result: "done" });
    expect(completed?.tasks).toHaveLength(3); // the earlier ordinary mutation rode along, in order

    env.store.addTask(team.id, { title: "d", description: "d", createdBy: "lead" });
    env.persistence.flushSync(); // ctx.onShutdown
    expect(env.restart().store.get(team.id)?.tasks).toHaveLength(4);
  });

  it("an ordinary mutation reaches disk after the 100 ms window", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const env = createStoreEnv({ clock });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    await env.persistence.idle();
    env.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead" });
    clock.advance(99);
    await env.persistence.idle();
    expect(env.restart().store.get(team.id)?.tasks).toHaveLength(0);
    clock.advance(1);
    await env.persistence.idle();
    expect(env.restart().store.get(team.id)?.tasks).toHaveLength(1);
  });
});

describe("mutation order (S79)", () => {
  it("1000 rapid mutations under random write latency never reorder or roll back on disk", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const seen: number[] = [];
    const env = createStoreEnv({
      clock,
      fs: failingFs({
        async writeFile(file, data) {
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
          await nodePersistFs.writeFile(file, data);
        },
        async rename(from, to) {
          const parsed = JSON.parse(fs.readFileSync(from, "utf8")) as { nextTaskId: number };
          seen.push(parsed.nextTaskId);
          await nodePersistFs.rename(from, to);
        },
      }),
    });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    for (let i = 0; i < 1000; i++) {
      env.store.addTask(team.id, { title: `t${i}`, description: "d", createdBy: "lead" });
      if (i % 25 === 0) {
        clock.advance(100);
        await new Promise((r) => setTimeout(r, 1));
      }
    }
    await env.persistence.flush();
    expect(seen.length).toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) expect(seen[i] as number).toBeGreaterThanOrEqual(seen[i - 1] as number);
    const onDisk = JSON.parse(fs.readFileSync(env.persistence.teamFile(team.id), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(env.store.get(team.id))));
  });
});

describe("mail log compaction (S80)", () => {
  const BODY = "x".repeat(2000);

  function appendN(env: StoreEnv, teamId: string, n: number) {
    for (let i = 0; i < n; i++) env.store.appendMail(teamId, { from: "alice", to: "lead", kind: "message", text: BODY });
  }

  for (const [label, delta, expected] of [
    ["cap-1", 1, 0],
    ["cap", 0, 0],
    ["cap+1", -1, 1],
  ] as const) {
    it(`compacts only when the log exceeds the cap (${label})`, async () => {
      let cap = 10 * 1024 * 1024;
      const env = createStoreEnv({ maxMailLogBytes: () => cap });
      const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
      appendN(env, team.id, 5);
      env.store.ackMail(team.id, [1, 2, 3]);
      await env.persistence.idle();
      const next = {
        id: env.store.get(team.id)?.nextMailId as number,
        from: "alice",
        to: "lead",
        kind: "message",
        text: BODY,
        priority: "normal" as const,
        wake: false,
        createdAt: env.clock.now(),
      };
      const after = env.persistence.logBytes(team.id) + mailLineBytes(next);
      cap = after + delta;
      appendN(env, team.id, 1);
      await env.persistence.idle();
      expect(env.persistence.compactions).toBe(expected);
    });
  }

  it("keeps every unacked entry plus the newest acked until the log is ≤ 50 % of the cap", async () => {
    const cap = 40 * 1024;
    const env = createStoreEnv({ maxMailLogBytes: () => cap });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    appendN(env, team.id, 3);
    env.store.ackMail(team.id, [1, 2]); // 3 stays unacked
    for (let i = 0; i < 25; i++) {
      const m = env.store.appendMail(team.id, { from: "a", to: "lead", kind: "message", text: BODY });
      env.store.ackMail(team.id, [m?.id as number]);
    }
    await env.persistence.idle();
    expect(env.persistence.compactions).toBeGreaterThan(0);
    const size = fs.statSync(env.persistence.mailFile(team.id)).size;
    expect(size).toBeLessThanOrEqual(cap);
    const kept = env.store.mailLog(team.id);
    expect(kept.some((m) => m.id === 3 && m.ackedAt === undefined)).toBe(true);
    const reloaded = env.restart({ maxMailLogBytes: () => cap }).store.mailLog(team.id);
    expect(reloaded.map((m) => m.id)).toEqual(kept.map((m) => m.id));
    expect(reloaded.find((m) => m.id === 3)?.ackedAt).toBeUndefined();
  });

  it("selectCompaction never drops unacked mail even when it alone exceeds half the cap", () => {
    const mails = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      from: "a",
      to: "lead",
      kind: "message",
      text: BODY,
      priority: "normal" as const,
      wake: false,
      createdAt: 1,
    }));
    const { keep, dropped } = selectCompaction(mails, 4096);
    expect(keep).toHaveLength(6);
    expect(dropped).toEqual([]);
    const acked = mails.map((m) => ({ ...m, ackedAt: 2 }));
    const half = selectCompaction(acked, 12_000);
    expect(half.keep.map((m) => m.id)).toEqual([4, 5, 6].slice(-half.keep.length));
    expect(half.keep.reduce((n, m) => n + mailLineBytes(m), 0)).toBeLessThanOrEqual(6000);
  });

  it("the team JSON does not embed mail and stays small", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    appendN(env, team.id, 60);
    await env.persistence.flush();
    expect(fs.statSync(env.persistence.teamFile(team.id)).size).toBeLessThan(2048);
    expect(fs.readFileSync(env.persistence.teamFile(team.id), "utf8")).not.toContain(BODY.slice(0, 50));
    expect(fs.statSync(env.persistence.mailFile(team.id)).size).toBeGreaterThan(60 * 2000);
  });

  it("compacts at load when the log already exceeds the cap", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    appendN(env, team.id, 20);
    env.store.ackMail(team.id, Array.from({ length: 18 }, (_, i) => i + 1));
    await env.persistence.flush();
    const env2 = env.restart({ maxMailLogBytes: () => 20_000 });
    const ids = env2.store.mailLog(team.id).map((m) => m.id);
    expect(ids).toContain(19);
    expect(ids).toContain(20);
    expect(fs.statSync(env2.persistence.mailFile(team.id)).size).toBeLessThanOrEqual(20_000);
  });
});

describe("corrupt or newer file (S81)", () => {
  it("skips, renames and logs each bad file once; other teams load; reported unavailable", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "ok", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    await env.persistence.flush();
    const dir = env.teamsDir;
    fs.writeFileSync(path.join(dir, "trunc.json"), '{"id":"trunc","name":"x","sche');
    fs.writeFileSync(path.join(dir, "empty.json"), "");
    fs.writeFileSync(path.join(dir, "wrong.json"), JSON.stringify({ id: 5, name: [], status: 1, schemaVersion: 1 }));
    fs.writeFileSync(path.join(dir, "future.json"), JSON.stringify({ id: "future", schemaVersion: 2, whatever: true }));

    const env2 = env.restart();
    expect(env2.store.get(team.id)?.name).toBe("ok");
    expect(fs.existsSync(path.join(dir, "trunc.json.corrupt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "empty.json.corrupt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "wrong.json.corrupt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "future.json.future"))).toBe(true);
    for (const id of ["trunc", "empty", "wrong", "future"]) {
      expect(fs.existsSync(path.join(dir, `${id}.json`))).toBe(false);
      expect(env2.logs.warn.filter((l) => l.includes(` ${id} `))).toHaveLength(1);
    }
    expect(env2.store.unavailableTeams.map((u) => `${u.id}:${u.reason}`).sort()).toEqual([
      "empty:corrupt",
      "future:future",
      "trunc:corrupt",
      "wrong:corrupt",
    ]);

    const env3 = env2.restart();
    expect(env3.store.unavailableTeams).toHaveLength(4);
    expect(env3.logs.warn).toEqual([]);
    expect(env3.store.get(team.id)?.name).toBe("ok");
  });
});

describe("corrupt or newer file (S81, REST half)", () => {
  it("REST lists each quarantined file as unavailable, without a path, and still lists the healthy team", async () => {
    const env = createStoreEnv();
    const team = env.store.createTeam({ name: "ok", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    await env.persistence.flush();
    fs.writeFileSync(path.join(env.teamsDir, "bad.json"), '{"id":"bad","sche');
    fs.writeFileSync(path.join(env.teamsDir, "new.json"), JSON.stringify({ id: "new", schemaVersion: 2 }));
    const env2 = env.restart();
    const { status, body } = await restGet<TeamListResponse>(env2, "/teams");
    expect(status).toBe(200);
    expect(body.teams.map((t) => t.id)).toEqual([team.id]);
    expect([...body.unavailable].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "bad", reason: "corrupt" },
      { id: "new", reason: "future" },
    ]);
    expect(JSON.stringify(body)).not.toContain(env2.teamsDir);
    expect((await restGet(env2, "/teams/new")).status).toBe(404); // unavailable ≠ a team that can be fetched
  });
});

describe("persist failure (S83, REST half)", () => {
  it("persist_degraded is true in the list and the snapshot after a failed write and clears on the next successful one", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    let fail = true;
    const env = createStoreEnv({
      clock,
      fs: failingFs({
        async writeFile(file, data) {
          if (fail) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
          await nodePersistFs.writeFile(file, data);
        },
      }),
    });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    await env.persistence.idle();
    expect((await restGet<TeamListResponse>(env, "/teams")).body.persist_degraded).toBe(true);
    const degraded = await restGet<TeamSnapshot>(env, `/teams/${team.id}`);
    expect(degraded.body.persist_degraded).toBe(true);
    expect(degraded.body.name).toBe("t"); // state stays served from memory
    fail = false;
    env.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead" });
    clock.advance(100);
    await env.persistence.idle();
    expect((await restGet<TeamSnapshot>(env, `/teams/${team.id}`)).body.persist_degraded).toBe(false);
  });
});

describe("closed-team pruning (S82)", () => {
  it("removes closed teams older than closedRetentionDays, keeps younger and open teams", async () => {
    for (const retention of [7, 3]) {
      const clock = new FakeClock(1_700_000_000_000);
      const env = createStoreEnv({ clock, closedRetentionDays: () => retention });
      const mk = (name: string) => env.store.createTeam({ name, leadSessionId: `L-${name}`, leadCwd: "/w", mode: "session", maxTeammates: 5 });
      const old = mk("old");
      const young = mk("young");
      const open = mk("open");
      env.store.appendMail(old.id, { from: "a", to: "lead", kind: "message", text: "x" });
      // old closes retention+1 days before "now"; young closes retention-1 days before.
      env.store.setTeamStatus(old.id, "closed", { closeReason: "team_delete" });
      clock.advance(2 * DAY);
      env.store.setTeamStatus(young.id, "closed", { closeReason: "team_delete" });
      clock.advance((retention - 1) * DAY);
      await env.persistence.flush();

      const env2 = env.restart({ closedRetentionDays: () => retention });
      expect(env2.store.get(old.id)).toBeUndefined();
      expect(fs.existsSync(env.persistence.teamFile(old.id))).toBe(false);
      expect(fs.existsSync(env.persistence.mailFile(old.id))).toBe(false);
      expect(env2.store.get(young.id)?.status).toBe("closed");
      expect(env2.store.get(open.id)?.status).toBe("active");
    }
  });

  it("closedRetentionDays defaults to 7 when not configured", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const env = createStoreEnv({ clock });
    const a = env.store.createTeam({ name: "a", leadSessionId: "La", leadCwd: "/w", mode: "session", maxTeammates: 5 });
    env.store.setTeamStatus(a.id, "closed", { closeReason: "user" });
    await env.persistence.flush();
    clock.advance(7 * DAY - 1);
    expect(env.restart().store.get(a.id)).toBeDefined();
    clock.advance(2);
    expect(env.restart().store.get(a.id)).toBeUndefined();
  });
});

describe("persist failure (S83)", () => {
  it("keeps state in memory, logs the first failure, flags persist_degraded, and the next mutation retries and clears it", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    let fail = 2;
    const env = createStoreEnv({
      clock,
      fs: failingFs({
        async writeFile(file, data) {
          if (fail > 0) {
            fail--;
            throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
          }
          await nodePersistFs.writeFile(file, data);
        },
      }),
    });
    const team = env.store.createTeam({ name: "t", leadSessionId: "L", leadCwd: "/w", mode: "session", maxTeammates: 5 }); // write-through → fails
    await env.persistence.idle();
    expect(env.store.persistDegraded).toBe(true);
    expect(env.store.get(team.id)?.name).toBe("t");
    expect(env.logs.error).toHaveLength(1);

    env.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead" }); // second failure, same streak
    clock.advance(100);
    await env.persistence.idle();
    expect(env.store.persistDegraded).toBe(true);
    expect(env.logs.error).toHaveLength(1);

    env.store.addTask(team.id, { title: "b", description: "d", createdBy: "lead" }); // retries, succeeds
    clock.advance(100);
    await env.persistence.idle();
    expect(env.store.persistDegraded).toBe(false);
    expect(env.restart().store.get(team.id)?.tasks.map((t) => t.title)).toEqual(["a", "b"]);
  });
});

describe("closing resume (S136)", () => {
  it("a team persisted as closing resumes at startup: shutdown re-requested, sessions ended after the grace, closed once, one team_closed", async () => {
    const clock1 = new FakeClock(1_700_000_000_000);
    const fake1 = createFakeRuntimeHost();
    const rt1 = createTeamsRuntime(fake1.host, { clock: clock1, ext: createExtensionPoints() });
    fake1.addSession("S-lead", { cwd: "/work" });
    const created = await fake1.call("S-lead", "TeamCreate", { name: "t" });
    const teamId = created.data.teamId as string;
    for (const name of ["alice", "bob"]) {
      fake1.addSession(`S-${name}`, { cwd: "/work" });
      rt1.store.reserveMember(teamId, memberFixture(name, { sessionId: `S-${name}` }) as never);
    }
    const team1 = rt1.store.get(teamId);
    if (!team1) throw new Error("team");
    rt1.ops.teamDelete(team1, { actor: "user" });
    await rt1.persistence.flush();
    expect(JSON.parse(fs.readFileSync(rt1.persistence.teamFile(teamId), "utf8")).status).toBe("closing");
    rt1.ops.dispose(); // the grace timer is lost with the "process"

    const clock2 = new FakeClock(clock1.now());
    const fake2 = createFakeRuntimeHost({ dataDir: fake1.dataDir });
    for (const id of ["S-lead", "S-alice", "S-bob"]) fake2.addSession(id, { cwd: "/work" });
    const rt2 = createTeamsRuntime(fake2.host, { clock: clock2, ext: createExtensionPoints() });
    const team2 = rt2.store.get(teamId);
    expect(team2?.status).toBe("closing");
    const requests = rt2.store.pendingMail(teamId, "alice").filter((m) => m.kind === "shutdown_request");
    expect(requests.length).toBeGreaterThanOrEqual(1); // re-requested
    clock2.advance(9_999);
    expect(fake2.base.shutdowns).toEqual([]);
    clock2.advance(1);
    await vi.waitFor(() => expect(rt2.store.get(teamId)?.status).toBe("closed"));
    expect(fake2.base.shutdowns.sort()).toEqual(["S-alice", "S-bob"]);
    clock2.advance(120_000);
    await Promise.resolve();
    expect(fake2.base.emits.filter((e) => e.eventType === "agent-teams:team_closed")).toHaveLength(1);
    await rt2.persistence.flush();

    const fake3 = createFakeRuntimeHost({ dataDir: fake1.dataDir });
    const rt3 = createTeamsRuntime(fake3.host, { clock: new FakeClock(clock2.now()), ext: createExtensionPoints() });
    expect(rt3.store.get(teamId)?.status).toBe("closed");
    expect(fake3.base.emits).toEqual([]);
    expect(fake3.base.shutdowns).toEqual([]);
  });
});
