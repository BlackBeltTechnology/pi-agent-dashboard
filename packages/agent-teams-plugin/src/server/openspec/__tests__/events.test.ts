/**
 * Mail and notice delivery as a model experiences it (tasks 8.26 #R10, 8.27 #R11; spike findings): a teammate
 * turn receives several mails together and a policy that reads ALL mail since its last reply (not only the
 * last) releases the lock and answers the shutdown exactly once; the lead sees every notice exactly once
 * and is woken at most once per `notify.coalesceMs` window by idle reports, never by approvals, and by a
 * rejection, a launch failure or a member death. Real runtime, real mail engine, `FakeClock`; the "faux"
 * sessions are policies over the recorded mail, not a model.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it } from "vitest";
import type { Team } from "../../../shared/types.js";
import { LOCK_GRANT_KIND } from "../lock.js";
import { createOpenspecEnv } from "./env.js";
import { createGroupEnv, type GroupEnv } from "./launcher-env.js";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const LEAD = "S-lead-grp";

/** Wake-carrying mail emits delivered to a session (one emit = one steer = one turn of that session). */
const turns = (e: { fake: GroupEnv["fake"] }, session: string): number =>
  e.fake.base.emits.filter((x) => x.sessionId === session && x.eventType === "agent-teams:mail" && (x.data as { mails: Array<{ wake: boolean }> }).mails.some((m) => m.wake)).length;

