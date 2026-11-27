/**
 * ResourceLock (tasks 4.1–4.6; tests 7.11 TTL boundary, 9.7–9.16): limits, acquire semantics, error paths,
 * handoff to dead waiters, FIFO, settled-idle release, grant to a busy waiter, restart, mail spoofing,
 * fairness, sidecar write faults and timer hygiene. Real runtime over the fake host, injected `FakeClock`.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it, vi } from "vitest";
import type { Team } from "../../../shared/types.js";
import { GROUP_RESOURCES, LOCK_GRANT_KIND, LOCK_NAME_RE, lockBriefingText, MAX_TIMER_MS } from "../lock.js";
import { nodeSidecarFs, type SidecarFs } from "../sidecar.js";
import { createOpenspecEnv, type OpenspecEnv, type OpenspecEnvOptions } from "./env.js";

type Env = OpenspecEnv;

/** A group team with an active sidecar and the members `names` (busy). */
async function lockEnv(names: string[] = ["os-a", "os-b", "os-c"], over: OpenspecEnvOptions = {}) {
  const env = await createOpenspecEnv(over);
  return attach(env, names);
}

function attach(env: Env, names: string[], teamIn?: Team) {
  const team = teamIn ?? env.team("group", "g", { seeded: true });
  if (!teamIn) env.api.sidecar.create({ teamId: team.id, kind: "group", goal: "g", repo: env.cwd }, (d) => void (d.seeded = true));
  for (const n of names) env.addMember(team, n, "busy");
  const lock = (who: string, action: string, name = "harness") => env.call(who, "ResourceLock", { action, name }) as unknown as Promise<any> | any;
  const locks = () => env.api.sidecar.get(team.id)?.locks ?? {};
  const grants = (who: string) => env.mailsTo(team, who).filter((m) => m.kind === LOCK_GRANT_KIND);
  const holder = () => locks().harness?.holder;
  const queue = () => locks().harness?.queue ?? [];
  const leadNotices = () => env.mailsTo(team, "lead").filter((m) => m.kind === "notice");
  return { env, team, lock, locks, grants, holder, queue, leadNotices };
}

const okData = (res: any) => {
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return res.data;
};

describe("the op is registered and the mail kind known (4.4, 4.5)", () => {
  it("a member of a group team gets an answer, not unknown_op", async () => {
    const t = await lockEnv(["os-a"]);
    expect(okData(await t.lock("os-a", "status"))).toEqual({ holder: null, position: null, queued: 0 });
  });

  it("the briefing text states the three rules", () => {
    const text = lockBriefingText();
    expect(text).toMatch(/advisory/);
    expect(text).toMatch(/end your turn instead of polling/);
    expect(text).toMatch(/Do not end your turn while you hold/);
    expect(text).toMatch(/memory guard/);
    expect(GROUP_RESOURCES).toEqual(["harness"]);
  });
});

describe("9.7 limits: name (#E26)", () => {
  it.each([
    ["", "invalid_args"],
    ["a", "unknown_resource"],
    ["a".repeat(40), "unknown_resource"],
    ["a".repeat(41), "invalid_args"],
    ["A", "invalid_args"],
    ["a_b", "invalid_args"],
    ["a/b", "invalid_args"],
    ["..", "invalid_args"],
    ["harness ", "invalid_args"],
    ["hárness", "invalid_args"],
    ["database", "unknown_resource"],
  ])("name %j → %s", async (name, code) => {
    const t = await lockEnv(["os-a"]);
    expect(await t.lock("os-a", "acquire", name)).toMatchObject({ ok: false, error: code });
    expect(t.locks()).toEqual({});
  });

  it("harness is accepted; the name rule is [a-z0-9-]{1,40}", async () => {
    const t = await lockEnv(["os-a"]);
    expect(okData(await t.lock("os-a", "acquire"))).toEqual({ granted: true });
    expect(LOCK_NAME_RE.test("harness")).toBe(true);
  });
});

