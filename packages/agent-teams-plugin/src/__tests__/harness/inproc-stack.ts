/**
 * The REAL server runtime (`createTeamsEnv`, in-process mode on) wired to the REAL lead-side host (`bridge/inproc-host.ts`) over the
 * recorded subagents contract double: every `agent-teams:inproc` command the server emits to the lead reaches the host's bus, and everything
 * the host sends (`hello`, `ack`, `event` reports) goes through the REAL `agent-teams/inproc` lane handler. One `FakeClock` drives all three.
 * `lane.up = false` simulates a lane outage (the host's `requestPluginServer` resolving `{ok:false}`); `lane.drop` filters single requests.
 * Complements `inproc-link.ts` (scripted fake bridge) and `inproc-pair.ts` (real driver with a stubbed lane) for the lifecycle intake rows.
 * See change: add-agent-teams-in-process.
 */
import { createInProcHost, type InProcHost, type ReportResult } from "../../bridge/inproc-host.js";
import { LANE_INPROC } from "../../shared/inproc-protocol.js";
import { REQUIRED_API_VERSION, REQUIRED_FEATURES } from "../../shared/subagents-contract.js";
import type { Member, Team } from "../../shared/types.js";
import { createDoubleBus, type DoubleOptions, installSubagentsDouble } from "./subagents-double.js";
import { createTeamsEnv, type TeamsEnv, type TeamsEnvOptions } from "./teams-env.js";

type LanePayload = Record<string, unknown>;

export interface StackOptions extends TeamsEnvOptions {
  double?: Partial<Omit<DoubleOptions, "clock">>;
  incarnation?: string;
  secret?: string;
}

async function settle(turns = 16): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

export function createInProcStack(opts: StackOptions = {}) {
  const { double: doubleOpts, incarnation, secret, runtime, ...envOpts } = opts;
  const env: TeamsEnv = createTeamsEnv({ ...envOpts, runtime: { inProcess: true, ...(runtime ?? {}) } });
  const bus = createDoubleBus();
  const double = installSubagentsDouble(bus, { clock: env.clock, ...(doubleOpts ?? {}) });
  const sent: LanePayload[] = [];
  const logs: string[] = [];
  /** `up=false` ⇒ every request fails before the server sees it; `drop` ⇒ the same for one request; `loseOk` ⇒ the server DID process it but its ok:true is lost. */
  const lane = { up: true, drop: undefined as ((p: LanePayload) => boolean) | undefined, loseOk: undefined as ((p: LanePayload) => boolean) | undefined };

  const host: InProcHost = createInProcHost({
    bus,
    clock: env.clock,
    readFile: async () => new Uint8Array(),
    send: async (payload): Promise<ReportResult> => {
      sent.push(payload);
      if (!lane.up || lane.drop?.(payload)) return { ok: false, transport: true, error: "disconnected" };
      const res = (await env.fake.lane(env.lead, LANE_INPROC, payload)) as { ok: boolean; error?: string } | undefined;
      if (lane.loseOk?.(payload)) return { ok: false, transport: true, error: "timeout" };
      return res?.ok ? { ok: true } : { ok: false, transport: false, ...(res?.error ? { error: res.error } : {}) };
    },
    log: (m) => void logs.push(m),
    newIncarnation: () => incarnation ?? "inc-stack-1",
    newSecret: () => secret ?? "secret-stack-1",
  });
  env.fake.base.onEmit((e) => {
    if (e.eventType === "agent-teams:inproc" && e.sessionId === env.lead) bus.emit("agent-teams:inproc", e.data);
  });

  const stack = {
    env,
    bus,
    double,
    host,
    sent,
    logs,
    lane,
    clock: env.clock,
    store: env.rt.store,
    /** Host `session_start`: probe + `inproc hello`. */
    async start(): Promise<void> {
      host.onSessionStart();
      await stack.settle();
    },
    /** Let promise turns and the real zero timeout run (host ↔ lane ↔ driver hops). */
    async settle(): Promise<void> {
      await settle();
      await env.settle();
      await settle();
    },
    /** `TeamCreate {mode:"in-process"}` as the lead. */
    async createTeam(name = "t"): Promise<Team> {
      const res = await env.fake.call(env.lead, "TeamCreate", { name, mode: "in-process" });
      if (!res.ok) throw new Error(`TeamCreate failed: ${res.error} ${res.message ?? ""}`);
      return env.rt.store.get(res.data.teamId) as Team;
    },
    /** `TeammateSpawn` as the lead; settles. The member is `busy` once the child reported `started`. */
    async spawn(team: Team, name: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: any; error?: string }> {
      const res = await env.fake.call(env.lead, "TeammateSpawn", { name, prompt: `work for ${name}`, ...extra });
      await stack.settle();
      return res;
    },
    member: (team: Team, name: string): Member => env.rt.store.member(env.rt.store.get(team.id) as Team, name) as Member,
    /** A proxied request-lane call as member `name` (the lead's socket plus the member's `as {member, token}`), like a child's closure transport. */
    callAs(team: Team, name: string, op: string, args?: unknown): Promise<any> {
      const token = (stack.member(team, name) as Member).proxyToken;
      return env.fake.lane(env.lead, "agent-teams/call", { op, args, as: { member: name, token } });
    },
    /** The child's proxied guarded `hello` (what `inproc-child.ts` sends at `session_start`). */
    helloAs(team: Team, name: string, over: Record<string, unknown> = {}): Promise<any> {
      const token = (stack.member(team, name) as Member).proxyToken;
      return env.fake.lane(env.lead, "agent-teams/hello", { isIdle: false, toolsActive: true, guardActive: true, confined: false, as: { member: name, token }, ...over });
    },
    /** A raw `inproc hello` (a bridge activation of its own: new `incarnation` / secret / snapshot), from `from` (default the lead). */
    hello(over: { incarnation?: string; commandSecret?: string; available?: boolean; snapshot?: unknown; from?: string } = {}): Promise<any> {
      return env.fake.lane(over.from ?? env.lead, LANE_INPROC, {
        op: "hello",
        incarnation: over.incarnation ?? "inc-stack-1",
        commandSecret: over.commandSecret ?? "secret-stack-1",
        inProcess: over.available === false ? { available: false, reason: "subagents_extension_missing" } : { available: true, apiVersion: REQUIRED_API_VERSION, features: [...REQUIRED_FEATURES, "interrupt"], limits: { maxConcurrent: 4 } },
        ...(over.snapshot !== undefined ? { snapshot: over.snapshot } : {}),
      });
    },
    /** A host report sent straight to the lane (a shape the contract double does not produce). */
    event(payload: Record<string, unknown>): Promise<any> {
      return env.fake.lane(env.lead, LANE_INPROC, { op: "event", ...payload });
    },
    /** The `agentId` of a member's child. */
    agentOf: (team: Team, name: string): string => stack.member(team, name).childAgentId as string,
    /** Mails of kind `notice` addressed to the lead (the lifecycle notices). */
    notices: (team: Team) => env.rt.store.mailLog(team.id).filter((m) => m.to === "lead" && m.kind === "notice"),
    /** Past the lead-notice coalescing window, then settle. */
    async flushNotices(ms = 2000): Promise<void> {
      env.clock.advance(ms);
      await stack.settle();
    },
  };
  return stack;
}

export type InProcStack = ReturnType<typeof createInProcStack>;
