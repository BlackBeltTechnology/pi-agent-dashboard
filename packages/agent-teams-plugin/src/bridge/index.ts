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
  LEAD_ONLY_TOOLS,
  TEAM_TOOLS_BY_ROLE,
  type TeamOp,
  type TeamRole,
  type WireMail,
} from "../shared/protocol.js";
import {
  createBeforeAgentStartHandler,
  createInputHandler,
  createToolCallHandler,
  type GuardState,
  hashOfEnvPolicy,
} from "./guard.js";
import { createLaneClient, type LaneClient, type LaneResult } from "./lane.js";
import { createTeamTools, TEAM_TOOL_NAMES, type TeamToolDef, type TeamTransport } from "./tools.js";

/** Last mail ids remembered for de-duplication (design D5). */
export const SEEN_MAIL_IDS = 200;

interface PiLike {
  // biome-ignore lint/suspicious/noExplicitAny: pi event payloads and contexts differ per event; each handler narrows its own
  on?: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  registerTool?: (tool: TeamToolDef) => void;
  getActiveTools?: () => string[];
  setActiveTools?: (names: string[]) => void;
  sendMessage?: (message: { customType: string; content: string; display: boolean; details?: Record<string, unknown> }, options?: { deliverAs?: string; triggerTurn?: boolean }) => void;
  events?: { on?: (name: string, handler: (payload: unknown) => void) => unknown };
}

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

export function createBridge(pi: PiLike, opts: BridgeOptions = {}) {
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
  let lastCtx: { isIdle?: () => boolean; sessionManager?: { getSessionFile?: () => string | undefined } } | undefined;
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
    };
  }

  function applyHelloReply(res: LaneResult<{ role: TeamRole }>): void {
    if (!res.ok) {
      if (res.error === "not_in_team" && role !== "plain") becomePlain();
      return;
    }
    if (res.data.role === "lead" && role !== "lead") becomeLead();
    else if (res.data.role === "member") role = "member";
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
    }
    if (acks.length > 0) await lane.ack(acks);
    if (skipped) await sendHello(); // a provisional busy for a mail that produced no turn recovers at once
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
      if (up && !wasUp) void sendHello();
      wasUp = up;
    }, laneWatchMs);
    (laneWatch as { unref?: () => void }).unref?.();
  };

  pi.on?.("session_start", (_event, ctx) => {
    remember(ctx);
    started = true;
    watchLane();
    void sendHello();
  });
  pi.on?.("session_shutdown", () => {
    if (laneWatch !== undefined) clearInterval(laneWatch);
    laneWatch = undefined;
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
  };
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.on !== "function") return;
  createBridge(pi);
}