describe("batched mails in one turn (8.26 #R10)", () => {
  /** os-a holds the lock, os-b is queued, os-c is a bystander; os-b is BUSY while three mails pile up for it. */
  async function pile() {
    const e = await createOpenspecEnv();
    const team = e.team("group", "g", { seeded: true });
    e.rt.store.bindLead(team.id, e.lead); // `e.call("lead", …)` is this session
    e.api.sidecar.create({ teamId: team.id, kind: "group", goal: "g", repo: e.cwd }, (d) => void (d.seeded = true));
    for (const n of ["os-a", "os-b", "os-c"]) e.addMember(team, n, "busy");
    const lock = (who: string, action: string) => e.call(who, "ResourceLock", { action, name: "harness" }) as Promise<{ ok: boolean; data?: unknown }>;
    await lock("os-a", "acquire");
    await lock("os-b", "acquire"); // queued behind os-a
    await lock("os-c", "acquire"); // and os-c behind os-b
    // the three mails of the spike: a task mail, the lock grant, a shutdown request
    const sent = await e.call("lead", "SendMessage", { to: "os-b", message: "please also look at the flaky test" });
    expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true });
    await lock("os-a", "release"); // synchronous hand-over: os-b holds the lock, lock_grant is mailed
    expect(e.rt.ops.requestShutdown(team, "os-b", { actor: "server", reason: "change shipped" }).ok).toBe(true);
    return { e, team, lock };
  }

  /** The faux teammate policy: read ALL unacknowledged mail, react to each kind, acknowledge. */
  async function turn(e: Awaited<ReturnType<typeof pile>>["e"], team: Team, who: string, readAll = true) {
    const all = e.rt.store.pendingMail(team.id, who);
    const read = readAll ? all : all.slice(-1);
    const seen: string[] = [];
    const answers: Array<{ ok: boolean }> = [];
    for (const m of read) {
      seen.push(m.kind);
      if (m.kind === LOCK_GRANT_KIND) await e.call(who, "ResourceLock", { action: "release", name: "harness" });
      if (m.kind === "shutdown_request") answers.push(await e.call(who, "ShutdownResponse", { approve: true }));
    }
    await e.ack(who, read.map((m) => m.id));
    return { seen, all, answers };
  }

  it("the teammate receives all three mails together, once each, in order; a policy reading ALL of them releases the lock and answers the shutdown exactly once", async () => {
    const { e, team } = await pile();
    const { seen, all, answers } = await turn(e, team, "os-b");
    expect(all.map((m) => m.kind)).toEqual(["message", LOCK_GRANT_KIND, "shutdown_request"]);
    expect(new Set(all.map((m) => m.id)).size).toBe(3); // none duplicated
    expect(seen).toEqual(["message", LOCK_GRANT_KIND, "shutdown_request"]);
    const locks = e.api.sidecar.get(team.id)?.locks.harness;
    expect(locks?.holder).toBe("os-c"); // released ⇒ handed to the next waiter, not stuck
    expect(e.mailsTo(team, "os-c").filter((m) => m.kind === LOCK_GRANT_KIND)).toHaveLength(1);
    e.flushNotices(10_000);
    expect(answers).toHaveLength(1); // the shutdown request is answered exactly once
    expect(answers[0]).toMatchObject({ ok: true });
    expect(e.mailsTo(team, "lead").filter((m) => m.wake)).toHaveLength(0); // an approval of a server request wakes nobody
    expect(e.rt.store.pendingMail(team.id, "os-b")).toHaveLength(0); // acknowledged, nothing left to redeliver
  });

  it("the first spike policy (reading only the LAST mail) is exactly what loses the lock: the lock stays held by a member that is shutting down", async () => {
    const { e, team } = await pile();
    const { seen } = await turn(e, team, "os-b", false);
    expect(seen).toEqual(["shutdown_request"]);
    expect(e.api.sidecar.get(team.id)?.locks.harness?.holder).toBe("os-b"); // never released by the policy
    // the server still lets go once the member is gone (settled-idle / gone release), so the hole is bounded
    e.rt.ops.releaseMember(team, "os-b", "gone", "session ended");
    await settle();
    expect(e.api.sidecar.get(team.id)?.locks.harness?.holder).toBe("os-c");
  });

  it("a faux lead receives [idle report, launch_failed, sync notice] in one coalesced notice: every item once, none dropped", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], overrides: { autoDispatch: false, notifyCoalesceMs: 2000 }, pluginConfig: { openspecGroupParallel: 2 } });
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => (i.change === "b" ? { ok: false, code: "git_failed" } : { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` }));
    await e.run(); // a launches, b fails: the launch_failed notice
    e.fake.addSession("S-os-a", { cwd: e.worktreeOf("a") });
    e.rt.store.patchMember(e.gteam.id, "os-a", { sessionId: "S-os-a", status: "busy" });
    const team = e.rt.store.get(e.gteam.id) as Team;
    await e.idle("os-a", { settleId: 1, finalText: "done with the first part" }); // the idle report item
    e.rt.ops.enqueueLeadNotice(team, { text: "OpenSpec checkbox sync was refused (sync_forbidden) for task #9: tick 1.1 by hand.", wake: true }); // the sync notice
    e.clock.advance(2000);
    await settle();
    const mails = e.rt.store.mailLog(e.gteam.id).filter((m) => m.to === "lead" && m.kind === "notice");
    const text = mails.map((m) => m.text).join("\n");
    expect(text.match(/git_failed/g)).toHaveLength(1);
    expect(text.match(/sync_forbidden/g)).toHaveLength(1);
    expect(text).toMatch(/os-a/); // the idle report
    expect(mails.some((m) => m.wake)).toBe(true);
  });
});

describe("lead notices coalesced (8.27 #R11)", () => {
  const WINDOW = 10_000;
  /** Three launched members with live sessions; the lead session counts turns. */
  async function trio() {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], overrides: { autoDispatch: false, notifyCoalesceMs: WINDOW }, pluginConfig: { openspecGroupParallel: 3, shutdownGraceMs: 120_000 } });
    await e.run();
    for (const c of ["a", "b", "c"]) {
      e.fake.addSession(`S-os-${c}`, { cwd: e.worktreeOf(c) });
      e.rt.store.patchMember(e.gteam.id, `os-${c}`, { sessionId: `S-os-${c}`, status: "busy" });
    }
    return e;
  }
  /** One teammate finishes: idle report, the task completes, the server asks it to shut down, `approve` answers. */
  async function finish(e: GroupEnv, c: string, approve: boolean) {
    await e.idle(`os-${c}`, { settleId: 1, finalText: `${c} shipped` });
    e.complete(c);
    await settle();
    await e.call(`os-${c}`, "ShutdownResponse", approve ? { approve: true } : { approve: false, reason: "still pushing" });
  }

  it("3 teammates complete within 4 s and each approves: at most ONE lead turn in the 10 s window, and no wake at all for the approvals", async () => {
    const e = await trio();
    const base = turns(e, LEAD);
    await finish(e, "a", true);
    e.clock.advance(2000);
    await finish(e, "b", true);
    e.clock.advance(2000);
    await finish(e, "c", true);
    e.clock.advance(WINDOW - 4000 - 1);
    expect(turns(e, LEAD) - base).toBe(0); // the window has not closed yet: nothing delivered
    e.clock.advance(1);
    await settle();
    expect(turns(e, LEAD) - base).toBeLessThanOrEqual(1); // spike: 3 extra "TEAM DONE" turns; now at most one for the whole window
    const batch = e.rt.store.mailLog(e.gteam.id).filter((m) => m.to === "lead" && m.kind === "notice" && m.text.includes("os-"));
    expect(batch).toHaveLength(1); // the three idle reports travelled as ONE mail
    expect(batch[0]?.wake).toBe(false); // members that picked up work report idle without waking the lead
    // nothing after the window either: approvals never wake
    const after = turns(e, LEAD);
    e.clock.advance(5 * WINDOW);
    await settle();
    expect(turns(e, LEAD)).toBe(after);
  });

  it("then one rejection wakes the lead (within its window, once); a launch failure and a member death wake it too", async () => {
    const e = await trio();
    await finish(e, "a", true);
    e.clock.advance(WINDOW);
    await settle();
    const base = turns(e, LEAD);
    // rejection
    e.complete("b");
    await settle();
    await e.call("os-b", "ShutdownResponse", { approve: false, reason: "still pushing" });
    e.clock.advance(WINDOW);
    await settle();
    expect(turns(e, LEAD) - base).toBe(1);
    // member death
    const before = turns(e, LEAD);
    e.rt.ops.releaseMember(e.rt.store.get(e.gteam.id) as Team, "os-c", "gone", "session ended");
    e.clock.advance(WINDOW);
    await settle();
    expect(turns(e, LEAD) - before).toBe(1);
  });

  it("a failed launch wakes the lead: one turn, delivered no later than the window closes, with the code in it", async () => {
    const e = await createGroupEnv({ changes: ["a"], overrides: { autoDispatch: false, notifyCoalesceMs: WINDOW } });
    e.fx.ensureWorktree.mockResolvedValue({ ok: false, code: "git_failed" });
    const base = turns(e, LEAD);
    await e.run();
    await settle();
    e.clock.advance(WINDOW);
    await settle();
    expect(turns(e, LEAD) - base).toBe(1);
    expect(e.notices().filter((n) => n.wake && n.text.includes("git_failed"))).toHaveLength(1);
  });
});
