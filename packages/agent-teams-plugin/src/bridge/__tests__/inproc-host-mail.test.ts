/**
 * Mail handover on the lead host (test-plan S76–S80): the per-member ledger of handed-over mail ids (bounded at 200, FIFO),
 * the `(member, mail ids)`-derived steer `cmdId`, the `duplicate` re-ack and the `state` report, and the queued-steer record with its
 * one content-free `nudge` per run. The REAL server driver ↔ host pair plays the whole path where the row needs both halves.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { createHostEnv, type HostEnv, steerCommand } from "../../__tests__/harness/inproc-host-env.js";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { createInProcPair } from "../../__tests__/harness/inproc-pair.js";
import { memberFixture } from "../../__tests__/harness/store-env.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import { mailIdsKey } from "../../server/inproc-mail.js";
import { NUDGE_TEXT } from "../../shared/inproc-protocol.js";
import { SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import type { Member, Team } from "../../shared/types.js";

/** Observe `steer_request` emits (message text per call). */
function steers(env: HostEnv): { n: () => number; messages: string[] } {
  const messages: string[] = [];
  env.bus.on(SUBAGENTS_CHANNEL.steerRequest, (p: unknown) => void messages.push((p as { message: string }).message));
  return { n: () => messages.length, messages };
}

async function bobEnv(): Promise<{ env: HostEnv; agentId: string }> {
  const env = createHostEnv();
  await env.start();
  const ack = await env.spawn("bob");
  return { env, agentId: ack.agentId as string };
}

const send = async (env: HostEnv, member: string, ids: number[], over: Record<string, unknown> = {}): Promise<void> => {
  env.command(steerCommand(member, ids, over));
  await env.settle();
};
const ledger = (env: HostEnv, member = "bob"): number[] => env.host.snapshot().members.find((m) => m.member === member)?.deliveredMailIds ?? [];

describe("S76 mail handed to a child once per mail id", () => {
  it("(a) re-sent within the replay-map life: the stored ack is replayed and the child sees the mail once", async () => {
    const { env } = await bobEnv();
    const calls = steers(env);
    await send(env, "bob", [1]);
    await send(env, "bob", [1]); // the ack was lost: the server re-sends
    expect(calls.n()).toBe(1);
    const acks = env.acks().filter((a) => a.cmdId === "steer:bob:1");
    expect(acks).toHaveLength(2);
    expect(JSON.stringify(acks[0])).toBe(JSON.stringify(acks[1]));
  });

  it("(b) after replay-map eviction the ledger drops the ids and re-acks `duplicate`; the child still sees the mail once", async () => {
    const { env } = await bobEnv();
    await env.spawn("eve");
    const calls = steers(env);
    await send(env, "bob", [1]);
    for (let i = 0; i < 1001; i++) env.command(steerCommand("eve", [10_000 + i])); // evicts bob's stored result (FIFO 1 000)
    await env.settle();
    const before = calls.n();
    await send(env, "bob", [1]);
    expect(env.acks().filter((a) => a.cmdId === "steer:bob:1").at(-1)).toMatchObject({ ok: true, result: "duplicate" });
    expect(calls.n()).toBe(before);
    expect(calls.messages.filter((m) => m.includes("[agent-teams · mail id 1]"))).toHaveLength(1);
  });

  it("the same ids in a different batch composition: only the not-yet-handed ids are delivered", async () => {
    const { env } = await bobEnv();
    const calls = steers(env);
    await send(env, "bob", [1, 2]);
    await send(env, "bob", [2]); // a smaller batch: duplicate
    await send(env, "bob", [2, 3]); // a larger one: only mail 3 goes
    expect(calls.n()).toBe(2);
    expect(calls.messages[1]).toContain("mail id 3");
    expect(calls.messages[1]).not.toContain("mail id 2");
    expect(ledger(env)).toEqual([1, 2, 3]);
  });

  it("the steer cmdId is order independent (hash of the sorted ids)", () => {
    expect(mailIdsKey([3, 1, 2])).toBe(mailIdsKey([2, 3, 1, 1]));
    expect(mailIdsKey([1, 2])).not.toBe(mailIdsKey([1, 3]));
  });
});

