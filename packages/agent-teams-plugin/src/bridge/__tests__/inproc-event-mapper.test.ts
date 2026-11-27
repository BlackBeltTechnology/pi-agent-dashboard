/**
 * The lead host's event mapper (test-plan S60–S68, S82): `subagents:created|started|completed|failed|idle|disposed` → member
 * reports (`started`, `idle {run, finalText|error|aborted}`, `gone {reason}`) through the outbox, the after-tick decision, the
 * `started`-only-from-spawning/idle rule, foreign ids and drift counters, final-text bounds, interrupt races. The recorded contract
 * double plays upstream; events are also emitted by hand where a row needs a shape the double does not produce.
 * What the SERVER does with these reports (member state, task release, notices) is the "server lifecycle intake" block at the end (the
 * real runtime ↔ real host stack, `inproc-stack.ts`).
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { createHostEnv, type HostEnv, steerCommand } from "../../__tests__/harness/inproc-host-env.js";
import { createInProcStack, type InProcStack } from "../../__tests__/harness/inproc-stack.js";
import { validCapabilities } from "../../__tests__/harness/subagents-double.js";
import type { InProcEvent } from "../../shared/inproc-protocol.js";
import { SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import type { Team } from "../../shared/types.js";
import { FINAL_TEXT_MAX_BYTES, toWellFormed } from "../inproc-text.js";

async function bobEnv(opts: Parameters<typeof createHostEnv>[0] = {}): Promise<{ env: HostEnv; agentId: string }> {
  const env = createHostEnv(opts);
  await env.start();
  const ack = await env.spawn("bob");
  await env.settle();
  return { env, agentId: ack.agentId as string };
}

/** A macrotask boundary: every microtask (the mapper's after-tick decision) has run, a later tick begins. */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const reports = (env: HostEnv, member = "bob"): InProcEvent[] => env.events().filter((e) => e.member === member);
const kinds = (env: HostEnv): string[] => reports(env).map((e) => `${e.kind}:${e.run}`);

describe("S60 child lifecycle mapping (legal edges)", () => {
  it("spawn → started: a started report for run 1", async () => {
    const { env } = await bobEnv();
    expect(kinds(env)).toEqual(["started:1"]);
  });

  it("started → completed + idle (same tick): ONE idle report, settleId = the run, finalText = the result", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "all done" });
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "idle", run: 1, finalText: "all done" });
    expect(reports(env).at(-1)?.error).toBeUndefined();
  });

  it("idle → started (a steer starts the next run): started report with run 2", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "x" });
    env.command(steerCommand("bob", [1]));
    await env.settle();
    expect(kinds(env)).toEqual(["started:1", "idle:1", "started:2"]);
  });

  it("started → stopped with no idle (dock Stop): gone: stopped", async () => {
    const { env } = await bobEnv();
    env.command({ cmd: "stop", cmdId: "s", member: "bob" });
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "gone", reason: "stopped" });
  });

  it("idle → disposed (ttl): gone: idle_disposed", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "x" });
    env.double.dispose(agentId, "ttl");
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "gone", reason: "idle_disposed" });
  });

  it("spawning → failed: gone: child_failed; queued → removed: gone: stopped", async () => {
    const env = createHostEnv({ double: { maxConcurrent: 1 } });
    await env.start();
    await env.spawn("bob");
    const queued = await env.spawn("eve");
    expect(queued).toMatchObject({ status: "queued", queuePosition: 1 });
    env.bus.emit(SUBAGENTS_CHANNEL.failed, { agentId: env.double.children.values().next().value?.agentId, error: "boom" });
    env.command({ cmd: "stop", cmdId: "rm-eve", member: "eve" });
    await env.settle();
    expect(reports(env, "bob").at(-1)).toMatchObject({ kind: "gone", reason: "child_failed" });
    expect(reports(env, "eve").at(-1)).toMatchObject({ kind: "gone", reason: "stopped" });
    expect(reports(env, "eve").some((r) => r.kind === "started")).toBe(false); // never started
  });

  // The member state, task release and the waking lead notice that these reports cause are the server lifecycle intake: see "server lifecycle intake" below.
});

