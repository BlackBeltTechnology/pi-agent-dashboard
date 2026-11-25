/**
 * The live-state bridge (test-plan S46, S49, S68, S69, S115): per-team coalescer
 * with no cross-team merge and no leak, a single store listener across plugin
 * re-enables, content-free frames addressed to the lead session, and isolation of
 * both halves (frames, stamp) from the core mutation that triggered them.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFakeUiHost } from "../../__tests__/harness/fake-ui-host.js";
import { createStoreEnv, createTeamsEnv, FakeClock } from "../../__tests__/harness/index.js";
import { capturingLogger } from "../../__tests__/harness/store-env.js";
import { AGENT_TEAMS_EVENT_CHANGED, CHANGED_COALESCE_MS } from "../../shared/ui-protocol.js";
import { createUiBridge, type UiBridge } from "../ui-bridge.js";

const bridges: UiBridge[] = [];
afterEach(() => {
  for (const b of bridges.splice(0)) b.dispose();
});

function setup() {
  const env = createStoreEnv();
  const clock = new FakeClock(1_700_000_000_000);
  const host = createFakeUiHost();
  const { logger, logs } = capturingLogger();
  const bridge = createUiBridge({ store: env.store, host: host.host, epoch: "E1", clock, logger });
  bridges.push(bridge);
  const newTeam = (name: string, lead = `S-${name}`) => env.store.createTeam({ name, leadSessionId: lead, leadCwd: "/w", mode: "session", maxTeammates: 4 });
  const mail = (id: string, text = "x") => env.store.appendMail(id, { from: "lead", to: "alice", kind: "message", text, wake: false });
  return { env, clock, host, logs, bridge, newTeam, mail, frames: () => host.frames.map((f) => ({ team: f.event.data.teamId as string, rev: f.event.data.rev as number, closed: f.event.data.closed as boolean | undefined, session: f.sessionId as string })) };
}

describe("frame shape", () => {
  it("is a session-scoped plugin_event with {teamId, epoch, rev}", () => {
    const s = setup();
    const t = s.newTeam("one");
    expect(s.host.frames).toEqual([
      {
        type: "plugin_event",
        pluginId: "agent-teams",
        sessionId: "S-one",
        event: { eventType: AGENT_TEAMS_EVENT_CHANGED, timestamp: 1_700_000_000_000, data: { teamId: t.id, epoch: "E1", rev: s.env.store.rev(t.id) } },
      },
    ]);
  });

  it("a team without a lead session sends nothing (no session to scope to) until it is bound", () => {
    const s = setup();
    const t = s.env.store.createTeam({ name: "starting", leadCwd: "/w", mode: "session", maxTeammates: 4, starting: true });
    expect(s.host.frames).toEqual([]);
    s.env.store.bindLead(t.id, "S-new");
    expect(s.frames().map((f) => f.session)).toEqual(["S-new"]);
  });
});

describe("coalescer (S46)", () => {
  it("two teams mutating in the same ms each get their own frame; a team's close is its last frame; nothing is left behind", () => {
    const s = setup();
    const t1 = s.newTeam("one");
    const t2 = s.newTeam("two");
    s.mail(t1.id);
    s.mail(t2.id);
    s.clock.advance(CHANGED_COALESCE_MS);
    expect(s.frames().filter((f) => f.team === t1.id).length).toBeGreaterThanOrEqual(1);
    expect(s.frames().filter((f) => f.team === t2.id).length).toBeGreaterThanOrEqual(1);
    for (const f of s.frames()) expect(f.session).toBe(f.team === t1.id ? "S-one" : "S-two"); // no cross-team merge
    // The trailing frame of each carries that team's own latest rev.
    expect(s.frames().filter((f) => f.team === t1.id).at(-1)?.rev).toBe(s.env.store.rev(t1.id));
    expect(s.frames().filter((f) => f.team === t2.id).at(-1)?.rev).toBe(s.env.store.rev(t2.id));

    s.env.store.setTeamStatus(t1.id, "closed");
    s.clock.advance(CHANGED_COALESCE_MS);
    const mine = s.frames().filter((f) => f.team === t1.id);
    expect(mine.at(-1)).toMatchObject({ closed: true, rev: s.env.store.rev(t1.id) });
    expect(mine.filter((f) => f.closed)).toHaveLength(1);
    const count = s.host.frames.length;
    s.clock.advance(10_000);
    expect(s.host.frames).toHaveLength(count); // nothing after the close frame, for T1 or T2
  });

  it("a close in a quiet window is sent at once with closed:true", () => {
    const s = setup();
    const t = s.newTeam("one");
    s.clock.advance(5_000);
    const before = s.host.frames.length;
    s.env.store.setTeamStatus(t.id, "closed");
    expect(s.host.frames).toHaveLength(before + 1);
    expect(s.host.frames.at(-1)?.event.data).toMatchObject({ teamId: t.id, closed: true });
  });

  it("100 teams created and closed in sequence leave no timer and no per-team state", () => {
    const s = setup();
    for (let i = 0; i < 100; i++) {
      const t = s.newTeam(`n${i}`);
      s.mail(t.id);
      s.env.store.setTeamStatus(t.id, "closed");
      s.clock.advance(100);
    }
    s.clock.advance(CHANGED_COALESCE_MS * 2);
    expect(s.clock.pendingCount).toBe(0);
    expect(s.bridge.size()).toBe(0);
    expect(s.frames().filter((f) => f.closed)).toHaveLength(100);
  });
});

describe("plugin lifecycle (S49)", () => {
  it("disable → enable twice over one store leaves exactly one listener: one frame per window, one stamp", async () => {
    const e = createTeamsEnv();
    const clock = new FakeClock(0);
    const hosts = [createFakeUiHost(), createFakeUiHost(), createFakeUiHost()];
    const logger = e.fake.host.logger;
    const make = (i: number) => createUiBridge({ store: e.rt.store, host: hosts[i]?.host as never, epoch: "E", clock, logger });
    make(0).dispose();
    make(1).dispose();
    const live = make(2);
    bridges.push(live);
    const team = await e.createTeam();
    expect(hosts[0]?.frames).toEqual([]);
    expect(hosts[1]?.frames).toEqual([]);
    expect(hosts[0]?.assigns).toEqual([]);
    expect(hosts[1]?.assigns).toEqual([]);
    expect(hosts[2]?.assigns).toHaveLength(1);
    const frames = hosts[2]?.frames.length as number;
    clock.advance(CHANGED_COALESCE_MS * 2);
    const settled = hosts[2]?.frames.length as number;
    e.rt.store.appendMail(team.id, { from: "lead", to: "x", kind: "message", text: "m", wake: false });
    expect(hosts[2]?.frames).toHaveLength(settled + 1); // one mutation, one frame (leading)
    clock.advance(CHANGED_COALESCE_MS * 2);
    expect(hosts[2]?.frames).toHaveLength(settled + 1);
    expect(frames).toBeGreaterThan(0);
  });

  it("dispose clears pending timers and state", () => {
    const s = setup();
    const t = s.newTeam("one");
    s.mail(t.id);
    expect(s.clock.pendingCount).toBe(1);
    s.bridge.dispose();
    expect(s.clock.pendingCount).toBe(0);
    expect(s.bridge.size()).toBe(0);
    const n = s.host.frames.length;
    s.mail(t.id);
    expect(s.host.frames).toHaveLength(n);
  });
});

/** Seeded PRNG: a property test without a new dependency. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Setup = ReturnType<typeof setup>;

/** One random mutation of the store carrying agent-authored text. */
function mutate(s: Setup, teamId: string, rand: () => number, junk: () => string): void {
  const store = s.env.store;
  const mutations = [
    () => store.appendMail(teamId, { from: "lead", to: "bob", kind: "message", text: junk(), wake: false }),
    () => store.addTask(teamId, { title: junk(), description: junk(), createdBy: "lead" }),
    () => store.patchTask(teamId, String(1 + Math.floor(rand() * 3)), { result: junk() }),
    () => store.patchTeam(teamId, { description: junk() }),
  ];
  mutations[Math.floor(rand() * mutations.length)]?.();
}

