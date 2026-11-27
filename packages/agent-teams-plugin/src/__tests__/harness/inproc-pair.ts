/**
 * The REAL in-process server driver wired to the REAL lead-side host over the recorded subagents contract double:
 * commands the driver emits go onto the host's bus (`agent-teams:inproc`), and everything the host sends on the lane goes through
 * the REAL `agent-teams/inproc` lane handler (`hello`, `ack`). `event` reports are recorded (the server's lifecycle intake is a
 * later task) and accepted. One `FakeClock` drives both sides. No pi, no sockets, no real timers.
 * See change: add-agent-teams-in-process.
 */

import type { ReportResult } from "../../bridge/inproc-outbox.js";
import type { TeamsConfig } from "../../server/config.js";
import { createInProcDriver, type InProcDriver, type InProcDriverDeps } from "../../server/driver-inproc.js";
import { createInProcAvailability, createInProcLane, type InProcAvailability } from "../../server/modes-inproc.js";
import { createPluginCounters } from "../../server/templates-hooks.js";
import type { InProcAck, InProcCommand, InProcEvent } from "../../shared/inproc-protocol.js";
import { LANE_INPROC } from "../../shared/inproc-protocol.js";
import type { Member, Team } from "../../shared/types.js";
import { FakeClock } from "./fake-clock.js";
import { createHostEnv, type HostEnv, type HostEnvOptions, type LanePayload } from "./inproc-host-env.js";
import { capturingLogger, createStoreEnv, memberFixture, type StoreEnvOptions } from "./store-env.js";

export interface PairOptions {
  config?: Partial<TeamsConfig>;
  host?: Omit<HostEnvOptions, "clock" | "send">;
  /** Extra / overriding driver deps (e.g. `unhandMail`). */
  driver?: Partial<InProcDriverDeps>;
  /** Store options (e.g. `maxMailLogBytes` for a flood that must not trigger the mail-log compaction). */
  store?: Omit<StoreEnvOptions, "clock">;
}