describe("S61 child lifecycle mapping (illegal edges)", () => {
  it("progress `started` x5 while busy changes nothing", async () => {
    const { env, agentId } = await bobEnv();
    for (let i = 0; i < 5; i++) env.double.emitStarted(agentId);
    await env.settle();
    expect(kinds(env)).toEqual(["started:1"]);
  });

  it("idle before completed in one tick still reports one idle with the text; a duplicate or older run is deduped", async () => {
    const { env, agentId } = await bobEnv();
    env.bus.emit(SUBAGENTS_CHANNEL.idle, { agentId, run: 1 });
    env.bus.emit(SUBAGENTS_CHANNEL.completed, { agentId, result: "late text" });
    await env.settle();
    expect(reports(env).filter((r) => r.kind === "idle")).toEqual([expect.objectContaining({ run: 1, finalText: "late text" })]);
    env.bus.emit(SUBAGENTS_CHANNEL.idle, { agentId, run: 1 }); // duplicate
    env.bus.emit(SUBAGENTS_CHANNEL.idle, { agentId, run: 0 }); // older
    await env.settle();
    expect(reports(env).filter((r) => r.kind === "idle")).toHaveLength(1);
  });

  it("completed without idle and not stopped: no report, counted as drift; the next event is still processed", async () => {
    const { env, agentId } = await bobEnv();
    env.bus.emit(SUBAGENTS_CHANNEL.completed, { agentId, result: "x" });
    await env.settle();
    expect(reports(env).filter((r) => r.kind !== "started")).toEqual([]);
    expect(env.host.counters().inproc_unknown_event).toBe(1);
    env.double.dispose(agentId, "cancel");
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "gone", reason: "stopped" });
  });

  it("events for a gone member are ignored (no resurrection): idle, started, disposed after gone", async () => {
    const { env, agentId } = await bobEnv();
    env.double.dispose(agentId, "cancel");
    await env.settle();
    const before = reports(env).length;
    env.bus.emit(SUBAGENTS_CHANNEL.started, { agentId, run: 2 });
    env.bus.emit(SUBAGENTS_CHANNEL.idle, { agentId, run: 2 });
    env.bus.emit(SUBAGENTS_CHANNEL.disposed, { agentId, reason: "ttl" });
    await env.settle();
    expect(reports(env)).toHaveLength(before);
    expect(env.host.snapshot().members).toEqual([]);
  });

  it("disposed while spawning (queued child): gone with its reason; no throw", async () => {
    const env = createHostEnv({ double: { maxConcurrent: 1 } });
    await env.start();
    await env.spawn("bob");
    const eve = await env.spawn("eve");
    env.bus.emit(SUBAGENTS_CHANNEL.disposed, { agentId: eve.agentId, reason: "cap" });
    await env.settle();
    expect(reports(env, "eve").at(-1)).toMatchObject({ kind: "gone", reason: "idle_disposed" });
  });
});

describe("S62 same-tick decision", () => {
  it("completed at tick t and idle one macrotask later: the mapper decides after tick t with NO grace (the text is not attached), drift counted", async () => {
    const { env, agentId } = await bobEnv();
    env.bus.emit(SUBAGENTS_CHANNEL.completed, { agentId, result: "text" });
    await nextTick();
    expect(env.host.counters().inproc_unknown_event).toBe(1);
    env.bus.emit(SUBAGENTS_CHANNEL.idle, { agentId, run: 1 });
    await nextTick();
    const idle = reports(env).find((r) => r.kind === "idle");
    expect(idle).toMatchObject({ run: 1 });
    expect(idle?.finalText).toBeUndefined();
  });
});