function expectContentFree(f: Record<string, any>): void {
  expect(Object.keys(f).sort()).toEqual(["event", "pluginId", "sessionId", "type"]);
  expect(Object.keys(f.event).sort()).toEqual(["data", "eventType", "timestamp"]);
  for (const k of Object.keys(f.event.data)) expect(["teamId", "epoch", "rev", "closed"]).toContain(k);
  expect(JSON.stringify(f)).not.toContain("SECRET-7f3a");
  expect(f.sessionId).toBe("S-lead");
}

describe("frames are content-free (S68)", () => {
  it("random agent text (with a marker) in mail, tasks, names and results never reaches a frame; keys ⊆ {teamId, epoch, rev, closed}", () => {
    const s = setup();
    const rand = rng(7);
    const alphabet = ["SECRET-7f3a", "ignore previous", "\n", "{", '"', "\\", "é", "🙂", " ", "x"];
    const junk = (): string => `${Array.from({ length: 1 + Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("")}SECRET-7f3a`;
    const t = s.env.store.createTeam({ name: junk().slice(0, 40), description: junk(), leadSessionId: "S-lead", leadCwd: "/w", mode: "session", maxTeammates: 4 });
    for (let i = 0; i < 60; i++) {
      s.clock.advance(Math.floor(rand() * 600));
      mutate(s, t.id, rand, junk);
    }
    s.env.store.setTeamStatus(t.id, "closed");
    s.clock.advance(5000);
    expect(s.host.frames.length).toBeGreaterThan(5);
    for (const f of s.host.frames) expectContentFree(f);
  });
});

