/**
 * agent-teams-plugin · bridge entry (tasks 8.1, 8.4–8.6, 9.x; design D3–D7, D11).
 * Auto-registered as a pi extension (manifest `bridge` entry), once per session:
 *
 *  - registers the role's tools SYNCHRONOUSLY from the env hint (teammate: its set;
 *    plain session: `TeamCreate` + `TeammateSpawn`; a confined session: none), so a
 *    teammate's first turn already has its tools; `hello` only confirms or downgrades
 *  - reports `hello` at every `session_start` (retrying while the lane is unavailable)
 *    and after a de-duplicated mail; the server is authoritative for the role
 *  - teammate: `busy` at `agent_start`, `idle` at `agent_settled` (text/error from `agent_end`)
 *  - `agent-teams:mail` → custom message (`deliverAs:"steer"`, `triggerTurn` = wake) → ack
 *  - `agent-teams:team_closed` → the lead-only tools are dropped with `setActiveTools`
 *  - teammate guard layers (`guard.ts`): tool_call, before_agent_start, input
 * The env is only a hint: nothing here grants authority, the server re-checks every call.
 * See change: add-agent-teams-core.
 */

import { PLUGIN_REQUEST_SYMBOL } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { registerApprovalMailKinds } from "../shared/approval-mail.js";
import type { Clock } from "../shared/clock.js";
import { compareMailIds } from "../shared/constants.js";
import { customTypeForKind, formatMail } from "../shared/mail-format.js";
import {
  AGENT_TEAMS_EVENT_MAIL,
  AGENT_TEAMS_EVENT_TEAM_CLOSED,
} from "../shared/plugin-id.js";
import {
  CONFINING_ENV_KEYS,
  ENV_MEMBER,
  ENV_POLICY,
  ENV_TEAM_ID,
  parsePolicy,
} from "../shared/policy.js";
import {
  type HelloPayload,
  type HelloReply,
  LEAD_ONLY_TOOLS,
  TEAM_TOOLS_BY_ROLE,
  type TeamOp,
  type TeamRole,
  type WireMail,
} from "../shared/protocol.js";
import { registerAgentTeamCommand } from "./command.js";
import type { BridgeContext, BridgeRegistrar, PiLike } from "./context.js";
import {
  createBeforeAgentStartHandler,
  createInputHandler,
  createToolCallHandler,
  type GuardState,
  hashOfEnvPolicy,
} from "./guard.js";
import { type ChildTeamExtension, createChildTeamExtension, createChildTransport } from "./inproc-child.js";
import { createInProcHost, type InProcHost, type ReportResult } from "./inproc-host.js";
import { createLaneClient, type LaneClient, type LaneResult } from "./lane.js";
import { registerPlanMode } from "./plan-mode.js";
import { createTeamTools, TEAM_TOOL_NAMES, type TeamToolDef, type TeamTransport } from "./tools.js";

/** Last mail ids remembered for de-duplication (design D5). */
export const SEEN_MAIL_IDS = 200;

export type { PiLike };

/** Optional bridge modules, registered in this order (plan mode before the command: its handlers attach first). */
const BRIDGE_REGISTRARS: readonly BridgeRegistrar[] = [registerPlanMode, registerAgentTeamCommand];

export interface BridgeOptions {
  env?: Record<string, string | undefined>;
  lane?: LaneClient;
  /** Delay between `hello` retries while the lane is unavailable. */
  sleep?: (ms: number) => Promise<void>;
  helloRetries?: number;
  /** Whether the dashboard request lane is currently open (default: the host's global lane symbol). */
  laneUp?: () => boolean;
  /** How often the lane is sampled for a reconnect (ms, default 2000). */
  laneWatchMs?: number;
  log?: (message: string) => void;
  /** Optional bridge modules (default: plan mode + the `/agent-team` command); a test seam. */
  modules?: readonly BridgeRegistrar[];
  /**
   * Host in-process teammates (design D3): probe `subagents:capabilities`, answer the server's `agent-teams:inproc` commands and report
   * the children's lifecycle. Off by default (the shipped `activate` turns it on); never for a teammate or a confined session.
   */
  inProcessHost?: boolean;
}