describe("S63 final text and error settles", () => {
  const idleOf = async (env: HostEnv): Promise<InProcEvent> => {
    await env.settle();
    return reports(env).find((r) => r.kind === "idle") as InProcEvent;
  };

  it("failed + idle: the idle report carries the error text (no finalText)", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { error: "model exploded" });
    const idle = await idleOf(env);
    expect(idle).toMatchObject({ error: "model exploded" });
    expect(idle.finalText).toBeUndefined();
  });

  it.each([[""], [" "], ["\n\t "]])("an empty final reply %j is an idle with an error (no final output)", async (text) => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: text });
    expect(await idleOf(env)).toMatchObject({ error: "subagent produced no final output" });
  });

  it.each([
    ["1 char", "x".repeat(1), 1],
    ["256 KiB − 1", "x".repeat(FINAL_TEXT_MAX_BYTES - 1), FINAL_TEXT_MAX_BYTES - 1],
    ["256 KiB", "x".repeat(FINAL_TEXT_MAX_BYTES), FINAL_TEXT_MAX_BYTES],
  ])("%s is passed through unchanged", async (_n, text, length) => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: text });
    const idle = await idleOf(env);
    expect(idle.finalText).toHaveLength(length);
    expect(idle.finalText).not.toContain("[truncated");
  });

  it("256 KiB + 1 is cut at the cap with `… [truncated N bytes]`", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "x".repeat(FINAL_TEXT_MAX_BYTES + 1) });
    const idle = await idleOf(env);
    expect(idle.finalText).toBe(`${"x".repeat(FINAL_TEXT_MAX_BYTES)}… [truncated 1 bytes]`);
  });

  it("4 MiB of multi-byte text is cut on a code-point boundary with the removed byte count", async () => {
    const { env, agentId } = await bobEnv();
    const text = "é".repeat(2 * 1024 * 1024); // 2 bytes each = 4 MiB
    env.double.finishRun(agentId, { result: text });
    const idle = await idleOf(env);
    const kept = (idle.finalText as string).replace(/… \[truncated \d+ bytes\]$/, "");
    expect(Buffer.byteLength(kept)).toBe(FINAL_TEXT_MAX_BYTES);
    expect(kept).toBe("é".repeat(FINAL_TEXT_MAX_BYTES / 2));
    expect(idle.finalText).toMatch(new RegExp(`… \\[truncated ${2 * 1024 * 1024 * 2 - FINAL_TEXT_MAX_BYTES} bytes\\]$`));
  });

  it("lone surrogates become U+FFFD: valid UTF-16 on the wire (also in an error text)", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "a\uD800b\uDC00c😀" });
    const idle = await idleOf(env);
    expect(idle.finalText).toBe("a\uFFFDb\uFFFDc😀");
    expect(toWellFormed(JSON.stringify(idle))).toBe(JSON.stringify(idle));
  });
});

describe("S64 interrupt (silent abort)", () => {
  it("an interrupt of a busy child: idle {aborted:true} without text or failure; the next steer starts the next run", async () => {
    const { env } = await bobEnv();
    env.command({ cmd: "interrupt", cmdId: "i1", member: "bob" });
    await env.settle();
    expect(env.ackOf("i1")).toMatchObject({ ok: true, result: "interrupted" });
    const idle = reports(env).find((r) => r.kind === "idle");
    expect(idle).toMatchObject({ run: 1, aborted: true });
    expect(idle?.finalText).toBeUndefined();
    env.command(steerCommand("bob", [5]));
    await env.settle();
    expect(kinds(env)).toEqual(["started:1", "idle:1", "started:2"]);
  });

  it("an aborted idle that also carries an error keeps both flags (the server decides: no failure notice for aborted)", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { error: "aborted by interrupt", aborted: true });
    await env.settle();
    expect(reports(env).find((r) => r.kind === "idle")).toMatchObject({ aborted: true, error: "aborted by interrupt" });
  });
});

describe("S65 decision after the current tick", () => {
  it("completed + idle {run 3} then, a tick later, started (a queued steer drained): one idle report for run 3, started with run 4, steerAckRun = lastIdleRun + 1, no nudge needed", async () => {
    const { env, agentId } = await bobEnv();
    for (const run of [1, 2]) {
      env.double.finishRun(agentId, { result: `r${run}` });
      env.command(steerCommand("bob", [100 + run]));
      await env.settle();
    }
    env.double.finishRun(agentId, { result: "r3" }); // idle run 3
    await env.settle();
    expect(reports(env).filter((r) => r.kind === "idle" && r.run === 3)).toHaveLength(1);
    // The dispatcher's auto-claim steer is acked `queued` (the child is between runs): its run comes from the registry.
    env.double.nextSteerResult("queued");
    env.command(steerCommand("bob", [200]));
    await env.settle();
    expect(env.ackOf(`steer:bob:200`)).toMatchObject({ ok: true, result: "queued", run: 4 });
    env.double.startQueued(agentId); // upstream drains the queued steer: started
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "started", run: 4 });
    // The next run started: a late nudge for run 4 is not needed and does nothing.
    env.command({ ...steerCommand("bob", [], { cmdId: "nudge:bob:4" }), nudge: true, blocks: undefined });
    await env.settle();
    expect(env.ackOf("nudge:bob:4")).toMatchObject({ ok: true, result: "duplicate" });
  });
});

