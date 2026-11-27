/**
 * Self-test of the server ↔ bridge lane harness (`harness/inproc-link.ts`, task 2.5): fault injection per direction
 * (drop, delay, duplicate, reorder by unequal delays) on the fake clock, and the scripted ack path through the REAL
 * `agent-teams/inproc` lane handler.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import type { Member, Team } from "../shared/types.js";
import { linkInProcBridge } from "./harness/inproc-link.js";
import { createTeamsEnv } from "./harness/teams-env.js";

async function world(faults?: Parameters<typeof linkInProcBridge>[1] extends infer O ? (O extends { faults?: infer F } ? F : never) : never) {
  const env = createTeamsEnv({ runtime: { inProcess: true } });
  const link = linkInProcBridge(env, faults ? { faults } : {});
  await link.hello({ available: true });
  const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
  return { env, link, teamId: created.data.teamId as string };
}
const ackOk = (cmdId: string, extra: Record<string, unknown> = {}) => ({ cmdId, ok: true, ...extra });
const spawnCmds = (link: Awaited<ReturnType<typeof world>>["link"]) => link.commands.filter((c) => c.cmd === "spawn");

describe("lane harness fault injection", () => {
  it("delivers a command and routes the scripted ack through the real lane (no faults)", async () => {
    const { env, link, teamId } = await world();
    link.setOnCommand((cmd) => ({ ack: ackOk(cmd.cmdId, { childId: "bg-1", agentId: "agent-1", status: "running" }) }));
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    expect(spawnCmds(link)).toHaveLength(1);
    expect(link.acksSent).toHaveLength(1);
    expect(env.rt.store.member(env.rt.store.get(teamId) as Team, "bob")?.childAgentId).toBe("agent-1");
  });

  it("drop: a command that never arrives times out delivery_timeout on the server", async () => {
    const { env, link, teamId } = await world({ toBridge: (cmd) => (cmd.cmd === "spawn" ? { drop: true } : undefined) });
    link.setOnCommand((cmd) => ({ ack: ackOk(cmd.cmdId) }));
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    expect(link.emitted).toHaveLength(1);
    expect(link.commands).toHaveLength(0);
    env.clock.advance(10_000);
    await env.settle();
    expect((env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member).status).toBe("failed");
    expect((env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member).goneReason).toContain("delivery_timeout");
  });

  it("delay: the command arrives only after its delay on the fake clock", async () => {
    const { env, link } = await world({ toBridge: () => ({ delayMs: 2_000 }) });
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    expect(link.commands).toHaveLength(0);
    env.clock.advance(1_999);
    expect(link.commands).toHaveLength(0);
    env.clock.advance(1);
    expect(link.commands).toHaveLength(1);
  });

  it("duplicate: a command arrives twice with the same cmdId although the server emitted it once", async () => {
    const { env, link } = await world({ toBridge: () => ({ duplicate: true }) });
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    expect(link.emitted).toHaveLength(1);
    expect(link.commands).toHaveLength(2);
    expect(link.commands[0]?.cmdId).toBe(link.commands[1]?.cmdId);
  });

  it("duplicate ack: the server settles on the first and ignores the copy", async () => {
    const { env, link, teamId } = await world({ toServer: () => ({ duplicate: true }) });
    link.setOnCommand((cmd) => ({ ack: ackOk(cmd.cmdId, { childId: "bg-1", agentId: "agent-1", status: "running" }) }));
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    expect(link.acksSent).toHaveLength(2);
    expect(env.rt.store.member(env.rt.store.get(teamId) as Team, "bob")?.childId).toBe("bg-1");
  });

  it("reorder: unequal delays make two members' commands arrive in the opposite order they were emitted", async () => {
    const { env, link } = await world({ toBridge: (cmd) => ({ delayMs: (cmd as { member?: string }).member === "a" ? 500 : 100 }) });
    await env.call("lead", "TeammateSpawn", { name: "a", prompt: "p" });
    await env.call("lead", "TeammateSpawn", { name: "b", prompt: "p" });
    env.clock.advance(1_000);
    expect(link.emitted.map((e) => (e.data as { member: string }).member)).toEqual(["a", "b"]);
    expect(link.commands.map((c) => (c as { member: string }).member)).toEqual(["b", "a"]);
  });

  it("a late ack (delay) after the server's timeout leaves the member failed and stops the child it created", async () => {
    const { env, link, teamId } = await world();
    link.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: ackOk(cmd.cmdId, { childId: "bg-9", agentId: "agent-9", status: "running" }), afterMs: 15_000 } : { ack: ackOk(cmd.cmdId) }));
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    env.clock.advance(15_000);
    await env.settle();
    expect((env.rt.store.member(env.rt.store.get(teamId) as Team, "bob") as Member).status).toBe("failed");
    const stops = link.commands.filter((c) => c.cmd === "stop") as Array<{ childId?: string }>;
    expect(stops.some((s) => s.childId === "bg-9")).toBe(true);
  });
});

describe("core abortMember / teamDelete reach the in-process driver unchanged", () => {
  it("abortMember interrupts a busy child; without the feature it fails interrupt_unavailable; teamDelete stops every child", async () => {
    const { env, link, teamId } = await world();
    link.setOnCommand((cmd) => ({ ack: ackOk(cmd.cmdId, cmd.cmd === "spawn" ? { childId: `bg-${cmd.member}`, agentId: `agent-${cmd.member}`, status: "running" } : {}) }));
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    const team = env.rt.store.get(teamId) as Team;
    env.rt.store.patchMember(teamId, "bob", { status: "busy" });
    expect(env.rt.ops.abortMember(team, "bob", { actor: "user" })).toMatchObject({ ok: true });
    expect(link.commands.some((c) => c.cmd === "interrupt")).toBe(true);
    await link.hello({ available: true, features: ["spawn", "steer", "managed", "loader"] }); // no `interrupt`
    expect(env.rt.ops.abortMember(team, "bob", { actor: "user" })).toMatchObject({ ok: false, error: "interrupt_unavailable" });
    env.rt.ops.teamDelete(team, { actor: "lead", force: true });
    env.clock.advance(20_000);
    await env.settle();
    expect(link.commands.filter((c) => c.cmd === "stop")).toHaveLength(1);
    expect(link.commands.some((c) => c.cmd === "stop" && (c as { member?: string }).member === "bob")).toBe(true);
  });
});