/** The host's timers must never keep the pi process alive. */
const unrefClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A lane result as the host's outbox reads it: `no_handler` (a server without the in-process lane) is a definitive answer, not an outage. */
function toReportResult(res: { ok: true } | { ok: false; error: string; transport: boolean }): ReportResult {
  if (res.ok) return { ok: true };
  return { ok: false, transport: res.transport && res.error !== "no_handler", error: res.error };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; text: string } => isRecord(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function isWireMail(v: unknown): v is WireMail {
  return isRecord(v) && Number.isInteger(v.id) && typeof v.from === "string" && typeof v.kind === "string" && typeof v.text === "string";
}

/** The in-process host of a lead/plain session: needs the pi bus (`on` + `emit`) and a lane that carries `agent-teams/inproc`. */
function createLeadHost(pi: PiLike, lane: LaneClient, log: (message: string) => void, leadCwd: () => string | undefined): InProcHost | undefined {
  const events = pi.events;
  if (typeof events?.on !== "function" || typeof events.emit !== "function" || !lane.inproc) return undefined;
  const send = lane.inproc.bind(lane);
  /** The live child extensions by member: the host refreshes a child's proxied hello when a `plan_decision` mail reaches it. */
  const children = new Map<string, ChildTeamExtension>();
  return createInProcHost({
    bus: { on: (channel, fn) => events.on?.(channel, fn), emit: (channel, payload) => events.emit?.(channel, payload) },
    clock: unrefClock,
    send: async (payload) => toReportResult(await send(payload)),
    childExtension: (identity) => {
      const extension = createChildTeamExtension(identity, createChildTransport(identity), identity.env, { log });
      children.set(identity.member, extension);
      return extension;
    },
    onPlanDecision: (member) => void children.get(member)?.refreshHello().catch((err: Error) => log(`agent-teams: child hello refresh failed: ${err.name}`)),
    leadCwd,
    log,
  });
}

export function createBridge(pi: PiLike, opts: BridgeOptions = {}) {
  registerApprovalMailKinds(); // kind → customType for server-sent plan/hook/playbook mails
  const env = opts.env ?? process.env;
  const lane = opts.lane ?? createLaneClient();
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? (() => undefined);
  const maxRetries = opts.helloRetries ?? 20;
  const laneUp = opts.laneUp ?? (() => typeof (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL] === "function");
  const laneWatchMs = opts.laneWatchMs ?? 2000;

  const confined = CONFINING_ENV_KEYS.some((k) => (env[k] ?? "") !== "");
  const hintedMember = (env[ENV_MEMBER] ?? "") !== "" && (env[ENV_TEAM_ID] ?? "") !== "";
  let role: TeamRole = hintedMember && !confined ? "member" : "plain";
  const guard: GuardState = { enabled: hintedMember && !confined, policy: parsePolicy(env[ENV_POLICY]) };
  const policyHash = hintedMember ? hashOfEnvPolicy(env[ENV_POLICY]) : undefined;

  const registered = new Set<TeamOp>();
  const seen: number[] = [];
  let settleId = 0;
  let running = false;
  let lastText = "";
  let lastError: string | undefined;
  let lastCtx: { isIdle?: () => boolean; cwd?: string; sessionManager?: { getSessionFile?: () => string | undefined } } | undefined;
  const helloFields: Array<() => Partial<HelloPayload>> = [];
  const helloReplyListeners: Array<(reply: HelloReply) => void> = [];
  const mailListeners: Array<(mail: WireMail) => void> = [];
  let helloInFlight = false;
  let helloAgain = false;

  // ── tools ───────────────────────────────────────────────────────────────────

  const transport: TeamTransport = {
    async call(op, args) {
      const res = await lane.call(op, args);
      if (res.ok && (op === "TeamCreate" || op === "TeammateSpawn") && role === "plain") becomeLead();
      return res;
    },
  };
  const defs = new Map<TeamOp, TeamToolDef>(createTeamTools(transport).map((d) => [d.name, d]));

  /**
   * pi throws "Extension runtime not initialized" for action methods
   * (`getActiveTools`/`setActiveTools`) while the extension is still loading, which
   * aborts the whole session. `registerTool` is load-safe; the active-set sync waits
   * for `session_start`.
   */
  let started = false;

  /** Register (once) and activate the given tools. */
  function activateTools(names: readonly TeamOp[]): void {
    if (confined || typeof pi.registerTool !== "function") return;
    for (const name of names) {
      const def = defs.get(name);
      if (def && !registered.has(name)) {
        pi.registerTool(def);
        registered.add(name);
      }
    }
    if (!started) return;
    const active = pi.getActiveTools?.();
    if (active && pi.setActiveTools) {
      const missing = names.filter((n) => !active.includes(n));
      if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
    }
  }

  function deactivateTools(names: readonly string[]): void {
    if (!started) return;
    const active = pi.getActiveTools?.();
    if (active && pi.setActiveTools) pi.setActiveTools(active.filter((n) => !names.includes(n)));
  }

  function becomeLead(): void {
    role = "lead";
    activateTools(TEAM_TOOLS_BY_ROLE.lead);
  }

  /** Back to a plain session: only `TeamCreate` + `TeammateSpawn`, no guard. */
  function becomePlain(): void {
    role = "plain";
    guard.enabled = false;
    deactivateTools(TEAM_TOOL_NAMES.filter((n) => !TEAM_TOOLS_BY_ROLE.plain.includes(n)));
    activateTools(TEAM_TOOLS_BY_ROLE.plain);
  }

  // Role tools from the env hint, synchronously: the first turn must already have them.
  activateTools(TEAM_TOOLS_BY_ROLE[role]);

  // ── hello ───────────────────────────────────────────────────────────────────

  function helloPayload(): HelloPayload {
    const active = started ? pi.getActiveTools?.() : undefined;
    const toolsActive = confined || (active ? TEAM_TOOLS_BY_ROLE[role].every((t) => active.includes(t)) : TEAM_TOOLS_BY_ROLE[role].every((t) => registered.has(t)));
    const sessionFile = lastCtx?.sessionManager?.getSessionFile?.();
    return {
      isIdle: lastCtx?.isIdle ? lastCtx.isIdle() : !running,
      toolsActive,
      guardActive: hintedMember ? guard.enabled && guard.policy !== null : true,
      ...(policyHash ? { policyHash } : {}),
      confined,
      ...(sessionFile ? { sessionFile } : {}),
      ...helloFields.reduce<Partial<HelloPayload>>((acc, fn) => ({ ...acc, ...fn() }), {}),
    };
  }

  function applyHelloReply(res: LaneResult<{ role: TeamRole }>): void {
    if (!res.ok) {
      if (res.error === "not_in_team" && role !== "plain") becomePlain();
      return;
    }
    if (res.data.role === "lead" && role !== "lead") becomeLead();
    else if (res.data.role === "member") role = "member";
    for (const fn of helloReplyListeners) {
      try {
        fn(res.data as HelloReply);
      } catch (err) {
        log(`agent-teams: hello reply listener failed: ${(err as Error).message}`);
      }
    }
  }

  /** Send `hello` (retrying while the lane is unavailable); overlapping calls coalesce into one extra round. */
  async function sendHello(): Promise<void> {
    if (helloInFlight) {
      helloAgain = true;
      return;
    }
    helloInFlight = true;
    try {
      do {
        helloAgain = false;
        for (let attempt = 0; ; attempt++) {
          const res = await lane.hello(helloPayload());
          if (res.ok || !res.transport || attempt >= maxRetries) {
            applyHelloReply(res as LaneResult<{ role: TeamRole }>);
            break;
          }
          await sleep(Math.min(5000, 250 * 1.5 ** attempt));
        }
      } while (helloAgain);
    } finally {
      helloInFlight = false;
    }
  }

  // ── mail ────────────────────────────────────────────────────────────────────

  async function handleMail(payload: unknown): Promise<void> {
    const raw = isRecord(payload) && Array.isArray(payload.mails) ? payload.mails : [];
    const mails = raw.filter(isWireMail).sort((a, b) => compareMailIds(a.id, b.id));
    const acks: number[] = [];
    let skipped = false;
    for (const mail of mails) {
      if (seen.includes(mail.id)) {
        acks.push(mail.id); // the server's ack is idempotent: re-ack so its queue drains
        skipped = true;
        continue;
      }
      try {
        pi.sendMessage?.(
          {
            customType: customTypeForKind(mail.kind),
            content: formatMail({ kind: mail.kind, sender: mail.from, urgent: mail.priority === "urgent", text: mail.text }),
            display: true,
            details: { mailId: mail.id, kind: mail.kind, from: mail.from },
          },
          { deliverAs: "steer", triggerTurn: mail.wake === true },
        );
      } catch (err) {
        log(`agent-teams: delivering mail ${mail.id} failed: ${(err as Error).message}`);
        continue; // no ack, not remembered: the server re-emits it
      }
      seen.push(mail.id);
      if (seen.length > SEEN_MAIL_IDS) seen.shift();
      acks.push(mail.id);
      for (const fn of mailListeners) {
        try {
          fn(mail);
        } catch (err) {
          log(`agent-teams: mail listener failed: ${(err as Error).message}`);
        }
      }
    }
    if (acks.length > 0) await lane.ack(acks);
    if (skipped) await sendHello(); // a provisional busy for a mail that produced no turn recovers at once
  }

  // ── in-process host (lead side; inert unless enabled and the pi bus can emit) ─────────────
  let inProcHost = opts.inProcessHost === true && !confined && !hintedMember ? createLeadHost(pi, lane, log, () => lastCtx?.cwd ?? process.cwd()) : undefined;

  // ── optional modules (plan mode, /agent-team command) ───────────────────────

  const bridgeContext: BridgeContext = {
    pi,
    env,
    lane,
    log,
    role: () => role,
    started: () => started,
    hello: {
      addPayload: (fn) => void helloFields.push(fn),
      onReply: (fn) => void helloReplyListeners.push(fn),
      send: () => sendHello(),
    },
    onMail: (fn) => void mailListeners.push(fn),
    tools: { registered: () => [...registered], activate: activateTools, deactivate: deactivateTools },
    becomeLead,
  };
  for (const register of opts.modules ?? BRIDGE_REGISTRARS) {
    try {
      register(bridgeContext);
    } catch (err) {
      log(`agent-teams: bridge module failed to register: ${(err as Error).message}`);
    }
  }

  // ── wiring ──────────────────────────────────────────────────────────────────

  pi.events?.on?.(AGENT_TEAMS_EVENT_MAIL, (payload) => {
    void handleMail(payload).catch((err: Error) => log(`agent-teams: mail handler failed: ${err.message}`));
  });
  pi.events?.on?.(AGENT_TEAMS_EVENT_TEAM_CLOSED, () => {
    if (role === "lead") {
      role = "plain";
      deactivateTools(LEAD_ONLY_TOOLS);
    }
  });

  const remember = (ctx: unknown): void => {
    if (isRecord(ctx)) lastCtx = ctx as typeof lastCtx;
  };

  // The host gives a bridge no reconnect signal, but it drops the lane global while the socket is
  // closed and re-installs it on open. A server restart leaves every member `disconnected` until its
  // `hello`, so a down→up transition re-sends it (design D14: "hello at session_start and on reconnect").
  let laneWatch: ReturnType<typeof setInterval> | undefined;
  const watchLane = (): void => {
    if (laneWatch !== undefined) return;
    let wasUp = laneUp();
    laneWatch = setInterval(() => {
      const up = laneUp();
      if (up && !wasUp) {
        void sendHello();
        inProcHost?.onReconnect();
      }
      wasUp = up;
    }, laneWatchMs);
    (laneWatch as { unref?: () => void }).unref?.();
  };

  pi.on?.("session_start", (_event, ctx) => {
    remember(ctx);
    started = true;
    watchLane();
    void sendHello();
    inProcHost?.onSessionStart();
  });
  pi.on?.("session_shutdown", () => {
    if (laneWatch !== undefined) clearInterval(laneWatch);
    laneWatch = undefined;
    inProcHost?.dispose();
    inProcHost = undefined;
  });

  // Teammate guard layers: always attached for a hinted member (inert once it left the team).
  if (hintedMember && !confined) {
    const onToolCall = createToolCallHandler(guard);
    const onBeforeAgentStart = createBeforeAgentStartHandler(guard);
    const onInput = createInputHandler(guard);
    pi.on?.("tool_call", (event) => onToolCall(event));
    pi.on?.("before_agent_start", (event) => onBeforeAgentStart(event));
    pi.on?.("input", (event) => onInput(event));
  }

  pi.on?.("agent_start", (_event, ctx) => {
    remember(ctx);
    running = true;
    lastText = "";
    lastError = undefined;
    if (role === "member") void lane.busy().then((r) => (!r.ok && r.transport ? sendHello() : undefined));
  });

  pi.on?.("agent_end", (event) => {
    const messages: unknown[] = isRecord(event) && Array.isArray(event.messages) ? event.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!isRecord(m) || m.role !== "assistant") continue;
      lastText = assistantText(m.content);
      if (m.stopReason === "error" || (typeof m.errorMessage === "string" && m.errorMessage !== "")) {
        lastError = typeof m.errorMessage === "string" && m.errorMessage !== "" ? m.errorMessage : lastText || "the model run failed";
      }
      break;
    }
  });

  pi.on?.("agent_settled", (event, ctx) => {
    remember(ctx);
    running = false;
    if (role !== "member") return;
    const aborted = isRecord(event) && event.aborted === true;
    void lane
      .idle({
        settleId: ++settleId,
        ...(lastText ? { finalText: lastText } : {}),
        ...(lastError !== undefined ? { error: lastError } : {}),
        ...(aborted ? { aborted: true } : {}),
      })
      .then((r) => (!r.ok && r.transport ? sendHello() : undefined));
  });

  return {
    /** Current role as the bridge believes it (the server is authoritative). */
    get role(): TeamRole {
      return role;
    },
    sendHello,
    handleMail,
    guard,
    /** The in-process lead host, when enabled (tests). */
    get inProcHost(): InProcHost | undefined {
      return inProcHost;
    },
  };
}

