/**
 * Mail abuse limits over the real lane (test-plan S53 token bucket, S54 pair loop
 * breaker, S71 same-tick bucket race, S73 same-tick pair race). Time is the
 * injected `FakeClock`; every sender/recipient is a connected idle member.
 * See change: add-agent-teams-core.
 */
import { describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import type { Team } from "../../shared/types.js";

async function setup(config?: Record<string, unknown>) {
  const e = createTeamsEnv(config ? { config } : {});
  const team = await e.createTeam();
  for (const n of ["alice", "bob"]) e.addMember(team, n, "idle");
  return { e, team };
}

const send = (e: TeamsEnv, who: string, to: string, message = "m") => e.call(who, "SendMessage", { to, message });
const okCount = (rs: Array<{ ok: boolean }>) => rs.filter((r) => r.ok).length;
const leadNotices = (e: TeamsEnv, team: Team) => e.mailsTo(team, "lead").filter((m) => m.kind === "notice");

describe("rate limit (S53)", () => {
  it("capacity 6: sends 1–6 ok, the 7th is rate_limited; +9 s refused, +10 s exactly one more", async () => {
    const { e } = await setup({ mailRatePerMin: 6 });
    for (let i = 1; i <= 6; i++) expect((await send(e, "lead", "alice")).ok, `send ${i}`).toBe(true);
    expect(await send(e, "lead", "alice")).toMatchObject({ ok: false, error: "rate_limited" });
    e.clock.advance(9_000);
    expect(await send(e, "lead", "alice")).toMatchObject({ ok: false, error: "rate_limited" });
    e.clock.advance(1_000);
    expect((await send(e, "lead", "alice")).ok).toBe(true);
    expect(await send(e, "lead", "alice")).toMatchObject({ error: "rate_limited" });
  });

  it("+60 s restores the full capacity of 6 (and no more); other senders are unaffected", async () => {
    const { e } = await setup({ mailRatePerMin: 6 });
    for (let i = 0; i < 6; i++) await send(e, "lead", "alice");
    expect(await send(e, "lead", "alice")).toMatchObject({ error: "rate_limited" });
    expect((await send(e, "alice", "bob")).ok).toBe(true); // a different sender has its own bucket
    e.clock.advance(60_000);
    const again = await Promise.all(Array.from({ length: 8 }, () => send(e, "lead", "alice")));
    expect(okCount(again)).toBe(6);
  });

  it("one token per SendMessage call: a broadcast to every member costs exactly 1", async () => {
    const { e } = await setup({ mailRatePerMin: 6 });
    e.addMember((e.rt.store.list()[0] as Team), "carol", "idle");
    for (let i = 0; i < 5; i++) expect((await e.call("lead", "SendMessage", { to: "*", message: "all" })).ok).toBe(true);
    expect((await send(e, "lead", "alice")).ok).toBe(true); // 6th token
    expect(await send(e, "lead", "alice")).toMatchObject({ error: "rate_limited" });
  });

  it("refused calls (size, recipient, self) consume no token", async () => {
    const { e } = await setup({ mailRatePerMin: 6, maxMessageChars: 5 });
    for (let i = 0; i < 20; i++) await send(e, "lead", "alice", "way too long for the cap");
    for (let i = 0; i < 20; i++) await send(e, "lead", "nobody", "ok");
    for (let i = 0; i < 6; i++) expect((await send(e, "lead", "alice", "ok")).ok).toBe(true);
  });
});

describe("pair loop breaker (S54)", () => {
  async function pingPong(e: TeamsEnv, n: number): Promise<Array<{ ok: boolean; error?: string }>> {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await send(e, i % 2 === 0 ? "alice" : "bob", i % 2 === 0 ? "bob" : "alice", `m${i}`));
    return out;
  }

  it("≤10 exchanged mails are delivered; the 11th is rate_limited with ONE non-waking lead notice, counting both directions", async () => {
    const { e, team } = await setup({ mailRatePerMin: 1000, pairExchangeLimit: 10 });
    const first = await pingPong(e, 10);
    expect(okCount(first)).toBe(10);
    expect(await send(e, "alice", "bob")).toMatchObject({ ok: false, error: "rate_limited" });
    expect(await send(e, "bob", "alice")).toMatchObject({ ok: false, error: "rate_limited" });
    e.flushNotices();
    const notices = leadNotices(e, team);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ wake: false });
    expect(notices[0]?.text).toContain("alice");
    expect(notices[0]?.text).toContain("bob");
  });

  it("9 and 10 exchanges never trip; the limit is per pair, not per member", async () => {
    const { e, team } = await setup({ mailRatePerMin: 1000, pairExchangeLimit: 10 });
    e.addMember(team, "carol", "idle");
    expect(okCount(await pingPong(e, 9))).toBe(9);
    expect((await send(e, "alice", "carol")).ok).toBe(true); // another pair
    expect((await send(e, "bob", "alice")).ok).toBe(true); // 10th of alice↔bob
    expect(await send(e, "alice", "bob")).toMatchObject({ error: "rate_limited" });
  });

  it("any claim / complete / create / assign in the team resets the counter", async () => {
    for (const reset of ["create", "claim", "complete", "assign"] as const) {
      const { e, team } = await setup({ mailRatePerMin: 1000, pairExchangeLimit: 10 });
      e.rt.store.patchMember(team.id, "alice", { status: "busy" });
      e.rt.store.patchMember(team.id, "bob", { status: "busy" });
      e.rt.store.addTask(team.id, { title: "t", description: "d", createdBy: "lead" });
      if (reset === "complete") e.rt.store.patchTask(team.id, "1", { status: "in_progress", owner: "alice" });
      expect(okCount(await pingPong(e, 10))).toBe(10);
      expect(await send(e, "alice", "bob"), reset).toMatchObject({ error: "rate_limited" });
      if (reset === "create") await e.call("lead", "TaskCreate", { title: "new" });
      if (reset === "claim") await e.call("bob", "TaskUpdate", { id: "1", status: "in_progress" });
      if (reset === "complete") await e.call("alice", "TaskUpdate", { id: "1", status: "completed" });
      if (reset === "assign") await e.call("lead", "TaskUpdate", { id: "1", owner: "bob" });
      expect((await send(e, "alice", "bob")).ok, reset).toBe(true);
    }
  });
});