describe("S77 ledger bounded", () => {
  const resendFirstAfter = async (count: number): Promise<string | undefined> => {
    const { env } = await bobEnv();
    for (let id = 1; id <= count; id++) env.command(steerCommand("bob", [id]));
    await env.settle();
    expect(ledger(env)).toHaveLength(Math.min(count, 200));
    env.command(steerCommand("bob", [1], { cmdId: "resend-first" }));
    await env.settle();
    return env.ackOf("resend-first")?.result;
  };

  it("199 and 200 ids: the first id re-sent is a duplicate", async () => {
    expect(await resendFirstAfter(199)).toBe("duplicate");
    expect(await resendFirstAfter(200)).toBe("duplicate");
  });

  it("201 ids: the oldest is evicted (FIFO) and is no longer recognised — the documented window of 200", async () => {
    expect(await resendFirstAfter(201)).toBe("queued");
  });
});

describe("S78 duplicate-only waking mail", () => {
  it("every id already handed over: no steer_request, no run starts, and the host reports the member's state", async () => {
    const { env } = await bobEnv();
    const calls = steers(env);
    await send(env, "bob", [1]);
    await send(env, "bob", [1], { cmdId: "waking-dup" });
    expect(env.ackOf("waking-dup")).toMatchObject({ ok: true, result: "duplicate" });
    expect(calls.n()).toBe(1);
    expect(env.events().at(-1)).toMatchObject({ member: "bob", kind: "state", state: "busy" });
  });

  it("a duplicate for an IDLE member reports idle (so a provisional busy resolves)", async () => {
    const { env, agentId } = await bobEnv();
    await send(env, "bob", [1]);
    env.double.finishRun(agentId, { result: "x" });
    await send(env, "bob", [1], { cmdId: "idle-dup" });
    expect(env.events().find((e) => e.kind === "state")).toMatchObject({ state: "idle", run: 1 });
  });

  it("a mixed batch (1 new + 1 duplicate) delivers only the new id", async () => {
    const { env } = await bobEnv();
    const calls = steers(env);
    await send(env, "bob", [1]);
    await send(env, "bob", [1, 2], { cmdId: "mixed" });
    expect(calls.n()).toBe(2);
    expect(calls.messages[1]).toContain("mail id 2");
    expect(calls.messages[1]).not.toContain("mail id 1");
  });

});