describe("S66 stopped run mapping", () => {
  const goneFor = async (emit: (env: HostEnv, agentId: string) => void): Promise<{ reason: string | undefined; unknown: number | undefined }> => {
    const { env, agentId } = await bobEnv();
    emit(env, agentId);
    await env.settle();
    return { reason: reports(env).find((r) => r.kind === "gone")?.reason, unknown: env.host.counters().inproc_unknown_event };
  };

  it.each([
    ["timeout", "timeout", undefined],
    ["user", "stopped", undefined],
    ["dock", "stopped", undefined],
    ["queue-removal", "stopped", undefined],
    [undefined, "stopped", undefined],
    ["weird", "stopped", 1],
  ])("completed stopped with stoppedBy %s → gone: %s", async (stoppedBy, reason, unknown) => {
    const got = await goneFor((env, agentId) => env.bus.emit(SUBAGENTS_CHANNEL.completed, { agentId, details: { status: "stopped", ...(stoppedBy !== undefined ? { stoppedBy } : {}) } }));
    expect(got).toEqual({ reason, unknown });
  });

  it("failed stopped likewise maps the stop reason; a plain failure with no stop is child_failed", async () => {
    expect(await goneFor((env, agentId) => env.bus.emit(SUBAGENTS_CHANNEL.failed, { agentId, details: { status: "aborted", stoppedBy: "timeout" } }))).toMatchObject({ reason: "timeout" });
    expect(await goneFor((env, agentId) => env.bus.emit(SUBAGENTS_CHANNEL.failed, { agentId, error: "x" }))).toMatchObject({ reason: "child_failed" });
  });

  it.each([
    ["ttl", "idle_disposed", undefined],
    ["cap", "idle_disposed", undefined],
    ["cancel", "stopped", undefined],
    ["shutdown", "lead_ended", undefined],
    ["other", "stopped", 1],
    [undefined, "stopped", undefined],
  ])("disposed.reason %s → gone: %s", async (disposed, reason, unknown) => {
    const got = await goneFor((env, agentId) => env.bus.emit(SUBAGENTS_CHANNEL.disposed, { agentId, ...(disposed !== undefined ? { reason: disposed } : {}) }));
    expect(got).toEqual({ reason, unknown });
  });
});

describe("S67 unknown events (observability)", () => {
  it("events for ids outside the registry (the lead's own subagents) are ignored silently: no report, no counter, no throw", async () => {
    const { env } = await bobEnv();
    const before = env.sent.length;
    for (const channel of [SUBAGENTS_CHANNEL.created, SUBAGENTS_CHANNEL.started, SUBAGENTS_CHANNEL.completed, SUBAGENTS_CHANNEL.idle, SUBAGENTS_CHANNEL.disposed]) {
      env.bus.emit(channel, { agentId: "lead-own-agent", run: 3, result: "x", reason: "ttl" });
    }
    await env.settle();
    expect(env.sent).toHaveLength(before);
    expect(env.host.counters().inproc_unknown_event).toBeUndefined();
  });

  it("malformed shapes are ignored and counted one each; the mapper keeps processing the next event", async () => {
    const { env, agentId } = await bobEnv();
    const malformed: unknown[] = [
      {},
      null,
      "str",
      { agentId: 5 },
      { agentId, run: "3" },
      { agentId, run: -1 },
      { agentId, result: 7 },
      { agentId, details: "x" },
      JSON.parse(`{"__proto__":{"x":1},"agentId":"${agentId}"}`),
      { agentId: "a".repeat(1024 * 1024) },
    ];
    for (const payload of malformed) env.bus.emit(SUBAGENTS_CHANNEL.idle, payload);
    await env.settle();
    expect(env.host.counters().inproc_unknown_event).toBe(malformed.length);
    env.double.finishRun(agentId, { result: "still works" });
    await env.settle();
    expect(reports(env).at(-1)).toMatchObject({ kind: "idle", finalText: "still works" });
  });
});

describe("S68 concurrency and queue visibility", () => {
  it("teammates 5 and 6 wait with a 1-based queuePosition; a queued member never fails while it waits (host has no spawn clock); started arrives when a slot frees", async () => {
    const env = createHostEnv({ double: { maxConcurrent: 4 } });
    await env.start();
    const acks = [];
    for (const name of ["a", "b", "c", "d", "e", "f"]) acks.push(await env.spawn(name));
    expect(acks.map((a) => a.status)).toEqual(["running", "running", "running", "running", "queued", "queued"]);
    expect(acks.slice(4).map((a) => a.queuePosition)).toEqual([1, 2]);
    await env.clock.advanceAsync(10 * 60_000); // 10 × a spawnTimeoutMs: nothing the host does ends a queued member
    expect(env.events().filter((e) => e.kind === "gone" || e.kind === "state")).toEqual([]);
    env.double.startQueued(acks[4]?.agentId as string);
    await env.settle();
    expect(env.events().at(-1)).toMatchObject({ member: "e", kind: "started", run: 1 });
    expect(env.host.snapshot().members.find((m) => m.member === "f")?.state).toBe("spawning");
  });

  it.todo("a continued run (steer to an idle child) that re-queues keeps the member idle with a queuePosition until started: the contract has no re-queue signal yet (upstream 0.9.0)");
});

