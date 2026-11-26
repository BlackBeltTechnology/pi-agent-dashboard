/**
 * Full server runtime over the fake host for the behaviour suites (tasks,
 * messaging, mail-rate, perf): real store + persistence + ops + lane + the REAL
 * mail engine (no `mailer` spy), an injected `FakeClock`, and helpers that act
 * through the request lane exactly as the host would. `as("alice")` addresses a
 * teammate by name, `"lead"` the lead session.
 * See change: add-agent-teams-core.
 */

import { createExtensionPoints, type ExtensionPoints } from "../../server/extension-points.js";
import { createTeamsRuntime, type RuntimeOptions } from "../../server/runtime.js";
import type { Mail, Member, MemberStatus, Team } from "../../shared/types.js";
import { FakeClock } from "./fake-clock.js";
import type { RecordedEmit } from "./fake-host-ctx.js";
import { createFakeRuntimeHost, type FakeRuntimeHostOptions } from "./fake-runtime-host.js";
import { memberFixture } from "./store-env.js";

export interface TeamsEnvOptions extends FakeRuntimeHostOptions {
  ext?: ExtensionPoints;
  runtime?: RuntimeOptions;
}

export function createTeamsEnv(over: TeamsEnvOptions = {}) {
  const clock = new FakeClock(1_700_000_000_000);
  const { ext, runtime, ...hostOpts } = over;
  const fake = createFakeRuntimeHost(hostOpts);
  let n = 0;
  let tok = 0;
  const rt = createTeamsRuntime(fake.host, {
    clock,
    ext: ext ?? createExtensionPoints(),
    idFactory: () => `t_${String(++n).padStart(8, "0")}`,
    newToken: () => `tok-${++tok}`,
    ...(runtime ?? {}),
  });
  const lead = fake.addSession("S-lead", { cwd: "/work", principalOwner: "owner-1" });

  const sid = (who: string): string => (who === "lead" ? lead : `S-${who}`);

  const env = {
    clock,
    fake,
    rt,
    lead,
    sid,
    /** Create a team led by the lead session through the lane (`TeamCreate`). */
    async createTeam(name = "alpha"): Promise<Team> {
      const res = await fake.call(lead, "TeamCreate", { name });
      if (!res.ok) throw new Error(`TeamCreate failed: ${res.error}`);
      return rt.store.get(res.data.teamId) as Team;
    },
    /** A live teammate with its own connected host session. */
    addMember(team: Team, name: string, status: MemberStatus = "idle", extra: Partial<Member> = {}): string {
      const sessionId = fake.addSession(sid(name), { cwd: "/work" });
      rt.store.reserveMember(team.id, memberFixture(name, { sessionId, status, ...extra }) as Member);
      return sessionId;
    },
    call(who: string, op: string, args?: unknown) {
      return fake.call(sid(who), op, args);
    },
    busy(who: string) {
      return fake.lane(sid(who), "agent-teams/busy", {});
    },
    idle(who: string, payload: Record<string, unknown>) {
      return fake.lane(sid(who), "agent-teams/idle", payload);
    },
    hello(who: string, over2: Record<string, unknown> = {}) {
      return fake.lane(sid(who), "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false, ...over2 });
    },
    ack(who: string, ids: number[]) {
      return fake.lane(sid(who), "agent-teams/ack", { ids });
    },
    member(team: Team, name: string): Member {
      return rt.store.member(team, name) as Member;
    },
    /** Mail-event emits to one session, flattened to wire mails in emit order. */
    wireMails(who: string): Array<{ id: number; kind: string; from: string; wake: boolean; text: string; priority: string; details?: unknown }> {
      return fake.base.emits
        .filter((e: RecordedEmit) => e.sessionId === sid(who) && e.eventType === "agent-teams:mail")
        .flatMap((e: RecordedEmit) => (e.data as { mails: never[] }).mails);
    },
    emitCount(who: string): number {
      return fake.base.emits.filter((e: RecordedEmit) => e.sessionId === sid(who) && e.eventType === "agent-teams:mail").length;
    },
    log(team: Team): readonly Mail[] {
      return rt.store.mailLog(team.id);
    },
    mailsTo(team: Team, to: string): Mail[] {
      return rt.store.mailLog(team.id).filter((m) => m.to === to);
    },
    /** Let pending promise continuations (driver `shutdown`, async starters) run. */
    async settle(): Promise<void> {
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Advance past the lead-notice coalescing window (default 2000 ms). */
    flushNotices(ms = 2000): void {
      clock.advance(ms);
    },
  };
  return env;
}

export type TeamsEnv = ReturnType<typeof createTeamsEnv>;