describe("9.8 acquire semantics (#E28)", () => {
  it("free → granted; own → granted again (refresh); other → granted:false with holder and a stable 1-based position", async () => {
    const t = await lockEnv();
    expect(okData(await t.lock("os-a", "acquire"))).toEqual({ granted: true });
    expect(okData(await t.lock("os-a", "acquire"))).toEqual({ granted: true });
    expect(okData(await t.lock("os-b", "acquire"))).toEqual({ granted: false, holder: "os-a", position: 1 });
    expect(okData(await t.lock("os-c", "acquire"))).toEqual({ granted: false, holder: "os-a", position: 2 });
    expect(okData(await t.lock("os-b", "acquire"))).toEqual({ granted: false, holder: "os-a", position: 1 }); // duplicate wait keeps ONE slot
    expect(t.queue()).toEqual(["os-b", "os-c"]);
  });

  it("status is read-only for holder, waiter and outsider", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    const writes = t.env.api.sidecar.writes;
    expect(okData(await t.lock("os-a", "status"))).toEqual({ holder: "os-a", position: null, queued: 1 });
    expect(okData(await t.lock("os-b", "status"))).toEqual({ holder: "os-a", position: 1, queued: 1 });
    expect(okData(await t.lock("os-c", "status"))).toEqual({ holder: "os-a", position: null, queued: 1 });
    expect(t.env.api.sidecar.writes).toBe(writes);
  });

  it("release by a non-holder non-waiter fails not_holder; by the holder it frees the lock", async () => {
    const t = await lockEnv();
    expect(await t.lock("os-b", "release")).toMatchObject({ ok: false, error: "not_holder" });
    await t.lock("os-a", "acquire");
    expect(await t.lock("os-c", "release")).toMatchObject({ ok: false, error: "not_holder" });
    expect(okData(await t.lock("os-a", "release"))).toEqual({ released: true });
    expect(t.holder()).toBeUndefined();
  });
});

describe("9.9 error paths (#X16)", () => {
  it.each([
    [{ action: "steal", name: "harness" }],
    [{ action: "acquire" }],
    [{ name: "harness" }],
    [{ action: "acquire", name: "harness", extra: 1 }],
    ["acquire"],
    [null],
  ])("bad args %j → invalid_args", async (args) => {
    const t = await lockEnv(["os-a"]);
    expect(await t.env.call("os-a", "ResourceLock", args)).toMatchObject({ ok: false, error: "invalid_args" });
  });

  it("a plain team and an openspec-apply team answer no_resources", async () => {
    const env = await createOpenspecEnv();
    const plain = await env.createTeam("plain");
    env.addMember(plain, "p1", "busy");
    expect(await env.call("p1", "ResourceLock", { action: "acquire", name: "harness" })).toMatchObject({ ok: false, error: "no_resources" });
    const apply = env.team("apply", "x", { seeded: true });
    env.api.sidecar.create({ teamId: apply.id, kind: "apply", goal: "x", repo: env.cwd }, (d) => void (d.seeded = true));
    env.addMember(apply, "ap1", "busy");
    expect(await env.call("ap1", "ResourceLock", { action: "acquire", name: "harness" })).toMatchObject({ ok: false, error: "no_resources" });
    expect(env.api.sidecar.get(apply.id)?.locks).toEqual({});
  });

  it("a lead, or a session outside every team, is refused", async () => {
    const t = await lockEnv(["os-a"]);
    const lead = await t.env.createTeam("other");
    expect(await t.env.call("lead", "ResourceLock", { action: "status", name: "harness" })).toMatchObject({ ok: false });
    expect(lead.id).not.toBe(t.team.id);
    expect(t.locks()).toEqual({});
  });

  it("queue_full once maxTeammates waiters are queued; a queued waiter's release dequeues it", async () => {
    const t = await lockEnv(["os-a", "os-b", "os-c", "os-d"]);
    t.team.maxTeammates = 2;
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    await t.lock("os-c", "acquire");
    expect(await t.lock("os-d", "acquire")).toMatchObject({ ok: false, error: "queue_full" });
    expect(t.queue()).toEqual(["os-b", "os-c"]);
    expect(okData(await t.lock("os-b", "release"))).toEqual({ released: true }); // not not_holder
    expect(t.queue()).toEqual(["os-c"]);
    expect(t.holder()).toBe("os-a");
  });

  it("a throwing op answers an error result and leaves the lock state unchanged", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    const before = structuredClone(t.locks());
    const spy = vi.spyOn(t.env.api.sidecar, "update").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await t.lock("os-b", "acquire")).ok).toBe(false);
    spy.mockRestore();
    expect(t.locks()).toEqual(before);
  });

  it("a team without a usable sidecar answers sidecar_missing / no_resources and never grants", async () => {
    const t = await lockEnv(["os-a"]);
    t.env.api.sidecar.markLost({ teamId: t.team.id, kind: "group", goal: "g", repo: t.env.cwd }, "corrupt");
    expect(await t.lock("os-a", "acquire")).toMatchObject({ ok: false, error: "sidecar_missing" });
  });
});