describe("S78 (server) a duplicate-only waking mail: the state report resolves core's provisional busy before wakeConfirmMs", () => {
  const W = 4000;
  /** bob idle; the host answers a waking steer `duplicate` (every id already in its ledger) — no run starts. */
  async function world() {
    const env = createTeamsEnv({ config: { wakeConfirmMs: W }, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => ({ ack: { cmdId: cmd.cmdId, ok: true, result: cmd.cmd === "steer" ? "duplicate" : undefined } }));
    await link.hello({ available: true });
    const teamId = (await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).data.teamId as string;
    env.rt.store.reserveMember(teamId, memberFixture("bob", { status: "idle", childId: "bg-bob", childAgentId: "agent-bob", proxyToken: "b".repeat(64) }) as Member);
    const bob = () => env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member;
    await env.fake.call(env.lead, "SendMessage", { to: "bob", message: "again" });
    await env.settle();
    expect(link.commands.filter((c) => c.cmd === "steer")).toHaveLength(1);
    expect(bob().status).toBe("busy"); // core's provisional busy
    return { env, link, bob, teamId };
  }

  it("W−1: the `state idle` report arrives: the member is idle at once, and nothing reverts at W+1 (no spurious wake-timeout)", async () => {
    const { env, link, bob } = await world();
    await env.clock.advanceAsync(W - 1);
    await link.lane({ op: "event", member: "bob", run: 1, kind: "state", state: "idle" });
    expect(bob().status).toBe("idle");
    await env.clock.advanceAsync(2);
    expect(bob().status).toBe("idle");
    expect(env.fake.logs.info.join("\n")).not.toMatch(/did not confirm a waking mail/);
  });

  it("a `state busy` report keeps the member busy past W (the child really runs)", async () => {
    const { env, link, bob } = await world();
    await link.lane({ op: "event", member: "bob", run: 1, kind: "state", state: "busy" });
    await env.clock.advanceAsync(W + 1);
    expect(bob().status).toBe("busy");
    expect(env.fake.logs.info.join("\n")).not.toMatch(/did not confirm a waking mail/);
  });

  it("without any report the provisional busy lapses at W (core's revert): the contrast the state report removes", async () => {
    const { env, bob } = await world();
    await env.clock.advanceAsync(W - 1);
    expect(bob().status).toBe("busy");
    await env.clock.advanceAsync(2);
    expect(bob().status).toBe("idle");
    expect(env.fake.logs.info.join("\n")).toMatch(/did not confirm a waking mail/);
  });
});

/** Drive bob to run 3: runs 1 and 2 complete, run 3 is running (registry: lastIdleRun 2). */
async function bobInRun3(): Promise<{ env: HostEnv; agentId: string }> {
  const { env, agentId } = await bobEnv();
  for (let run = 1; run <= 2; run++) {
    env.double.finishRun(agentId, { result: `r${run}` });
    await send(env, "bob", [900 + run]); // idle child: started the next run
  }
  expect(env.host.snapshot().members[0]).toMatchObject({ state: "busy", run: 3, lastIdleRun: 2 });
  return { env, agentId };
}

describe("S79 queued steer is not treated as read (nudge)", () => {
  it("steer acked queued during run 3 records steerAckRun 3; run 3 goes idle first: exactly one content-free nudge, the next run starts, the body reached the child once", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    await pair.spawn("bob");
    pair.store.patchMember(pair.team.id, "bob", { status: "busy" });
    const calls = steers(pair.host);
    const agentId = pair.host.double.children.keys().next().value as string;
    const bobRef = { teamId: pair.team.id, member: "bob" };
    const mail = pair.store.appendMail(pair.team.id, { from: "lead", to: "bob", kind: "message", text: "the body", wake: true }) as never;
    // runs 1 and 2 pass, run 3 is running
    for (const run of [1, 2]) {
      pair.host.double.finishRun(agentId, { result: `r${run}` });
      pair.host.command(steerCommand("bob", [900 + run]));
      await pair.settle();
    }
    calls.messages.length = 0;
    pair.driver.deliver(bobRef, [mail], { wake: true });
    await pair.settle();
    expect(pair.member("bob")?.steerAckRun).toBe(3); // lastIdleRun 2 → run 3
    // Run 3 ends before the queued steer was read: no idle→busy transition happened.
    pair.host.double.finishRun(agentId, { result: "r3" });
    await pair.settle();
    expect(pair.driver.onMemberIdle(pair.team.id, "bob", 3)).toBe(true);
    await pair.settle();
    const nudge = pair.cmds().at(-1) as { cmd: string; nudge?: boolean; cmdId: string; mailIds: number[]; blocks?: string[] };
    expect(nudge).toMatchObject({ cmd: "steer", nudge: true, mailIds: [] });
    expect(nudge.blocks).toBeUndefined();
    expect(nudge.cmdId).toMatch(/^nudge:bob:3:/);
    expect(calls.messages).toEqual([expect.stringContaining("the body"), NUDGE_TEXT]); // the body once, then the fixed nudge text
    expect(pair.host.host.counters().inproc_nudges).toBe(1);
    expect(pair.counters.get("inproc_nudges")).toBe(1);
    // The nudge started a run: the stale steer is drained and the mail is final.
    expect(pair.host.host.snapshot().members[0]).toMatchObject({ state: "busy", run: 4 });
  });

  it("the nudge is exempt from the ledger drop: ids are ledgered, yet the nudge starts a run while a duplicate waking mail starts none", async () => {
    const { env, agentId } = await bobInRun3();
    const calls = steers(env);
    env.double.nextSteerResult("queued");
    await send(env, "bob", [7]);
    expect(ledger(env)).toContain(7);
    env.double.finishRun(agentId, { result: "r3" });
    await env.settle();
    await send(env, "bob", [7], { cmdId: "dup-waking" }); // duplicate waking mail: no run
    expect(env.ackOf("dup-waking")).toMatchObject({ result: "duplicate" });
    expect(env.host.snapshot().members[0]?.state).toBe("idle");
    env.command({ cmd: "steer", cmdId: "nudge:bob:3:a", member: "bob", mailIds: [], nudge: true });
    await env.settle();
    expect(env.ackOf("nudge:bob:3:a")).toMatchObject({ ok: true, result: "started" });
    expect(calls.messages.at(-1)).toBe(NUDGE_TEXT);
    expect(env.host.snapshot().members[0]).toMatchObject({ state: "busy", run: 4 });
  });

  it("progress `started` emissions during a run do not advance the recorded run number", async () => {
    const { env, agentId } = await bobInRun3();
    for (let i = 0; i < 5; i++) env.double.emitStarted(agentId);
    await env.settle();
    expect(env.host.snapshot().members[0]).toMatchObject({ run: 3, lastIdleRun: 2 });
    expect(env.events().filter((e) => e.kind === "started" && e.run === 3)).toHaveLength(1);
  });
});