export function createInProcPair(opts: PairOptions = {}) {
  const clock = new FakeClock(1_000);
  const store = createStoreEnv({ clock, ...(opts.store ?? {}) }).store;
  const { logger, logs } = capturingLogger();
  const counters = createPluginCounters();
  const availability: InProcAvailability = createInProcAvailability(clock);
  const connected = new Set<string>(["S-lead"]);
  const emitted: Array<Record<string, unknown>> = [];
  const state = { accept: true };
  /** `op:"event"` reports the host sent (the server intake is a later task). */
  const reports: InProcEvent[] = [];
  /** Reports the lane answers with an application error (head-of-line tests). */
  const reportError: { next?: (r: InProcEvent) => string | undefined } = {};
  /** Acks the host sends wait this long on the fake clock before reaching the server (a slow lane); `gate` holds them until released. */
  const lag: { ackDelayMs: number; gate?: Promise<void> } = { ackDelayMs: 0 };
  const failed: Array<{ member: string; message: string }> = [];
  const gone: Array<{ member: string; reason: string }> = [];
  const unhanded: string[] = [];
  const flushed: string[] = [];

  let driver!: InProcDriver;
  const lanes = (): Record<string, (payload: unknown, meta: { sessionId: string; origin?: { local?: boolean } }) => unknown> =>
    createInProcLane({
      ops: { resolveCaller: () => ({ role: "plain" }) as never, releaseMember: () => undefined, teamDelete: () => undefined } as never,
      ext: { seal: () => undefined },
      store,
      driver,
      availability,
      counters,
      logger,
    }) as never;
  let lane: ReturnType<typeof lanes>;

  /** An ack the host sends waits on the fake clock (`ackDelayMs`) and on `gate` before it reaches the server. */
  const lagAck = async (): Promise<void> => {
    if (lag.ackDelayMs > 0) await new Promise<void>((resolve) => clock.setTimeout(resolve, lag.ackDelayMs));
    const gate = lag.gate;
    if (gate !== undefined) await gate;
  };

  /** `op:"event"` reports are recorded (the server intake is a later task) unless `reportError` refuses one. */
  const takeReport = (ev: InProcEvent): ReportResult => {
    const error = reportError.next?.(ev);
    if (error) return { ok: false, transport: false, error };
    reports.push(ev);
    return { ok: true };
  };

  const hostEnv: HostEnv = createHostEnv({
    ...opts.host,
    clock,
    send: async (payload: LanePayload) => {
      if (payload.op === "event") return takeReport(payload as unknown as InProcEvent);
      if (payload.op === "ack") await lagAck();
      const res = (await lane[LANE_INPROC]?.(payload, { sessionId: "S-lead", origin: { local: true } })) as { ok: boolean; error?: string } | undefined;
      return res?.ok ? { ok: true } : { ok: false, transport: false, ...(res?.error ? { error: res.error } : {}) };
    },
  });

  driver = createInProcDriver({
    store,
    clock,
    logger,
    counters,
    availability,
    config: () => ({ inProcessCmdTimeoutMs: 10_000, inProcessLeanChildren: false, spawnTimeoutMs: 60_000, ...opts.config }) as TeamsConfig,
    emit: (_sessionId, data) => {
      emitted.push(data);
      if (state.accept) hostEnv.bus.emit("agent-teams:inproc", data);
      return state.accept;
    },
    isConnected: (id) => connected.has(id),
    failMember: (_teamId, member, message) => void failed.push({ member, message }),
    goneMember: (_teamId, member, reason) => void gone.push({ member, reason }),
    unhandMail: (_teamId, member) => void unhanded.push(member),
    flushMail: (_teamId, member) => void flushed.push(member),
    newCmdId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
    newToken: (() => {
      let n = 0;
      return () => `${String(++n).padStart(64, "0")}`;
    })(),
    ...opts.driver,
  });
  lane = lanes();

  const team: Team = store.createTeam({ name: "t", leadSessionId: "S-lead", leadCwd: "/w", mode: "in-process", maxTeammates: 10 });
  const spec = { cwd: "/w", noMcp: false, noContextFiles: false, promptFiles: ["/p/protocol.md"], env: { K: "v" }, tools: ["read", "TaskList"] };

  const pair = {
    clock,
    store,
    team,
    driver,
    availability,
    counters,
    logs,
    connected,
    emitted,
    state,
    reports,
    reportError,
    lag,
    /** Hold every ack the host sends until the returned function is called. */
    holdAcks(): () => void {
      let release!: () => void;
      lag.gate = new Promise<void>((resolve) => {
        release = () => {
          lag.gate = undefined;
          resolve();
        };
      });
      return release;
    },
    failed,
    gone,
    unhanded,
    flushed,
    host: hostEnv,
    lane: () => lane,
    /** Commands the driver emitted, in order. */
    cmds: (): InProcCommand[] => emitted as unknown as InProcCommand[],
    /** Reserve a `spawning` member (optionally with its own fields). */
    reserve(name: string, over: Partial<Member> = {}): Member {
      return store.reserveMember(team.id, memberFixture(name, { status: "spawning", ...over }) as Member) as Member;
    },
    spawnReq(name: string) {
      return { teamId: team.id, teamName: "t", member: name, role: "member", spawnToken: `st-${name}`, spec };
    },
    /** `driver.spawn` for an already reserved member. */
    spawn: (name: string) => driver.spawn(pair.spawnReq(name)),
    /** Host `session_start` (probe + hello) and let everything settle. */
    async start(): Promise<void> {
      await hostEnv.start();
    },
    /** Let the async hop host ↔ lane ↔ driver run (promise turns only: the fake clock does not move). */
    settle: () => hostEnv.settle(),
    member: (name: string): Member | undefined => store.member(store.get(team.id) as Team, name),
    ack: (cmdId: string, over: Partial<InProcAck> = {}) => driver.onAck("S-lead", { op: "ack", cmdId, ok: true, ...over }),
  };
  return pair;
}

export type InProcPair = ReturnType<typeof createInProcPair>;
