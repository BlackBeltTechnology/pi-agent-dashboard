/**
 * Supervised-mode `tool_call` gate (design D2/D3/D5/D8/D10/D12).
 *
 * A Supervised session raises an in-dashboard approval before a risky tool
 * runs. The settlement core (decide → request → one timer → map outcome →
 * `{ block, reason }`, fail closed on every throw) is the SHARED
 * `createToolCallGuard`; the layers that exist only for supervised mode sit
 * HERE, outside it: the per-call mode read, the gateway owner self-disable,
 * the unclassified-tool log, the path-gate hand-off, the no-UI shortcut and the
 * gate's own per-session mutex (distinct from the path gate's, so a pending
 * approval never delays a path-gate YOLO answer).
 *
 * Fails CLOSED itself: registered in the bridge WITHOUT the fail-open `safe()`
 * wrapper; any internal error blocks with `supervised: error`. An approved call
 * returns `undefined` and never mutates `event.input` — the approval covers the
 * input as the gate saw it.
 *
 * Approval gating, not sandboxing: an approved tool runs with full permissions.
 * See change: add-supervised-tool-approval.
 */
import {
  normalizeSupervisedTimeoutSeconds,
  type SupervisedModeConfig,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  ALLOW_ONCE,
  type ApprovalPrompt,
  type ApprovalSurface,
  type BlockedOutcome,
  createToolCallGuard,
  type DecisionRecord,
  type GateOutcome,
  type ToolCallEvent,
} from "@blackbelt-technology/pi-dashboard-shared/tool-gate/guard.js";
import { toolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import type { ToolPolicy } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/policy.js";
import {
  buildSupervisedPolicy,
  decideSupervisedTool,
  readFamily,
  riskySet,
  wrapperTools,
} from "@blackbelt-technology/pi-dashboard-shared/tool-gate/supervised-policy.js";
import { buildSupervisedSummary, summaryMarkdown, summaryPlain } from "./summary.js";

export const KIND_SUPERVISED = "supervised-tool-approval";
const OPT_DENY = "Deny";
/** Longest decision-record summary (after redaction). */
const SUMMARY_CAP = 500;
/** Longest operator reason delivered to the agent. */
const REASON_CAP = 500;
/** Bound on distinct unclassified-tool names remembered per session (names are agent-controlled). */
const UNCLASSIFIED_CAP = 256;

export interface SupervisedPromptRequest {
  id: string;
  question: string;
  options: string[];
  metadata: Record<string, unknown>;
}

export interface SupervisedPromptResult {
  answer?: string;
  cancelled?: boolean;
  /** Adapter label of whoever answered (`tui`, `dashboard-default`, `__bus__`, …). */
  source: string;
}

/** PromptBus transport (`requestWithId` / `cancel`). A missing bus must throw — the gate fails closed. */
export interface SupervisedPrompter {
  request(req: SupervisedPromptRequest): Promise<SupervisedPromptResult>;
  cancel(id: string): void;
}

/** One durable `supervised-tool-decision` record. */
export interface SupervisedDecisionEntry {
  sessionId: string;
  tool: string;
  /** ≤ 500 chars, secret-redacted. */
  summary: string;
  outcome: GateOutcome;
  answeredSurface: string;
  via: "supervised" | "path-gate";
}

export interface SupervisedGateDeps {
  sessionId: () => string;
  /** Per-call mode read (`false` → the gate is inert). */
  getMode: (sessionId: string) => boolean;
  /** Fresh (cached-by-signature) resolved config; `tools` + `timeoutSeconds` are read per call. */
  getConfig: () => SupervisedModeConfig;
  /** The session PromptBus timeout in ms (`undefined` / ≤ 0 = infinite). */
  getBusTimeoutMs?: () => number | undefined;
  prompter: SupervisedPrompter;
  /**
   * Path-gate hand-off: true when the operator already answered **Allow once** on
   * an enriched path prompt for this `toolCallId` (consumes it). Default: never.
   */
  consumeHandoff?: (sessionId: string, toolCallId: string) => boolean;
  /** Secret redaction applied to every operator-visible / logged action text. */
  redact?: (text: string) => string;
  /** Durable sink (`pi.appendEntry("supervised-tool-decision", entry)`). */
  record: (entry: SupervisedDecisionEntry) => void;
  log: (line: string) => void;
  /** Owner slot read (default: the shared `toolGateOwner`). */
  getOwner?: (sessionId: string) => string | undefined;
  newId?: () => string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface SupervisedGateCtx {
  hasUI: boolean;
  cwd: string;
  signal?: AbortSignal;
}

export type SupervisedGateResult = { block: true; reason: string } | undefined;

const CONTROL = /[\u0000-\u001f\u007f]/g;
const LOG_CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g;

/** Strip control characters (U+0000–U+001F, U+007F) and cap at `max` code points. */
export function sanitizeOperatorText(text: string, max: number = REASON_CAP): string {
  const clean = text.replace(CONTROL, "");
  const points = Array.from(clean);
  return points.length > max ? points.slice(0, max).join("") : clean;
}

/** Effective approval window in ms: `max(1s, min(cfg, bus − 1s))`; bus ≤ 0 / absent → cfg. */
export function effectiveDeadlineMs(timeoutSeconds: unknown, busTimeoutMs: number | undefined): number {
  const cfgMs = normalizeSupervisedTimeoutSeconds(timeoutSeconds) * 1000;
  if (typeof busTimeoutMs !== "number" || !Number.isFinite(busTimeoutMs) || busTimeoutMs <= 0) return cfgMs;
  return Math.max(1000, Math.min(cfgMs, busTimeoutMs - 1000));
}

/** Map a PromptBus response `source` to the audit `answeredSurface`. */
export function surfaceOf(source: string | undefined): string {
  if (source === "__bus__") return "bus";
  if (typeof source === "string" && source.startsWith("tui")) return "tui";
  return "dashboard";
}

const ABORTED = Symbol("supervised-aborted-while-queued");

export function createSupervisedGate(deps: SupervisedGateDeps) {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const redact = deps.redact ?? ((s: string) => s);
  const getOwner = deps.getOwner ?? toolGateOwner;
  const chains = new Map<string, Promise<unknown>>();
  const unclassified = new Map<string, Set<string>>();
  const classified = new Set<string>([...readFamily, ...riskySet, ...wrapperTools].map((t) => t.toLowerCase()));

  // The policy is rebuilt only when the configured list changes identity.
  let lastTools: readonly string[] | undefined;
  let lastPolicy: ToolPolicy = buildSupervisedPolicy([]);
  let lastConfigured = new Set<string>();
  const policyFor = (tools: readonly string[]): ToolPolicy => {
    if (tools !== lastTools) {
      lastTools = tools;
      lastPolicy = buildSupervisedPolicy(tools);
      lastConfigured = new Set(tools.map((t) => String(t).toLowerCase()));
    }
    return lastPolicy;
  };

  const emit = (line: string): void => deps.log(line.replace(LOG_CONTROL, "?"));

  const writeRecord = (sid: string, entry: Omit<SupervisedDecisionEntry, "sessionId" | "summary"> & { summary: string }): void => {
    const summary = Array.from(redact(entry.summary)).slice(0, SUMMARY_CAP).join("");
    try {
      deps.record({ ...entry, sessionId: sid, summary });
    } catch (err) {
      emit(`[supervised] decision entry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    emit(
      `[supervised] ${entry.outcome} tool=${entry.tool} via=${entry.via} surface=${entry.answeredSurface} session=${sid} summary=${summary}`,
    );
  };

  function logUnclassified(sid: string, tool: string): void {
    const t = String(tool).toLowerCase();
    if (classified.has(t) || lastConfigured.has(t)) return;
    let seen = unclassified.get(sid);
    if (!seen) {
      seen = new Set();
      unclassified.set(sid, seen);
    }
    if (seen.has(t) || seen.size >= UNCLASSIFIED_CAP) return;
    seen.add(t);
    emit(`[supervised] unclassified tool ${tool}`);
  }

  /** One approval at a time per session; an abort while queued gives up its place. */
  async function withMutex<T>(sid: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T | typeof ABORTED> {
    const prior = chains.get(sid) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => mine);
    chains.set(sid, tail);
    void tail.then(() => {
      if (chains.get(sid) === tail) chains.delete(sid);
    });
    try {
      const turn = await new Promise<"turn" | "aborted">((resolve) => {
        if (signal?.aborted) return resolve("aborted");
        const onAbort = () => resolve("aborted");
        signal?.addEventListener("abort", onAbort, { once: true });
        void prior.then(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve("turn");
        });
      });
      if (turn === "aborted") return ABORTED;
      return await fn();
    } finally {
      release();
    }
  }

  function surfaceFor(sid: string, ctx: SupervisedGateCtx): ApprovalSurface<SupervisedGateCtx> {
    return {
      reasonPrefix: "supervised",
      reasonFor(outcome: BlockedOutcome, detail: { answer?: string }): string {
        if (outcome !== "denied") return outcome;
        const text = sanitizeOperatorText(detail.answer ?? "");
        // The "Deny" label / an empty or control-only answer carries no operator text.
        if (text === "" || text === OPT_DENY) return "denied";
        return `denied — operator said: "${text}"`;
      },
      buildPrompt(event: ToolCallEvent, info): ApprovalPrompt {
        const s = buildSupervisedSummary(event.toolName, event.input, ctx.cwd);
        const message = redact(summaryMarkdown(s));
        const plainMessage = redact(summaryPlain(s));
        const line = redact(s.line);
        return {
          title: s.title,
          body: message,
          plain: line,
          metadata: {
            kind: KIND_SUPERVISED,
            tool: s.tool,
            summary: Array.from(line).slice(0, SUMMARY_CAP).join(""),
            cwd: s.cwd,
            ...(s.path !== undefined ? { path: s.path } : {}),
            ...(s.diffStat !== undefined ? { diffStat: s.diffStat } : {}),
            ...(s.diff !== undefined ? { diff: redact(s.diff) } : {}),
            ...(s.command !== undefined ? { command: redact(s.command) } : {}),
            deadline: info.deadline,
            ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
            allowOther: true,
            message,
            plainMessage,
          },
        };
      },
      request(prompt: ApprovalPrompt) {
        const id = newId();
        const decision = deps
          .prompter.request({ id, question: prompt.title, options: [ALLOW_ONCE, OPT_DENY], metadata: prompt.metadata })
          .then((r) => ({ answer: r.cancelled ? undefined : r.answer, surface: surfaceOf(r.source) }));
        return { decision, cancel: () => deps.prompter.cancel(id) };
      },
      onDecision(record: DecisionRecord) {
        writeRecord(sid, {
          tool: record.toolName,
          summary: record.summary,
          outcome: record.outcome,
          answeredSurface: record.answeredSurface,
          via: "supervised",
        });
      },
    };
  }

  /** Raise the approval under the session mutex and map the settled outcome to a pi result. */
  async function askOperator(
    sid: string,
    event: ToolCallEvent,
    ctx: SupervisedGateCtx,
    policy: ToolPolicy,
  ): Promise<SupervisedGateResult> {
    const guard = createToolCallGuard<SupervisedGateCtx>({
      surface: surfaceFor(sid, ctx),
      policy,
      decide: decideSupervisedTool,
      timeoutMs: () => effectiveDeadlineMs(deps.getConfig().timeoutSeconds, deps.getBusTimeoutMs?.()),
      abortSignal: (c) => c?.signal,
      schedule: deps.setTimer,
      cancelTimer: deps.clearTimer,
      now: deps.now,
    });
    const result = await withMutex(sid, ctx.signal, () => guard(event, ctx));
    if (result === ABORTED) {
      emit(`[supervised] aborted tool=${event.toolName} session=${sid} (queued)`);
      return { block: true, reason: "supervised: aborted" };
    }
    return result ? { block: true, reason: result.reason } : undefined;
  }

  /** The operator already approved this call on an enriched path prompt: allow, log `via: "path-gate"`. */
  function consumeHandoff(sid: string, event: ToolCallEvent, ctx: SupervisedGateCtx): boolean {
    const id = typeof event.toolCallId === "string" && event.toolCallId ? event.toolCallId : undefined;
    if (!id || !deps.consumeHandoff?.(sid, id)) return false;
    const s = buildSupervisedSummary(event.toolName, event.input, ctx?.cwd ?? "");
    writeRecord(sid, { tool: event.toolName, summary: s.line, outcome: "approved", answeredSurface: "path-gate", via: "path-gate" });
    return true;
  }

  async function evaluate(event: ToolCallEvent, ctx: SupervisedGateCtx): Promise<SupervisedGateResult> {
    const sid = deps.sessionId();
    // Cheapest check first: a Full-access session pays one boolean read.
    if (!deps.getMode(sid)) return undefined;
    if (getOwner(sid) === "chat-gateway") return undefined; // the gateway guard decides alone
    const policy = policyFor(deps.getConfig().tools);
    const decision = decideSupervisedTool(event?.toolName, policy);
    if (decision.action === "allow") {
      logUnclassified(sid, event.toolName);
      return undefined;
    }
    if (decision.action === "deny") return { block: true, reason: "supervised: error" };
    if (consumeHandoff(sid, event, ctx)) return undefined;
    if (!ctx?.hasUI) {
      emit(`[supervised] no-ui tool=${event.toolName} session=${sid}`);
      return { block: true, reason: "supervised: no-ui" };
    }
    return askOperator(sid, event, ctx, policy);
  }

  /** The whole gate fails closed: any internal error blocks (never the fail-open host default). */
  const handler = async function onToolCall(event: ToolCallEvent, ctx: SupervisedGateCtx): Promise<SupervisedGateResult> {
    try {
      return await evaluate(event, ctx);
    } catch (err) {
      emit(`[supervised] error tool=${String(event?.toolName)} ${err instanceof Error ? err.message : String(err)}`);
      return { block: true, reason: "supervised: error" };
    }
  };

  return {
    handler,
    /** Drop every per-session structure (mutex chain, unclassified-log set) — `session_shutdown`. */
    clearSession(sessionId: string): void {
      chains.delete(sessionId);
      unclassified.delete(sessionId);
    },
    /** Test / diagnostics: which per-session structures still hold `sessionId`. */
    hasSessionState(sessionId: string): { chain: boolean; unclassified: boolean } {
      return { chain: chains.has(sessionId), unclassified: unclassified.has(sessionId) };
    },
  };
}