describe("S82 interrupt race with natural completion", () => {
  it("interrupt in flight when the run completes naturally: upstream says not_running; the member is not stuck busy and there is one idle report", async () => {
    const { env, agentId } = await bobEnv();
    env.double.nextInterruptResult("not_running");
    env.command({ cmd: "interrupt", cmdId: "race", member: "bob" });
    env.double.finishRun(agentId, { result: "natural" }); // the run ends first
    await env.settle();
    expect(env.ackOf("race")).toMatchObject({ ok: true, result: "not_running" });
    expect(reports(env).filter((r) => r.kind === "idle")).toEqual([expect.objectContaining({ run: 1, finalText: "natural" })]);
    expect(reports(env).find((r) => r.kind === "idle")?.aborted).toBeUndefined(); // late settle: no abort flag, no auto-claim suppression
    expect(env.host.snapshot().members[0]).toMatchObject({ state: "idle" });
  });

  it("an interrupt after the run already completed is a success no-op; a stop for the same child afterwards yields gone once", async () => {
    const { env, agentId } = await bobEnv();
    env.double.finishRun(agentId, { result: "natural" });
    await env.settle();
    env.command({ cmd: "interrupt", cmdId: "late", member: "bob" });
    env.command({ cmd: "stop", cmdId: "stop-after", member: "bob" });
    await env.settle();
    expect(env.ackOf("late")).toMatchObject({ ok: true, result: "not_busy" });
    expect(env.ackOf("stop-after")).toMatchObject({ ok: true });
    expect(reports(env).filter((r) => r.kind === "idle")).toHaveLength(1);
    expect(reports(env).filter((r) => r.kind === "gone")).toHaveLength(1);
  });

  it("interrupt without the feature: interrupt_unavailable and the child keeps running (never emulated by stop)", async () => {
    // Without the `interrupt` feature in the capability answer the host refuses before any upstream call.
    const noInterrupt = createHostEnv({ double: { answer: { apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } } } });
    await noInterrupt.start();
    await noInterrupt.spawn("bob");
    noInterrupt.command({ cmd: "interrupt", cmdId: "nope", member: "bob" });
    await noInterrupt.settle();
    expect(noInterrupt.ackOf("nope")).toMatchObject({ ok: false, error: "interrupt_unavailable" });
    expect(noInterrupt.double.children.size).toBe(1);
  });
});


// ── server lifecycle intake (tasks 7.1, 7.3, 7.7, 7.8): the real runtime over the real host ──────────────────────────────

const lead = (st: InProcStack) => st.env.lead;
async function createTask(st: InProcStack, title: string, owner?: string): Promise<string> {
  const res = await st.env.fake.call(lead(st), "TaskCreate", { title, description: `${title} description`, ...(owner ? { owner } : {}) });
  if (!res.ok) throw new Error(`TaskCreate: ${res.error}`);
  return res.data.task.id as string;
}
const taskOf = (st: InProcStack, team: Team, id: string) => st.env.rt.store.task(st.env.rt.store.get(team.id) as Team, id);

async function started(opts: Parameters<typeof createInProcStack>[0] = {}): Promise<{ st: InProcStack; team: Team }> {
  const st = createInProcStack(opts);
  await st.start();
  const team = await st.createTeam();
  await st.spawn(team, "bob");
  return { st, team };
}