describe("9.10 handoff to a dead waiter (#X17)", () => {
  async function queued() {
    const t = await lockEnv(["os-a", "os-b", "os-c", "os-d"]);
    await t.lock("os-a", "acquire");
    for (const w of ["os-b", "os-c", "os-d"]) await t.lock(w, "acquire");
    return t;
  }

  it("gone / shutdown_pending waiters are skipped synchronously; the live one is granted ONCE", async () => {
    const t = await queued();
    t.env.rt.store.patchMember(t.team.id, "os-c", { status: "shutdown_pending" });
    t.env.rt.ops.releaseMember(t.team, "os-b", "gone", "x");
    expect(t.queue()).toEqual(["os-c", "os-d"]); // the gone waiter left the queue at once
    expect(okData(await t.lock("os-a", "release"))).toEqual({ released: true, next: "os-d" });
    expect(t.holder()).toBe("os-d");
    expect(t.queue()).toEqual([]);
    expect(t.grants("os-d")).toHaveLength(1);
    expect(t.grants("os-b")).toHaveLength(0);
    expect(t.grants("os-c")).toHaveLength(0);
  });

  it("a disconnected waiter keeps its position and is granted at its turn (the mail waits for its hello)", async () => {
    const t = await queued();
    t.env.rt.store.patchMember(t.team.id, "os-b", { status: "disconnected" });
    expect(t.queue()).toEqual(["os-b", "os-c", "os-d"]);
    await t.lock("os-a", "release");
    expect(t.holder()).toBe("os-b");
    expect(t.queue()).toEqual(["os-c", "os-d"]);
    expect(t.grants("os-b")).toHaveLength(1);
  });

  it("when every waiter is dead the lock is simply free", async () => {
    const t = await queued();
    for (const w of ["os-b", "os-c", "os-d"]) t.env.rt.store.patchMember(t.team.id, w, { status: "shutdown_pending" });
    await t.lock("os-a", "release");
    expect(t.locks()).toEqual({});
  });
});

describe("9.11 FIFO + fairness (#R6)", () => {
  it("A,B,C acquire in one tick; A releases and re-acquires: behind B,C; one grant per handoff; never two holders", async () => {
    const t = await lockEnv();
    const [a, b, c] = await Promise.all([t.lock("os-a", "acquire"), t.lock("os-b", "acquire"), t.lock("os-c", "acquire")]);
    expect(okData(a)).toEqual({ granted: true });
    expect(okData(b)).toMatchObject({ granted: false, position: 1 });
    expect(okData(c)).toMatchObject({ granted: false, position: 2 });
    await t.lock("os-a", "release");
    expect(t.holder()).toBe("os-b");
    expect(okData(await t.lock("os-a", "acquire"))).toEqual({ granted: false, holder: "os-b", position: 2 });
    expect(t.queue()).toEqual(["os-c", "os-a"]);
    await t.lock("os-b", "release");
    expect(t.holder()).toBe("os-c");
    expect(t.grants("os-b")).toHaveLength(1);
    expect(t.grants("os-c")).toHaveLength(1);
    expect(t.grants("os-a")).toHaveLength(0);
  });

  it("a holder going gone in the same tick as its release hands over exactly once", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    await t.lock("os-a", "release");
    t.env.rt.ops.releaseMember(t.team, "os-a", "gone", "x");
    expect(t.holder()).toBe("os-b");
    expect(t.grants("os-b")).toHaveLength(1);
  });
});