describe("S80 nudge guards", () => {
  const nudge = async (env: HostEnv, cmdId: string): Promise<void> => {
    env.command({ cmd: "steer", cmdId, member: "bob", mailIds: [], nudge: true });
    await env.settle();
  };

  it("(1) a steer acked `started` records no run: a nudge does nothing", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "r1" });
    await send(env, "bob", [1]); // idle child: started
    const calls = steers(env);
    await nudge(env, "nudge:bob:1:a");
    expect(env.ackOf("nudge:bob:1:a")).toMatchObject({ ok: true, result: "duplicate" });
    expect(calls.n()).toBe(0);
  });

  it("(2) two queued steers in the same run give ONE nudge; (4) a repeated report after the nudge cannot loop (nudgedRun guard)", async () => {
    const { env, agentId } = await bobInRun3();
    env.double.nextSteerResult("queued");
    await send(env, "bob", [1]);
    env.double.nextSteerResult("queued");
    await send(env, "bob", [2]);
    env.double.finishRun(agentId, { result: "r3" });
    await env.settle();
    const calls = steers(env);
    await nudge(env, "nudge:bob:3:a");
    await nudge(env, "nudge:bob:3:b"); // the same run reported again
    await nudge(env, "nudge:bob:3:c");
    expect(calls.messages).toEqual([NUDGE_TEXT]);
    expect(env.host.counters().inproc_nudges).toBe(1);
  });

  it("(3) 5 progress started events during run 3: nothing is recorded, no nudge", async () => {
    const { env, agentId } = await bobInRun3();
    for (let i = 0; i < 5; i++) env.double.emitStarted(agentId);
    env.double.finishRun(agentId, { result: "r3" });
    await env.settle();
    const calls = steers(env);
    await nudge(env, "nudge:bob:3:a");
    expect(calls.n()).toBe(0);
  });

  it("(5) the child is gone before idle: the nudge is refused (not_alive), nothing is sent upstream", async () => {
    const { env, agentId } = await bobInRun3();
    env.double.nextSteerResult("queued");
    await send(env, "bob", [1]);
    env.double.dispose(agentId, "cancel");
    await env.settle();
    const calls = steers(env);
    await nudge(env, "nudge:bob:3:a");
    expect(env.ackOf("nudge:bob:3:a")).toMatchObject({ ok: false, error: "not_alive" });
    expect(calls.n()).toBe(0);
  });

  it("(6) steerAckRun comes from the registry: the first run records 1 (lastIdleRun 0); the snapshot carries lastIdleRun so a restore agrees", async () => {
    const { env } = await bobEnv();
    env.double.nextSteerResult("queued");
    await send(env, "bob", [1]);
    expect(env.ackOf("steer:bob:1")).toMatchObject({ result: "queued", run: 1 });
    const snap = env.host.snapshot().members[0];
    expect(snap).toMatchObject({ lastIdleRun: 0, run: 1 });
    expect((snap?.lastIdleRun ?? 0) + 1).toBe(1);
  });

  it("the server nudges only for the recorded run and only while no run started since", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    await pair.spawn("bob");
    expect(pair.driver.onMemberIdle(pair.team.id, "bob", 1)).toBe(false); // no queued steer recorded
    pair.store.patchMember(pair.team.id, "bob", { steerAckRun: 2 });
    expect(pair.driver.onMemberIdle(pair.team.id, "bob", 1)).toBe(false); // another run
    expect(pair.driver.onMemberIdle(pair.team.id, "bob", 2)).toBe(true);
  });
});
