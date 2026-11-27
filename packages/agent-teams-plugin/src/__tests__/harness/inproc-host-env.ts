/**
 * Test environment of the lead-side in-process HOST (`bridge/inproc-host.ts`): a double event bus carrying the recorded
 * subagents contract double (`subagents-double.ts`), a `FakeClock`, and a recording lane sender in place of
 * `requestPluginServer`. Tests drive the host exactly as the server would — by emitting `agent-teams:inproc` commands with the
 * activation's secret — and read what it answered (`acks`), reported (`events`, `hellos`) and counted.
 * See change: add-agent-teams-in-process.
 */
import { createInProcHost, type InProcHost, type InProcHostDeps, type ReportResult } from "../../bridge/inproc-host.js";
import type { InProcAck, InProcEvent, InProcHelloPayload, InProcSnapshot } from "../../shared/inproc-protocol.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../../shared/plugin-id.js";
import { FakeClock } from "./fake-clock.js";
import { createDoubleBus, type DoubleBus, type DoubleOptions, installSubagentsDouble, type SubagentsDouble } from "./subagents-double.js";

export type LanePayload = Record<string, unknown>;

export interface HostEnvOptions {
  clock?: FakeClock;
  double?: Partial<Omit<DoubleOptions, "clock">> | false;
  /** Answer of every lane request (default accepted). May return a promise (a slow lane). */
  send?: (payload: LanePayload) => ReportResult | Promise<ReportResult>;
  childExtension?: InProcHostDeps["childExtension"];
  /** Further host deps (`leadCwd`, `readFile`, `cwdDeps`, `onPlanDecision`, …). */
  hostDeps?: Partial<Omit<InProcHostDeps, "bus" | "clock" | "send">>;
  secret?: string;
  incarnation?: string;
}

export interface HostEnv {
  readonly bus: DoubleBus;
  readonly clock: FakeClock;
  readonly double: SubagentsDouble;
  readonly host: InProcHost;
  readonly secret: string;
  /** Every lane request the host made, in order. */
  readonly sent: LanePayload[];
  /** Log lines of the host (ids and sizes only: tests assert no payload text appears here). */
  readonly logs: string[];
  readonly acks: () => InProcAck[];
  readonly events: () => InProcEvent[];
  readonly hellos: () => InProcHelloPayload[];
  setSend(fn: NonNullable<HostEnvOptions["send"]>): void;
  /** Emit one `agent-teams:inproc` command with this activation's secret (override with `secret`). */
  command(cmd: Record<string, unknown>, secret?: string | null): void;
  /** Start the host (`session_start`) and let the probe + hello settle. */
  start(): Promise<void>;
  /** Let queued microtasks and the host's fire-and-forget lane work finish. */
  settle(): Promise<void>;
  /** `spawn` command for `member`, acked; returns the ack. */
  spawn(member?: string, over?: Record<string, unknown>): Promise<InProcAck>;
  ackOf(cmdId: string): InProcAck | undefined;
  snapshot(): InProcSnapshot;
}

export async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** A valid `spawn` command for `member` (override any field). */
export function spawnCommand(member = "bob", over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cmd: "spawn",
    cmdId: `spawn:t1:${member}:1`,
    teamId: "t1",
    member,
    prompt: "do the thing",
    proxyToken: "tok-secret",
    spec: { cwd: "/work", tools: ["read", "SendMessage"], noMcp: true, noContextFiles: true, promptFiles: ["/p/protocol.md"], env: {}, leanChildren: false },
    ...over,
  };
}

/** A valid `steer` command (blocks aligned with ids). */
export function steerCommand(member: string, ids: number[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cmd: "steer",
    cmdId: `steer:${member}:${[...ids].sort((a, b) => a - b).join("-")}`,
    member,
    mailIds: ids,
    blocks: ids.map((id) => `[agent-teams · message · from lead · peer message]\n[agent-teams · mail id ${id}]\n│ body ${id}`),
    ...over,
  };
}

export function createHostEnv(opts: HostEnvOptions = {}): HostEnv {
  const clock = opts.clock ?? new FakeClock();
  const bus = createDoubleBus();
  const double = installSubagentsDouble(bus, { clock, ...(opts.double || {}) });
  if (opts.double === false) double.uninstall();
  const sent: LanePayload[] = [];
  const logs: string[] = [];
  let sendFn: NonNullable<HostEnvOptions["send"]> = opts.send ?? (() => ({ ok: true }));
  const host = createInProcHost({
    bus,
    clock,
    send: async (payload) => {
      sent.push(payload);
      return sendFn(payload);
    },
    log: (m) => void logs.push(m),
    ...(opts.childExtension ? { childExtension: opts.childExtension } : {}),
    // The fixture prompt files do not exist on disk: reads succeed unless a test injects its own `readFile`.
    readFile: async () => new Uint8Array(),
    ...(opts.hostDeps ?? {}),
    newIncarnation: () => opts.incarnation ?? "inc-host-1",
    newSecret: () => opts.secret ?? "secret-host-1",
  });
  const secret = host.commandSecret;
  const acks = (): InProcAck[] => sent.filter((p) => p.op === "ack") as unknown as InProcAck[];
  const env: HostEnv = {
    bus,
    clock,
    double,
    host,
    secret,
    sent,
    logs,
    acks,
    events: () => sent.filter((p) => p.op === "event") as unknown as InProcEvent[],
    hellos: () => sent.filter((p) => p.op === "hello") as unknown as InProcHelloPayload[],
    setSend(fn) {
      sendFn = fn;
    },
    command(cmd, withSecret) {
      bus.emit(AGENT_TEAMS_EVENT_INPROC, withSecret === null ? { ...cmd } : { ...cmd, secret: withSecret ?? secret });
    },
    async start() {
      host.onSessionStart();
      await settle();
    },
    settle: () => settle(),
    async spawn(member = "bob", over = {}) {
      const cmd = spawnCommand(member, over);
      env.command(cmd);
      await settle();
      const ack = env.ackOf(cmd.cmdId as string);
      if (!ack) throw new Error("spawn was not acked");
      return ack;
    },
    ackOf: (cmdId) => [...acks()].reverse().find((a) => a.cmdId === cmdId),
    snapshot: () => host.snapshot(),
  };
  return env;
}