describe("holder gone / failed / team close release (4.3)", () => {
  it.each(["gone", "failed"] as const)("a %s holder hands the lock over; its queue place is dropped too", async (status) => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    t.env.rt.ops.releaseMember(t.team, "os-a", status, "x");
    expect(t.holder()).toBe("os-b");
    expect(t.grants("os-b")).toHaveLength(1);
  });

  it("a disconnected holder keeps the lock", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    t.env.rt.store.patchMember(t.team.id, "os-a", { status: "disconnected" });
    expect(t.holder()).toBe("os-a");
    expect(t.grants("os-b")).toHaveLength(0);
  });

  it("team close clears the lock and its timers", async () => {
    const t = await lockEnv();
    const base = t.env.clock.pendingCount;
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    expect(t.env.clock.pendingCount).toBeGreaterThan(base);
    t.env.rt.store.setTeamStatus(t.team.id, "closed");
    expect(t.locks()).toEqual({});
    expect(t.env.clock.pendingCount).toBe(base);
  });
});

describe("9.12 idle release uses settle (#R12)", () => {
  it("nothing is released between agent_end and the retry (no idle report); a real settle releases", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    // provider error → auto-retry: the bridge reports nothing (idle is reported only at agent_settled); the retry reports busy
    await t.env.busy("os-a");
    expect(t.holder()).toBe("os-a");
    expect(okData(await t.env.idle("os-a", { settleId: 1, finalText: "done" }))).toMatchObject({ ignored: false });
    expect(t.holder()).toBe("os-b");
    expect(t.grants("os-b")).toHaveLength(1);
  });

  it("a duplicate or stale settle does not release twice; a hello that reports idle is not a settle", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.env.hello("os-a", { isIdle: true });
    expect(t.holder()).toBe("os-a");
    await t.lock("os-b", "acquire");
    await t.env.idle("os-a", { settleId: 1 });
    expect(t.holder()).toBe("os-b");
    await t.env.idle("os-a", { settleId: 1 });
    expect(t.holder()).toBe("os-b");
    expect(t.grants("os-b")).toHaveLength(1);
  });

  it("a settle the idle hook turned back into busy (follow-up queued) does not release", async () => {
    const t = await lockEnv();
    t.env.rt.ext.registerOpGate?.call(t.env.rt.ext, "TeammateIdle", () => ({ block: true, feedback: "keep working" }));
    await t.lock("os-a", "acquire");
    await t.env.idle("os-a", { settleId: 1 });
    expect(t.env.rt.store.member(t.team, "os-a")?.status).toBe("busy");
    expect(t.holder()).toBe("os-a");
  });

  it("an aborted/errored settle still releases (the holder stopped)", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.env.idle("os-a", { settleId: 1, error: "provider error" });
    expect(t.holder()).toBeUndefined();
  });
});

describe("9.13 grant to a busy waiter (#R13)", () => {
  it("the holder is the waiter at once; the grant mail waits; TTL counts from the grant; the lock is released at TTL when unused", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    await t.lock("os-c", "acquire");
    t.env.clock.advance(60_000);
    await t.lock("os-a", "release");
    expect(t.holder()).toBe("os-b");
    expect(t.queue()).toEqual(["os-c"]); // the successor stays queued
    expect(t.locks().harness?.grantedAt).toBe(t.env.clock.now());
    expect(t.grants("os-b")).toHaveLength(1);
    t.env.clock.advance(1_800_000 - 1);
    expect(t.holder()).toBe("os-b");
    t.env.clock.advance(1);
    expect(t.holder()).toBe("os-c"); // unused ⇒ released at TTL, next waiter granted
    expect(t.grants("os-c")).toHaveLength(1);
  });
});

