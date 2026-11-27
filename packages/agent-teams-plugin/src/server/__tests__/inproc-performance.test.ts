/**
 * Performance rows of the in-process command channel (test-plan S96, S102) at the L1 level: no loss under load and the queue bounds.
 * Latency numbers are REPORT-ONLY until a baseline is committed (decision A12): `BASELINE_P99_MS` stays `undefined` until a recorded run
 * fills it, after which the gate is "≤ 1.5× the baseline". The guards below are generous sanity bounds, not SLOs.
 * Real driver ↔ real lead host over the contract double, fake clock; no pi, no sockets.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { createInProcPair, type InProcPair } from "../../__tests__/harness/inproc-pair.js";
import { MAX_MAIL_LINES } from "../../shared/constants.js";
import { INPROC_QUEUE_MAX_BYTES, INPROC_QUEUE_MAX_ENTRIES, type SteerCommand } from "../../shared/inproc-protocol.js";
import { SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import type { Mail } from "../../shared/types.js";

/** Committed p99 baseline in ms (absolute numbers are committed after the first recorded run). */
const BASELINE_P99_MS: number | undefined = undefined;
const RATCHET = 1.5;

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function world(members: string[], opts: Parameters<typeof createInProcPair>[0] = {}): Promise<InProcPair> {
  // A flood of 8 KB mails must measure the command channel, not the mail log's own compaction (its default cap is 2 MiB).
  const pair = createInProcPair({ host: { double: { maxConcurrent: 8 } }, store: { maxMailLogBytes: () => 256 * 1024 * 1024 }, ...opts });
  await pair.start();
  for (const m of members) {
    pair.reserve(m);
    await pair.spawn(m);
    pair.store.patchMember(pair.team.id, m, { status: "busy" });
  }
  return pair;
}
const mailTo = (pair: InProcPair, to: string, text: string): Mail => pair.store.appendMail(pair.team.id, { from: "lead", to, kind: "message", text, wake: true }) as Mail;
const steers = (pair: InProcPair): SteerCommand[] => pair.cmds().filter((c) => c.cmd === "steer") as SteerCommand[];
/** Turn the promise queue until `done()` (a long chain of acks needs many turns). */
async function until(pair: InProcPair, done: () => boolean, max = 20_000): Promise<void> {
  for (let i = 0; i < max && !done(); i++) {
    await pair.settle();
    if (i % 25 === 24) await macrotask(); // the mail log persists to disk: let its real I/O drain instead of piling up behind microtasks
  }
}
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("S96 command/ack round trip", () => {
  it("4 busy members, 200 steer commands per minute for 5 minutes: no ack loss; p95/p99 recorded as a report-only baseline", async () => {
    const names = ["a", "b", "c", "d"];
    const pair = await world(names);
    const total = 200 * 5;
    const latencies: number[] = [];
    const ids: number[] = [];
    for (let i = 0; i < total; i++) {
      pair.clock.advance(300); // 200 per minute
      const to = names[i % names.length] as string;
      const mail = mailTo(pair, to, `steer ${i}`);
      ids.push(mail.id);
      const t0 = performance.now();
      pair.driver.deliver({ teamId: pair.team.id, member: to }, [mail], { wake: true });
      await until(pair, () => pair.store.pendingMail(pair.team.id, to).every((m) => m.id !== mail.id), 200);
      latencies.push(performance.now() - t0);
    }
    const sorted = [...latencies].sort((x, y) => x - y);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    console.info(`[inproc-perf] steer round trip over ${total} commands: p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms (report-only until BASELINE_P99_MS is committed)`);
    // no loss: every command was acknowledged, every mail handed over, nothing timed out or is still queued
    expect(steers(pair)).toHaveLength(total);
    expect(pair.store.mailLog(pair.team.id).filter((m) => ids.includes(m.id) && m.ackedAt === undefined)).toHaveLength(0);
    expect(pair.counters.get("inproc_delivery_timeout")).toBe(0);
    expect(pair.driver.queueSize()).toBe(0);
    expect(p99).toBeLessThan(250); // sanity guard, not an SLO
    if (BASELINE_P99_MS !== undefined) expect(p99).toBeLessThanOrEqual(BASELINE_P99_MS * RATCHET);
  });
});