describe("rate bucket concurrency (S71)", () => {
  it("20 same-tick sends from one sender: exactly the capacity succeed, the rest are rate_limited, no negative tokens", async () => {
    const { e } = await setup({ mailRatePerMin: 6 });
    const results = await Promise.all(Array.from({ length: 20 }, () => send(e, "lead", "alice")));
    expect(okCount(results)).toBe(6);
    expect(results.filter((r) => !r.ok).every((r) => (r as { error: string }).error === "rate_limited")).toBe(true);
    e.clock.advance(10_000);
    expect(okCount(await Promise.all(Array.from({ length: 5 }, () => send(e, "lead", "alice"))))).toBe(1);
  });
});

describe("pair loop concurrency (S73)", () => {
  it("alice→bob and bob→alice interleaved at the limit: the counter is exact, the breaker trips once, the lead is told once", async () => {
    const { e, team } = await setup({ mailRatePerMin: 1000, pairExchangeLimit: 10 });
    const calls = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? send(e, "alice", "bob") : send(e, "bob", "alice")));
    const results = await Promise.all(calls);
    expect(okCount(results)).toBe(10);
    e.flushNotices();
    expect(leadNotices(e, team)).toHaveLength(1);
    expect(leadNotices(e, team)[0]?.wake).toBe(false);
    await e.call("lead", "TaskCreate", { title: "progress" });
    expect((await send(e, "alice", "bob")).ok).toBe(true);
  });
});