describe("S60 (server) child lifecycle mapping: member state, tasks and the lead notice follow the reports", () => {
  it("spawning → busy (first started) → idle (completed+idle) → busy (steer starts run 2) → gone (dock Stop): tasks back to pending, ONE waking notice", async () => {
    const { st, team } = await started();
    expect(st.member(team, "bob")).toMatchObject({ status: "busy", childId: expect.stringMatching(/^bg-/), childAgentId: expect.any(String) });
    expect(st.member(team, "bob").sessionId).toBeUndefined();
    st.double.finishRun(st.agentOf(team, "bob"), { result: "first answer" });
    await st.settle();
    expect(st.member(team, "bob")).toMatchObject({ status: "idle", lastSettleId: 1 });
    // a task is assigned: the dispatcher claims it for the idle child and its steer starts run 2
    const taskId = await createTask(st, "write the report", "bob");
    await st.settle();
    expect(st.member(team, "bob").status).toBe("busy");
    expect(taskOf(st, team, taskId)).toMatchObject({ status: "in_progress", owner: "bob" });
    await st.flushNotices();
    const before = st.notices(team).length;
    st.double.dispose(st.agentOf(team, "bob"), "cancel"); // the dock Stop
    await st.settle();
    expect(st.member(team, "bob")).toMatchObject({ status: "gone", goneReason: "stopped" });
    expect(taskOf(st, team, taskId)).toMatchObject({ status: "pending" });
    expect(taskOf(st, team, taskId)?.owner).toBeUndefined();
    await st.flushNotices();
    expect(st.notices(team)).toHaveLength(before + 1);
    expect(st.notices(team).at(-1)).toMatchObject({ wake: true });
    expect(st.notices(team).at(-1)?.text).toContain("released to pending");
  });

  it("a gone member is never resurrected: later reports for it are ignored; unknown members are an application error", async () => {
    const { st, team } = await started();
    st.double.dispose(st.agentOf(team, "bob"), "cancel");
    await st.settle();
    expect(await st.event({ member: "bob", run: 5, kind: "started" })).toMatchObject({ ok: true, data: { ignored: true } });
    expect(await st.event({ member: "bob", run: 5, kind: "idle", finalText: "ghost" })).toMatchObject({ ok: true, data: { ignored: true } });
    expect(st.member(team, "bob").status).toBe("gone");
    expect(await st.event({ member: "nobody", run: 1, kind: "started" })).toMatchObject({ ok: false });
    expect(await st.event({ member: "bob", run: -1, kind: "started" })).toMatchObject({ ok: false, error: "invalid_args" });
  });

  it("a stale re-sent `started` of a run that already settled does not flip an idle member back to busy; a duplicate idle is deduped by lastSettleId (one notice)", async () => {
    const { st, team } = await started();
    st.double.finishRun(st.agentOf(team, "bob"), { result: "r1" });
    await st.settle();
    await st.event({ member: "bob", run: 1, kind: "started" });
    await st.event({ member: "bob", run: 1, kind: "idle", finalText: "r1" });
    await st.flushNotices();
    expect(st.member(team, "bob").status).toBe("idle");
    expect(st.notices(team).filter((m) => m.text.includes("r1"))).toHaveLength(1);
  });
});

describe("S63 (server) run ends with an error or an empty answer", () => {
  it("failed + idle: the idle notice carries the error text and the dispatcher does NOT auto-claim; an empty final reply is an error idle too", async () => {
    const { st, team } = await started();
    const taskId = await createTask(st, "next job");
    st.double.finishRun(st.agentOf(team, "bob"), { error: "the model exploded" });
    await st.settle();
    await st.flushNotices();
    expect(st.member(team, "bob").status).toBe("idle");
    expect(taskOf(st, team, taskId)).toMatchObject({ status: "pending" }); // no auto-claim after an error
    expect(st.notices(team).at(-1)?.text).toMatch(/stopped with an error[\s\S]*the model exploded/);
    // the next run ends with an empty answer: the host reports "no final output" as an error
    st.double.finishRun(st.agentOf(team, "bob"), { result: "" });
    await st.settle();
    await st.event({ member: "bob", run: 2, kind: "started" }); // (the double did not restart it: run 2 is reported by hand)
    await st.event({ member: "bob", run: 2, kind: "idle", error: "subagent produced no final output" });
    await st.flushNotices();
    expect(st.notices(team).at(-1)?.text).toContain("no final output");
    expect(taskOf(st, team, taskId)).toMatchObject({ status: "pending" });
  });

  it("an oversize final text is cut by core's maxFinalTextChars with its marker; the notice never carries the whole 4 MiB", async () => {
    const { st, team } = await started({ config: { maxFinalTextChars: 2000 } });
    await st.event({ member: "bob", run: 1, kind: "idle", finalText: "x".repeat(4 * 1024 * 1024) });
    await st.flushNotices();
    const text = st.notices(team).at(-1)?.text ?? "";
    expect(text.length).toBeLessThan(2500);
    expect(text).toMatch(/truncated/);
  });
});