/** Process-wide owner of the bridge: `process[Symbol.for("agent-teams.bridge")]` holds the pi that activated it (re-entry guard, design D9). */
export const BRIDGE_OWNER_KEY = Symbol.for("agent-teams.bridge");
interface BridgeOwner {
  pi?: unknown;
}

/**
 * Take ownership of the process for `pi`. A subagent child loads every extension again in the SAME process with its own `pi`: while
 * the lead's bridge is live that second activation must be inert (it would register `TeamCreate`/`TeammateSpawn` under the lead's
 * identity). Ownership is released on the owner's `session_shutdown` (any reason: reload/new/resume/fork hand the process to a fresh
 * `ExtensionAPI`; a child's own shutdown never releases the lead's, since only the owner releases). Returns false when another
 * instance owns the process.
 */
export function claimBridgeOwnership(pi: PiLike, holder: BridgeOwner = ((process as unknown as Record<symbol, BridgeOwner | undefined>)[BRIDGE_OWNER_KEY] ??= {})): boolean {
  if (holder.pi !== undefined && holder.pi !== pi) return false;
  holder.pi = pi;
  pi.on?.("session_shutdown", () => {
    if (holder.pi === pi) holder.pi = undefined;
  });
  return true;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.on !== "function") return;
  if (!claimBridgeOwnership(pi)) return; // a subagent child in the lead's process: register nothing, send no hello
  createBridge(pi, { inProcessHost: true });
}