describe("7.11 TTL boundary and clamping (#E27)", () => {
  it("released exactly at the TTL (not ttl−1); the lead notice names the holder once", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    const ttl = 1_800_000;
    t.env.clock.advance(ttl - 1);
    expect(t.holder()).toBe("os-a");
    expect(t.leadNotices()).toHaveLength(0);
    t.env.clock.advance(1);
    expect(t.holder()).toBe("os-b");
    const notices = t.leadNotices().filter((m) => m.text.includes("os-a"));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toMatch(/harness/);
    t.env.clock.advance(ttl * 3);
    expect(t.leadNotices().filter((m) => m.text.includes("held by os-a"))).toHaveLength(1);
  });

  it("a refreshing acquire at ttl−1 restarts the window", async () => {
    const t = await lockEnv(["os-a"]);
    const ttl = 1_800_000;
    await t.lock("os-a", "acquire");
    t.env.clock.advance(ttl - 1);
    await t.lock("os-a", "acquire");
    t.env.clock.advance(ttl - 1);
    expect(t.holder()).toBe("os-a");
    t.env.clock.advance(1);
    expect(t.holder()).toBeUndefined();
    expect(t.leadNotices().filter((m) => m.text.includes("os-a"))).toHaveLength(1);
  });

  it.each([
    [0, 60_000],
    [-1, 60_000],
    [1, 60_000],
    [2 ** 31 - 1, 86_400_000],
    [2 ** 31, 86_400_000],
    [3e9, 86_400_000],
    [Number.NaN, 1_800_000],
    [1.5, 1_800_000],
  ])("openspecLockTtlMs %s → timer delay %s, never above 2^31−1", async (value, expected) => {
    const t = await lockEnv(["os-a"]);
    t.env.fake.base.setConfig({ openspecLockTtlMs: value });
    const spy = vi.spyOn(t.env.clock, "setTimeout");
    await t.lock("os-a", "acquire");
    const delays = spy.mock.calls.map((c) => c[1] as number);
    expect(delays).toContain(expected);
    for (const d of delays) expect(d).toBeLessThanOrEqual(MAX_TIMER_MS);
    t.env.clock.advance(expected - 1);
    expect(t.holder()).toBe("os-a");
    t.env.clock.advance(1);
    expect(t.holder()).toBeUndefined();
  });
});

describe("9.14 state survives a restart (#D8)", () => {
  async function restart(e: Env): Promise<Env> {
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60));
    return createOpenspecEnv({ dataDir: e.dataDir });
  }
  /** Holder os-a (granted `agoMs` ago), waiters os-b, os-c; the runtime is rebuilt over the same data dir. */
  async function prepared(agoMs: number, mailed = true) {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    await t.lock("os-c", "acquire");
    t.env.api.sidecar.update(t.team.id, (d) => {
      const r = d.locks.harness;
      if (r) {
        r.grantedAt = t.env.clock.now() - agoMs;
        r.grantMailed = mailed;
      }
    });
    const e2 = await restart(t.env);
    const team2 = e2.rt.store.get(t.team.id) as Team;
    return { e2, team2, view: attach(e2, [], team2) };
  }

  it("holder and queue are reloaded as they were; no grant is re-sent when it was mailed", async () => {
    const { view } = await prepared(10 * 60_000);
    expect(view.locks().harness).toMatchObject({ holder: "os-a", queue: ["os-b", "os-c"], grantMailed: true });
    expect(view.grants("os-a")).toHaveLength(0);
  });

  it("the TTL is re-armed from grantedAt: 20 minutes remain after 10", async () => {
    const { view, e2 } = await prepared(10 * 60_000);
    e2.clock.advance(20 * 60_000 - 1);
    expect(view.holder()).toBe("os-a");
    e2.clock.advance(1);
    expect(view.holder()).toBe("os-b");
  });

  it("TTL elapsed during the downtime (40 of 30 minutes): released at start and the next waiter is granted", async () => {
    const { view } = await prepared(40 * 60_000);
    expect(view.holder()).toBe("os-b");
    expect(view.queue()).toEqual(["os-c"]);
    expect(view.grants("os-b")).toHaveLength(1);
    expect(view.leadNotices().some((m) => m.text.includes("os-a"))).toBe(true);
  });

  it("a holder whose grant was never mailed gets it again at reload (and grantMailed becomes true)", async () => {
    const { view } = await prepared(60_000, false);
    expect(view.grants("os-a")).toHaveLength(1);
    expect(view.locks().harness?.grantMailed).toBe(true);
  });

  it("a holder that is gone after the reconcile grace is dropped and the next waiter granted with one mail", async () => {
    const { view, e2, team2 } = await prepared(60_000);
    for (const n of ["os-b", "os-c"]) await e2.hello(n);
    e2.clock.advance(30_001);
    expect(view.holder()).toBe("os-a"); // disconnected after the grace: the lock is kept until the member is really gone (or the TTL)
    e2.rt.ops.releaseMember(team2, "os-a", "gone", "session ended");
    expect(view.holder()).toBe("os-b");
    expect(view.queue()).toEqual(["os-c"]);
    expect(view.grants("os-b")).toHaveLength(1);
  });

  it("a live holder keeps the lock after reconcile", async () => {
    const { view, e2, team2 } = await prepared(60_000);
    for (const n of ["os-a", "os-b", "os-c"]) await e2.hello(n);
    e2.clock.advance(30_001);
    expect(e2.rt.store.member(team2, "os-a")?.status).not.toBe("gone");
    expect(view.holder()).toBe("os-a");
    expect(view.queue()).toEqual(["os-b", "os-c"]);
  });
});