describe("S102 mail flood to one busy child", () => {
  /** `n` 8 KB mails queued behind an unacknowledged steer (the child is inside a long tool); returns once they are all submitted. */
  async function flood(n: number) {
    const pair = await world(["bob"]);
    const delivered = seen(pair);
    const release = pair.holdAcks();
    const ids: number[] = [];
    const body = "z".repeat(8 * 1024);
    for (let i = 0; i < n; i++) {
      const mail = mailTo(pair, "bob", `${i}:${body}`);
      ids.push(mail.id);
      pair.driver.deliver({ teamId: pair.team.id, member: "bob" }, [mail], { wake: true });
      if (i % 50 === 49) await macrotask();
    }
    await pair.settle();
    return { pair, release, ids, delivered };
  }
  const seen = (pair: InProcPair): number[] => {
    const out: number[] = [];
    pair.host.bus.on(SUBAGENTS_CHANNEL.steerRequest, (p: unknown) => {
      for (const m of (p as { message: string }).message.matchAll(/\[agent-teams · mail id (\d+)\]/g)) out.push(Number(m[1]));
    });
    return out;
  };

  it("1 000 mails of 8 KB (just under the cap): the queue stays within 1 000 entries / 8 MiB, every steer block is within core's 150 lines, all are delivered once, in order, none lost", async () => {
    const pair0 = await world(["bob"]);
    const delivered = seen(pair0);
    const release = pair0.holdAcks();
    const ids: number[] = [];
    const body = "z".repeat(8 * 1024);
    for (let i = 0; i < 1000; i++) {
      const mail = mailTo(pair0, "bob", `${i}:${body}`);
      ids.push(mail.id);
      pair0.driver.deliver({ teamId: pair0.team.id, member: "bob" }, [mail], { wake: true });
      if (i % 50 === 49) await macrotask();
    }
    await pair0.settle();
    expect(pair0.driver.queueSize()).toBeLessThanOrEqual(INPROC_QUEUE_MAX_ENTRIES);
    expect(pair0.counters.get("inproc_queue_overflow")).toBe(0);
    release();
    await until(pair0, () => pair0.store.pendingMail(pair0.team.id, "bob").length === 0);
    expect(delivered).toEqual(ids); // once, in mail-id order
    expect(pair0.store.pendingMail(pair0.team.id, "bob")).toHaveLength(0);
    for (const c of steers(pair0)) for (const b of c.blocks ?? []) expect(b.split("\n").length).toBeLessThanOrEqual(MAX_MAIL_LINES);
    expect(INPROC_QUEUE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it("a 1 200-mail variant drops the oldest queued commands with inproc_queue_overflow; their mails stay queued (never lost); the rest is delivered once, in order", async () => {
    const { pair, release, ids, delivered } = await flood(1200);
    expect(pair.driver.queueSize()).toBeLessThanOrEqual(INPROC_QUEUE_MAX_ENTRIES);
    const dropped = pair.counters.get("inproc_queue_overflow");
    expect(dropped).toBe(1200 - 1 - INPROC_QUEUE_MAX_ENTRIES); // one command is outstanding, 1 000 fit in the queue
    release();
    await until(pair, () => pair.driver.queueSize() === 0 && steers(pair).length >= 1200 - dropped);
    await pair.settle();
    // the dropped (oldest queued) commands never reached the child, but their mails are still queued for the next flush
    const pending = pair.store.pendingMail(pair.team.id, "bob").map((m) => m.id);
    expect(pending).toEqual(ids.slice(1, 1 + dropped));
    expect(new Set(delivered).size).toBe(delivered.length); // never twice
    expect(delivered).toEqual([...delivered].sort((x, y) => x - y)); // in order
    expect(delivered.length + pending.length).toBe(1200);
  });
});
