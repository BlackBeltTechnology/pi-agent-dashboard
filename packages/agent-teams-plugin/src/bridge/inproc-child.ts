/**
 * Per-child team extension of an in-process teammate (design D4/D9; tasks 6.2–6.5). `createChildTeamExtension(identity, transport,
 * env)` returns the inline extension factory the lead host passes in `loader.extensionFactories`; it does for ONE child what the
 * session-mode bridge does for a teammate session, with a closure transport instead of the socket identity:
 *
 *  - team tools: core's `createTeamTools(transport)` filtered by the teammate row of `TEAM_TOOLS_BY_ROLE` (read at activation, so a
 *    later row appears with no change here); lead-only tools are never registered (no nested teams)
 *  - guard layers (`guard.ts`): tool allowlist backstop, sleep guard, git-write guard, skill layers 2–4 — installed for EVERY grant,
 *    an empty one included; a missing or unparseable policy fails closed (every tool call is blocked)
 *  - a proxied `hello` at `session_start` (or, when the host never fires it, at the first `before_agent_start`) carrying
 *    `guardActive`, `toolsActive` and `policyHash`; core's guard-ready rule on the server decides
 *  - plan mode (`PI_EXT_AGENT_TEAMS_PLAN_MODE` in the closure env): core's `registerPlanMode` over a child context, plus a re-narrowing
 *    at `before_agent_start` of EVERY run (the package applies its tool allowlist after extension load) and the `tool_call` backstop;
 *    approval state comes only from the server's proxied `hello` reply, refreshed through `refreshHello()` that the host calls when it
 *    delivers a `plan_decision` mail
 * The identity (`member`, token) and the env live in this closure ONLY: nothing is exported to `process.env`, nothing is module level.
 * `createChildTransport` puts `as {member, token}` on every lane payload. Logs carry ids only.
 * See change: add-agent-teams-in-process.
 */
