/**
 * Observability of the in-process mode (test-plan S95, tasks 9.1/9.2): structured logs carry ids and sizes only — never a prompt, a mail body,
 * a final text, the member's proxy token or the activation's command secret, on success AND failure paths — and the REST snapshot `stats`
 * exposes the `inproc_*` counters (non-zero only). Real runtime ↔ real lead host over the contract double.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { createInProcStack, type InProcStack } from "../../__tests__/harness/inproc-stack.js";
import { validCapabilities } from "../../__tests__/harness/subagents-double.js";
import type { Team } from "../../shared/types.js";
import { snapshotOf } from "../snapshot.js";

const NO_INTERRUPT = { answer: validCapabilities({ features: ["spawn", "steer", "managed", "loader"] }) };
const SECRETS = ["SECRET-PROMPT-7f3a", "SECRET-MAIL-91bc", "SECRET-FINAL-5d0e", "SECRET-ERROR-c2a8"];
const COMMAND_SECRET = "secret-stack-1";

const allLogs = (st: InProcStack): string => [...st.env.fake.logs.info, ...st.env.fake.logs.warn, ...st.env.fake.logs.error, ...st.logs].join("\n");

describe("S95 logs carry ids and sizes only", () => {
  it("a run over every path (spawn, steer, idle, error, stop, timeout, forbidden, unknown reason) leaks no prompt, mail body, final text, token or command secret", async () => {
    const st = createInProcStack({ config: { inProcessCmdTimeoutMs: 1000 }, double: NO_INTERRUPT }); // no `interrupt`: an urgent send degrades
    await st.start();
    const team = await st.createTeam();
    await st.spawn(team, "bob", { prompt: SECRETS[0] });
    const token = st.member(team, "bob").proxyToken as string;
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: SECRETS[1] });
    await st.settle();
    st.double.finishRun(st.agentOf(team, "bob"), { result: SECRETS[2] });
    await st.settle();
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: `${SECRETS[1]} again`, priority: "urgent" });
    await st.settle();
    st.double.finishRun(st.agentOf(team, "bob"), { error: SECRETS[3] });
    await st.settle();
    // a proxied call with a wrong token, an unknown gone reason and a steer whose ack is lost (delivery_timeout)
    await st.env.fake.lane(st.env.lead, "agent-teams/call", { op: "TaskList", args: {}, as: { member: "bob", token: "f".repeat(64) } });
    await st.event({ member: "bob", run: 9, kind: "state", state: "idle" });
    st.lane.drop = (p) => p.op === "ack";
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: `${SECRETS[1]} lost ack` });
    await st.clock.advanceAsync(2000);
    await st.settle();
    st.lane.drop = undefined;
    await st.event({ member: "bob", run: 9, kind: "gone", reason: `weird-${SECRETS[3]}` });
    await st.flushNotices();
    const logs = allLogs(st);
    expect(logs).toMatch(/inproc cmd team=/); // the paths were exercised and logged
    expect(logs).toMatch(/inproc ack team=/);
    expect(logs).toMatch(/inproc event team=/);
    expect(logs).toMatch(/proxied identity rejected/);
    for (const secret of [...SECRETS, token, COMMAND_SECRET, "weird-"]) expect(logs, `leaked ${secret}`).not.toContain(secret);
    expect(JSON.stringify(st.env.rt.counters.snapshot())).not.toContain(token);
  });
});

describe("S95 counters in the REST snapshot stats", () => {
  it("inproc_spawns, inproc_steers, inproc_nudges, inproc_degraded_urgent, inproc_forbidden, inproc_unknown_event and inproc_delivery_timeout appear once non-zero", async () => {
    const st = createInProcStack({ config: { inProcessCmdTimeoutMs: 1000 }, double: NO_INTERRUPT });
    await st.start();
    const team = await st.createTeam();
    const stats = (): Record<string, number | undefined> => snapshotOf(st.env.rt.store, st.env.rt.telemetry, st.env.rt.store.get(team.id) as Team, st.env.rt.counters.forTeam(team.id)).stats as unknown as Record<string, number | undefined>;
    expect(stats().inproc_spawns).toBeUndefined(); // absent until non-zero
    await st.spawn(team, "bob");
    expect(stats().inproc_spawns).toBe(1);
    // a steer acked `queued` into the running run, whose run then ends before the next run starts: one nudge
    st.double.nextSteerResult("queued");
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: "queued steer" });
    await st.settle();
    expect(stats().inproc_steers).toBe(1);
    st.double.finishRun(st.agentOf(team, "bob"), { result: "end of run 1" });
    await st.settle();
    expect(stats().inproc_nudges).toBe(1);
    // urgent without the optional `interrupt` feature: degraded to a steer
    await st.event({ member: "bob", run: 2, kind: "started" });
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: "now", priority: "urgent" });
    await st.settle();
    expect(stats().inproc_degraded_urgent).toBe(1);
    // identity rejection and unknown upstream reason
    await st.env.fake.lane(st.env.lead, "agent-teams/call", { op: "TaskList", args: {}, as: { member: "bob", token: "0".repeat(64) } });
    expect(stats().inproc_forbidden).toBe(1);
    // a command whose ack never arrives
    st.lane.drop = (p) => p.op === "ack";
    await st.env.fake.call(st.env.lead, "SendMessage", { to: "bob", message: "another" });
    await st.clock.advanceAsync(1500);
    await st.settle();
    expect(stats().inproc_delivery_timeout).toBeGreaterThanOrEqual(1);
    st.lane.drop = undefined;
    await st.event({ member: "bob", run: 2, kind: "gone", reason: "mystery" });
    expect(stats().inproc_unknown_event).toBe(1);
  });

  it("a session-mode team's stats keep exactly the core keys (no inproc_* noise)", async () => {
    const st = createInProcStack();
    await st.start();
    const created = await st.env.fake.call(st.env.lead, "TeamCreate", { name: "s", mode: "session" });
    const t = st.env.rt.store.get(created.data.teamId) as Team;
    const stats = snapshotOf(st.env.rt.store, st.env.rt.telemetry, t, st.env.rt.counters.forTeam(t.id)).stats;
    expect(Object.keys(stats).some((k) => k.startsWith("inproc_"))).toBe(false);
  });
});