describe("S64 (server) interrupt available: silent abort", () => {
  it("urgent SendMessage to a busy child: interrupt → idle{aborted:true} raises no idle notice and no auto-claim; the held wake mail then starts the next run", async () => {
    const { st, team } = await started();
    const taskId = await createTask(st, "queued job");
    await st.flushNotices();
    const noticesBefore = st.notices(team).length;
    const res = await st.env.fake.call(lead(st), "SendMessage", { to: "bob", message: "drop everything and report", priority: "urgent" });
    expect(res.ok && res.data.degraded).toBeFalsy();
    await st.settle();
    expect(st.sent.some((p) => p.op === "ack" && (p as { result?: string }).result === "interrupted")).toBe(true);
    st.double.finishRun(st.agentOf(team, "bob"), { aborted: true });
    await st.settle();
    await st.flushNotices();
    expect(st.notices(team)).toHaveLength(noticesBefore); // silent
    expect(taskOf(st, team, taskId)).toMatchObject({ status: "pending" }); // no auto-claim on an aborted settle
    expect(st.member(team, "bob").status).toBe("busy"); // the wake mail started run 2
    expect(st.sent.filter((p) => p.op === "event" && p.kind === "started" && p.run === 2)).toHaveLength(1);
  });
});

describe("S66 (server) stopped / disposed mapping", () => {
  it.each([
    ["stopped", "stopped"],
    ["timeout", "timeout"],
    ["idle_disposed", "idle_disposed"],
    ["lead_ended", "lead_ended"],
    ["child_failed", "child_failed"],
    ["not_alive", "not_alive"],
  ])("gone reason %s is the member's goneReason; tasks return to pending and the lead is woken", async (reason, expected) => {
    const { st, team } = await started();
    const taskId = await createTask(st, "job", "bob");
    st.double.finishRun(st.agentOf(team, "bob"), { result: "x" });
    await st.settle();
    await st.settle();
    await st.event({ member: "bob", run: 1, kind: "gone", reason });
    await st.flushNotices();
    expect(st.member(team, "bob")).toMatchObject({ status: "gone", goneReason: expected });
    expect(taskOf(st, team, taskId)?.status).toBe("pending");
    expect(st.notices(team).some((m) => m.wake)).toBe(true);
    expect(st.env.rt.counters.get("inproc_unknown_event", team.id)).toBe(0);
  });

  it.each(["weird", "", "TTL"])("an unknown gone reason %j maps to stopped and counts inproc_unknown_event (upstream drift)", async (reason) => {
    const { st, team } = await started();
    await st.event({ member: "bob", run: 1, kind: "gone", ...(reason ? { reason } : {}) });
    expect(st.member(team, "bob")).toMatchObject({ status: "gone", goneReason: "stopped" });
    expect(st.env.rt.counters.get("inproc_unknown_event", team.id)).toBe(reason === "" ? 0 : 1);
  });

  it("through the host: every dock/upstream cause ends as the documented member reason", async () => {
    for (const [cause, expected] of [["cancel", "stopped"], ["ttl", "idle_disposed"], ["cap", "idle_disposed"], ["shutdown", "lead_ended"], ["other", "stopped"]] as const) {
      const { st, team } = await started();
      st.double.dispose(st.agentOf(team, "bob"), cause);
      await st.settle();
      expect(st.member(team, "bob").goneReason).toBe(expected);
    }
  });
});