import { type PluginLaneReply, requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { ENV_POLICY, parsePolicy } from "../shared/policy.js";
import { type HelloPayload, type HelloReply, TEAM_TOOLS_BY_ROLE, type TeamOp } from "../shared/protocol.js";
import type { BridgeContext, PiLike } from "./context.js";
import { createBeforeAgentStartHandler, createInputHandler, createToolCallHandler, type GuardState, hashOfEnvPolicy } from "./guard.js";
import type { ChildIdentity } from "./inproc-command.js";
import { createLaneClient, type LaneClient, type LaneRequest, type LaneResult } from "./lane.js";
import { registerPlanMode } from "./plan-mode.js";
import { createTeamTools, type TeamToolDef } from "./tools.js";

/** The child's lane: every payload carries the proxied identity, the socket is the lead's. */
export function createChildTransport(identity: Pick<ChildIdentity, "member" | "token">, request: (...a: Parameters<LaneRequest>) => Promise<PluginLaneReply> = requestPluginServer): LaneClient {
  const as = { member: identity.member, token: identity.token };
  return createLaneClient((pluginId, type, payload) => request(pluginId, type, { ...(payload as Record<string, unknown>), as }));
}

/** `PI_EXT_AGENT_TEAMS_<KEY>` names of a spawn env: an `extensionConfig` key is mapped like the host does (camelCase → SNAKE_CASE), an env name is kept. */
function envNames(env: Readonly<Record<string, string | string[]>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const name = /^[A-Z][A-Z0-9_]*$/.test(key) ? key : `PI_EXT_AGENT_TEAMS_${key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
    out[name] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

export interface ChildExtensionOptions {
  log?: (message: string) => void;
  /** Delay between proxied `hello` retries while the lane is unavailable (a test seam). */
  sleep?: (ms: number) => Promise<void>;
  helloRetries?: number;
}

/** The inline factory plus the host's lever to refresh the proxied `hello` (after a `plan_decision` mail). */
export type ChildTeamExtension = ((pi: PiLike) => void) & { refreshHello(): Promise<void> };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });

/** The proxied `hello` sender of one child: retries while the lane is down; overlapping calls coalesce into one extra round. */
function createHelloSender(opts: { transport: LaneClient; build(): HelloPayload; apply(res: LaneResult<HelloReply>): void; sleep(ms: number): Promise<void>; maxRetries: number }): () => Promise<void> {
  let inFlight = false;
  let again = false;
  return async () => {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      do {
        again = false;
        for (let attempt = 0; ; attempt++) {
          const res = await opts.transport.hello(opts.build());
          if (res.ok || !res.transport || attempt >= opts.maxRetries) {
            opts.apply(res);
            break;
          }
          await opts.sleep(Math.min(2000, 200 * 1.5 ** attempt));
        }
      } while (again);
    } finally {
      inFlight = false;
    }
  };
}

export function createChildTeamExtension(identity: ChildIdentity, transport: LaneClient, env: Readonly<Record<string, string | string[]>>, opts: ChildExtensionOptions = {}): ChildTeamExtension {
  const log = opts.log ?? (() => undefined);
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.helloRetries ?? 5;
  const names = envNames(env);
  const policyRaw = names[ENV_POLICY];
  const guard: GuardState = { enabled: true, policy: parsePolicy(policyRaw) };
  const policyHash = hashOfEnvPolicy(policyRaw);
  let refresh: () => Promise<void> = async () => undefined;

  const factory = (pi: PiLike): void => {
    const memberTools: readonly TeamOp[] = TEAM_TOOLS_BY_ROLE.member;
    const registered = new Set<TeamOp>();
    const helloFields: Array<() => Partial<HelloPayload>> = [];
    const replyListeners: Array<(reply: HelloReply) => void> = [];
    let started = false;
    let helloSent = false;

    for (const def of createTeamTools(transport) as TeamToolDef[]) {
      if (!memberTools.includes(def.name) || registered.has(def.name)) continue;
      pi.registerTool?.(def);
      registered.add(def.name);
    }

    const activeNow = (): string[] | undefined => {
      if (!started) return undefined; // pi throws for action methods while an extension is still loading
      try {
        return pi.getActiveTools?.();
      } catch {
        return undefined;
      }
    };

    function helloPayload(): HelloPayload {
      const active = activeNow();
      return {
        // A child reports a hello only around active work (its start, a plan decision): it never claims to be idle; the host reports the real run state.
        isIdle: false,
        toolsActive: active ? memberTools.every((t) => active.includes(t)) : memberTools.every((t) => registered.has(t)),
        guardActive: guard.enabled && guard.policy !== null,
        ...(policyHash ? { policyHash } : {}),
        confined: false,
        ...helloFields.reduce<Partial<HelloPayload>>((acc, fn) => ({ ...acc, ...fn() }), {}),
      };
    }

    function applyReply(res: LaneResult<HelloReply>): void {
      if (!res.ok) {
        log(`agent-teams: child hello of ${identity.member} refused: ${res.error}`); // the guard stays on: a stale or rejected child fails closed
        return;
      }
      for (const fn of replyListeners) {
        try {
          fn(res.data);
        } catch (err) {
          log(`agent-teams: child hello reply listener failed: ${(err as Error).name}`);
        }
      }
    }

    const hello = createHelloSender({ transport, build: helloPayload, apply: applyReply, sleep, maxRetries });
    const sendHello = (): Promise<void> => {
      helloSent = true;
      return hello();
    };
    refresh = sendHello;

    // Guard layers: always attached, whatever the grant.
    const onToolCall = createToolCallHandler(guard);
    const onBeforeAgentStart = createBeforeAgentStartHandler(guard);
    const onInput = createInputHandler(guard);
    pi.on?.("tool_call", (event) => onToolCall(event));
    pi.on?.("input", (event) => onInput(event));

    // Plan mode over a child context: narrowing at session_start (core), again at every run (below), the `tool_call` backstop (core).
    const ctx: BridgeContext = {
      pi,
      env: names,
      lane: transport,
      log,
      role: () => "member",
      started: () => started,
      hello: { addPayload: (fn) => void helloFields.push(fn), onReply: (fn) => void replyListeners.push(fn), send: sendHello },
      onMail: () => undefined, // mail reaches a child as steer text; the host triggers the refresh from the mail kind
      tools: { registered: () => [...registered], activate: () => undefined, deactivate: () => undefined },
      becomeLead: () => undefined,
      renarrowEachRun: true,
    };
    registerPlanMode(ctx);

    pi.on?.("session_start", () => {
      started = true;
      if (!helloSent) void sendHello().catch((err: Error) => log(`agent-teams: child hello failed: ${err.name}`));
    });
    pi.on?.("before_agent_start", (event) => {
      started = true;
      // The loader may never fire `session_start` for a child: the first run still announces the guard before its first model call.
      if (!helloSent) void sendHello().catch((err: Error) => log(`agent-teams: child hello failed: ${err.name}`));
      return onBeforeAgentStart(event);
    });
  };

  return Object.assign(factory, { refreshHello: () => refresh() });
}