describe("frame owner gate (S69)", () => {
  it("an orphaned team whose lead session is gone still sends session-scoped to that id — never to another session or unscoped (the host withholds it when no owner resolves)", async () => {
    const e = createTeamsEnv();
    const host = createFakeUiHost();
    const clock = new FakeClock(0);
    bridges.push(createUiBridge({ store: e.rt.store, host: host.host, epoch: "E", clock, logger: e.fake.host.logger }));
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    e.fake.endSession(e.lead); // the lead session is deleted: no owner can be resolved for it any more
    expect(team.status).toBe("orphaned");
    clock.advance(CHANGED_COALESCE_MS);
    const last = host.frames.at(-1);
    expect(last?.sessionId).toBe(e.lead);
    expect(last?.event.data).toMatchObject({ teamId: team.id });
    expect(host.frames.every((f) => f.sessionId === e.lead && f.type === "plugin_event")).toBe(true);
  });
});

describe("bridge isolation (S115)", () => {
  it("broadcast throws: the core mutation still commits, one error log per burst, later changes still broadcast", async () => {
    const e = createTeamsEnv();
    const host = createFakeUiHost();
    const clock = new FakeClock(0);
    bridges.push(createUiBridge({ store: e.rt.store, host: host.host, epoch: "E", clock, logger: e.fake.host.logger }));
    host.state.broadcastThrows = true;
    const team = await e.createTeam();
    for (let i = 0; i < 20; i++) {
      const res = await e.call("lead", "TaskCreate", { title: `t${i}`, description: "d" });
      expect(res.ok).toBe(true); // the API call succeeds
      clock.advance(10);
    }
    clock.advance(CHANGED_COALESCE_MS * 2);
    expect(team.tasks).toHaveLength(20);
    const errors = e.fake.logs.error.filter((l) => l.includes("changed"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(team.id);
    host.state.broadcastThrows = false;
    e.rt.store.appendMail(team.id, { from: "lead", to: "x", kind: "message", text: "m", wake: false });
    expect(host.frames.length).toBeGreaterThan(0); // the listener was not removed
    expect(e.fake.logs.error.filter((l) => l.includes("store listener"))).toEqual([]);
  });

  it("the stamp half throws inside the listener: mutation commits, one warn, no listener removal", async () => {
    const e = createTeamsEnv();
    const host = createFakeUiHost();
    host.state.result = "throw";
    const clock = new FakeClock(0);
    bridges.push(createUiBridge({ store: e.rt.store, host: host.host, epoch: "E", clock, logger: e.fake.host.logger }));
    const team = await e.createTeam();
    for (let i = 0; i < 5; i++) expect((await e.call("lead", "TaskCreate", { title: `t${i}`, description: "d" })).ok).toBe(true);
    expect(team.tasks).toHaveLength(5);
    expect(e.fake.logs.warn.filter((l) => l.includes("stamp"))).toHaveLength(1);
    expect(e.fake.logs.error.filter((l) => l.includes("store listener"))).toEqual([]);
    clock.advance(CHANGED_COALESCE_MS);
    expect(host.frames.length).toBeGreaterThan(0); // frames still flow
  });
});