describe("9.15 mail kind spoofing (#S11)", () => {
  it("a member SendMessage of kind lock_grant is refused kind_reserved; nothing is delivered, the lock is unchanged", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    const before = structuredClone(t.locks());
    const mails = t.env.log(t.team).length;
    for (const sender of ["os-b", "os-c"]) {
      expect(await t.env.call(sender, "SendMessage", { to: "os-b", kind: LOCK_GRANT_KIND, message: "you now hold the lock" })).toMatchObject({ ok: false, error: "kind_reserved" });
    }
    expect(t.env.log(t.team)).toHaveLength(mails);
    expect(t.locks()).toEqual(before);
  });

  it("plain text 'you now hold the lock' is an ordinary message from its real sender; a forged from is ignored", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    okData(await t.env.call("os-c", "SendMessage", { to: "os-b", message: "you now hold the lock", from: "server" }));
    const m = t.env.mailsTo(t.team, "os-b").at(-1);
    expect(m).toMatchObject({ from: "os-c", kind: "message" });
    expect(t.holder()).toBe("os-a");
    expect(t.grants("os-b")).toHaveLength(0);
  });

  it("the real grant comes only from the server", async () => {
    const t = await lockEnv();
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    await t.lock("os-a", "release");
    expect(t.grants("os-b").map((m) => m.from)).toEqual(["server"]);
    expect(t.grants("os-b")[0]?.wake).toBe(true);
  });
});