describe("S68 (server) concurrency and queue visibility", () => {
  const twoSlots = { double: { maxConcurrent: 2, answer: validCapabilities({ limits: { maxConcurrent: 2, maxBackgroundPending: 4, maxIdleBackground: 4, cwdScope: "repo" } }) } };

  it("members beyond the pool stay `spawning` with a 1-based queuePosition and never fail while queued; started makes them busy and clears the position", async () => {
    const st = createInProcStack(twoSlots);
    await st.start();
    const team = await st.createTeam();
    for (const n of ["a", "b", "c", "d"]) await st.spawn(team, n);
    expect(["a", "b", "c", "d"].map((n) => st.member(team, n).status)).toEqual(["busy", "busy", "spawning", "spawning"]);
    expect(["c", "d"].map((n) => st.member(team, n).queuePosition)).toEqual([1, 2]);
    await st.clock.advanceAsync(10 * 60_000); // 10 × spawnTimeoutMs: the readiness clock starts at the first `started`, so a queued member never fails
    expect(["c", "d"].map((n) => st.member(team, n).status)).toEqual(["spawning", "spawning"]);
    st.double.startQueued(st.agentOf(team, "c"));
    await st.settle();
    expect(st.member(team, "c")).toMatchObject({ status: "busy" });
    expect(st.member(team, "c").queuePosition).toBeUndefined();
    expect(st.member(team, "d").status).toBe("spawning");
  });

  it("spawnTimeoutMs counts from the FIRST started: T−1 still waiting for the child's guarded hello, T fails it (child stopped), a hello in time keeps it", async () => {
    const T = 20_000;
    const st = createInProcStack({ config: { spawnTimeoutMs: T } });
    await st.start();
    const team = await st.createTeam();
    await st.spawn(team, "slow");
    await st.spawn(team, "fast");
    await st.helloAs(team, "fast"); // the proxied guarded hello at session_start
    await st.clock.advanceAsync(T - 1);
    expect(st.member(team, "slow").status).toBe("busy");
    await st.clock.advanceAsync(1);
    await st.settle();
    expect(st.member(team, "slow")).toMatchObject({ status: "failed" });
    expect(st.member(team, "slow").goneReason).toMatch(/guarded hello/);
    expect(st.double.events.some((e) => e.channel === "subagents:completed" && e.payload.agentId === st.agentOf(team, "slow") && (e.payload.details as { status?: string }).status === "stopped")).toBe(true); // the child was stopped
    expect(st.member(team, "fast").status).toBe("busy");
  });

  it("an idle member whose continued run re-queued shows its queuePosition (a `state` report with a position) and keeps idle; started clears it", async () => {
    const { st, team } = await started();
    st.double.finishRun(st.agentOf(team, "bob"), { result: "x" });
    await st.settle();
    await st.event({ member: "bob", run: 1, kind: "state", state: "idle", queuePosition: 2 });
    expect(st.member(team, "bob")).toMatchObject({ status: "idle", queuePosition: 2 });
    await st.event({ member: "bob", run: 2, kind: "started" });
    expect(st.member(team, "bob")).toMatchObject({ status: "busy" });
    expect(st.member(team, "bob").queuePosition).toBeUndefined();
  });
});

describe("S69 parallelism bound stated in the TeammateSpawn result", () => {
  it.each([
    [3, 2, true],
    [3, 4, false],
    [4, 4, false],
    [5, 4, true],
    [6, 4, true],
    [4, 2, true],
    [5, 2, true],
  ])("maxTeammates %i × maxConcurrent %i: the result %s the bound", async (maxTeammates, maxConcurrent, stated) => {
    const st = createInProcStack({ config: { maxTeammates: 8 }, double: { maxConcurrent, answer: validCapabilities({ limits: { maxConcurrent, maxBackgroundPending: 4, maxIdleBackground: 4, cwdScope: "repo" } }) } });
    await st.start();
    const created = await st.env.fake.call(st.env.lead, "TeamCreate", { name: "t", mode: "in-process", maxTeammates });
    expect(created.ok).toBe(true);
    const res = await st.env.fake.call(st.env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    expect(res.ok).toBe(true);
    if (stated) {
      expect(res.data.note).toContain(`At most ${maxConcurrent} teammates run in parallel`);
      expect(res.data.note).toMatch(/shared with the lead's own Agent calls/);
    } else {
      expect(res.data.note).toBeUndefined();
    }
  });

  it("a session-mode team's spawn result is unchanged (no note)", async () => {
    const st = createInProcStack();
    const res = await st.env.fake.call(st.env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    expect(res.ok && res.data.note).toBeUndefined();
  });
});

describe("S82 (server) interrupt race with natural completion", () => {
  it("the run completes naturally while the urgent interrupt is in flight: the member is not stuck busy, no double idle notice (core suppresses it for the urgent settle), the wake mail is delivered exactly once", async () => {
    const { st, team } = await started();
    st.double.nextInterruptResult("not_running"); // upstream: the run had already ended
    await st.env.fake.call(lead(st), "SendMessage", { to: "bob", message: "urgent word", priority: "urgent" });
    st.double.finishRun(st.agentOf(team, "bob"), { result: "natural end" });
    await st.settle();
    await st.flushNotices();
    expect(st.member(team, "bob").status).toBe("busy"); // the held urgent mail started run 2 after the (natural) settle
    expect(st.notices(team).filter((m) => m.text.includes("natural end"))).toHaveLength(0); // the urgent wake mail restarts the child: no idle notice, no auto-claim
    const steers = st.sent.filter((p) => p.op === "ack" && ["started", "queued"].includes(String((p as { result?: string }).result)));
    expect(steers).toHaveLength(1);
  });
});