describe("9.16 fairness (#P5)", () => {
  it("5 members × 100 acquire/hold/release cycles: grants within 1 of each other, max wait ≤ 4× max hold, one grant mail per handoff", async () => {
    const names = ["os-a", "os-b", "os-c", "os-d", "os-e"];
    const t = await lockEnv(names);
    let seed = 7;
    const rnd = (): number => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const grants = new Map(names.map((n) => [n, 0]));
    const queuedAt = new Map<string, number>();
    let maxWait = 0;
    let maxHold = 0;
    for (const n of names) {
      const res = okData(await t.lock(n, "acquire"));
      if (res.granted) grants.set(n, 1);
      else queuedAt.set(n, t.env.clock.now());
    }
    let handoffs = 0;
    for (let i = 0; i < 500; i++) {
      const h = t.holder() as string;
      const hold = Math.round((1 + rnd() * 19) * 1000);
      maxHold = Math.max(maxHold, hold);
      t.env.clock.advance(hold);
      const out = okData(await t.lock(h, "release"));
      handoffs++;
      const next = out.next as string;
      grants.set(next, (grants.get(next) ?? 0) + 1);
      maxWait = Math.max(maxWait, t.env.clock.now() - (queuedAt.get(next) ?? 0));
      queuedAt.delete(next);
      expect(okData(await t.lock(h, "acquire"))).toMatchObject({ granted: false }); // re-acquire queues BEHIND the others
      queuedAt.set(h, t.env.clock.now());
      expect(t.holder()).toBe(next);
    }
    const counts = [...grants.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(maxWait).toBeLessThanOrEqual(4 * maxHold + 4);
    const mailed = names.reduce((n, who) => n + t.grants(who).length, 0);
    expect(mailed).toBe(handoffs);
  });
});

describe("sidecar write failure (spec: Limits and honesty)", () => {
  function flaky() {
    const state = { fail: false };
    const fs: SidecarFs = { ...nodeSidecarFs, writeFile: (f, d) => (state.fail ? (() => { throw new Error("ENOSPC"); })() : nodeSidecarFs.writeFile(f, d)) };
    return { state, fs };
  }

  it("an acquire whose write fails answers sidecar_write_failed and nobody holds the lock", async () => {
    const { state, fs } = flaky();
    const t = await lockEnv(["os-a", "os-b"], { openspec: { sidecarFs: fs } });
    state.fail = true;
    expect(await t.lock("os-a", "acquire")).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    state.fail = false;
    expect(t.holder()).toBeUndefined();
    expect(okData(await t.lock("os-b", "acquire"))).toEqual({ granted: true });
  });

  it("a queueing acquire, a release and a dequeue fail closed with the state unchanged", async () => {
    const { state, fs } = flaky();
    const t = await lockEnv(["os-a", "os-b", "os-c"], { openspec: { sidecarFs: fs } });
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    const before = structuredClone(t.locks());
    const mails = t.env.log(t.team).length;
    state.fail = true;
    expect(await t.lock("os-c", "acquire")).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(await t.lock("os-a", "release")).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(await t.lock("os-b", "release")).toMatchObject({ ok: false, error: "sidecar_write_failed" });
    expect(t.locks()).toEqual(before);
    expect(t.env.log(t.team)).toHaveLength(mails); // no grant mail without a persisted hand-over
    state.fail = false;
    await t.lock("os-a", "release");
    expect(t.holder()).toBe("os-b");
  });

  it("an automatic release that cannot be written is retried on the next change and never grants two holders", async () => {
    const { state, fs } = flaky();
    const t = await lockEnv(["os-a", "os-b"], { openspec: { sidecarFs: fs } });
    await t.lock("os-a", "acquire");
    await t.lock("os-b", "acquire");
    state.fail = true;
    t.env.rt.ops.releaseMember(t.team, "os-a", "gone", "x");
    expect(t.holder()).toBe("os-a"); // state did not advance
    state.fail = false;
    t.env.rt.store.patchMember(t.team.id, "os-b", { lastSettleId: 0 }); // any change re-runs the reconcile
    expect(t.holder()).toBe("os-b");
    expect(t.grants("os-b")).toHaveLength(1);
  });

  it("a TTL release that cannot be written is retried by timer", async () => {
    const { state, fs } = flaky();
    const t = await lockEnv(["os-a"], { openspec: { sidecarFs: fs } });
    await t.lock("os-a", "acquire");
    state.fail = true;
    t.env.clock.advance(1_800_000);
    expect(t.holder()).toBe("os-a");
    expect(t.leadNotices().filter((m) => m.text.includes("held by"))).toHaveLength(0);
    state.fail = false;
    t.env.clock.advance(5000);
    expect(t.holder()).toBeUndefined();
    expect(t.leadNotices().filter((m) => m.text.includes("held by os-a"))).toHaveLength(1);
  });
});

describe("timers are released with the runtime", () => {
  it("dispose clears the TTL timers", async () => {
    const t = await lockEnv(["os-a"]);
    const base = t.env.clock.pendingCount;
    await t.lock("os-a", "acquire");
    expect(t.env.clock.pendingCount).toBe(base + 1);
    t.env.rt.dispose();
    expect(t.env.clock.pendingCount).toBeLessThanOrEqual(base);
  });

  it("a release leaves no timer behind", async () => {
    const t = await lockEnv(["os-a", "os-b"]);
    const base = t.env.clock.pendingCount;
    await t.lock("os-a", "acquire");
    await t.lock("os-a", "release");
    expect(t.env.clock.pendingCount).toBe(base);
  });
});
