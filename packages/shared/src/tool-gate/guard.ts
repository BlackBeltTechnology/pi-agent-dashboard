/**
 * Shared `tool_call` guard core — decide → request approval → single timeout →
 * map outcome → `{ block, reason }`. FAILS CLOSED: an unanswered approval, a
 * throwing or rejecting surface, an abort and a gate error all BLOCK; nothing
 * ever auto-allows.
 *
 * Surface-agnostic: each caller injects an `ApprovalSurface` (copy, reason
 * prefix, transport). There is deliberately NO default presenter — omitting
 * `surface` is a compile-time error. The timeout is a strictly-positive-ms
 * parameter; each surface converts its own convention before calling in.
 *
 * Supervised-only layers (per-call mode flag, case-folding, mutex, path-gate
 * hand-off, owner self-disable) live OUTSIDE this core, in the bridge gate.
 * Imports no dashboard protocol types.
 *
 * Extracted from `packages/chat-gateway/src/guard/index.ts`.
 * See change: add-chat-gateway, add-supervised-tool-approval (design D6/D9/D10).
 */
import { decideToolCall, type ToolDecision, type ToolPolicy } from "./policy.js";

/** The one answer string that runs the tool; everything else blocks. */
export const ALLOW_ONCE = "Allow once";

export type GateOutcome = "approved" | "denied" | "dismissed" | "timeout" | "aborted" | "error";
export type BlockedOutcome = Exclude<GateOutcome, "approved">;

/** Minimal slice of pi's `tool_call` event. */
export interface ToolCallEvent {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
}

/** Timing handed to `buildPrompt` once the prompt is about to open. */
export interface PromptInfo {
  timeoutMs: number;
  /** Epoch ms at which the gate's own timer fires. */
  deadline: number;
}

export interface ApprovalPrompt {
  title: string;
  body: string;
  /** Plain-text twin (terminal surfaces); also the decision-record summary. */
  plain: string;
  metadata: Record<string, unknown>;
}

export interface ApprovalAnswer {
  /** `ALLOW_ONCE` runs the tool; `undefined` = no answer (dismissed); other text = deny. */
  answer: string | undefined;
  /** Surface label for audit (`dashboard` | `tui` | `chat-gateway` | `__bus__` …). */
  surface: string;
}

export interface ApprovalRequest {
  decision: Promise<ApprovalAnswer>;
  /** Withdraw the pending prompt (gate-initiated: timeout / abort). May be a no-op. */
  cancel(): void;
}

export interface DecisionRecord {
  toolName: string;
  toolCallId?: string;
  /** `prompt.plain` (uncapped, unredacted — the caller caps/redacts before persisting). */
  summary: string;
  outcome: GateOutcome;
  answeredSurface: string;
  /** Operator text of a non-label answer, when the outcome is `denied`. */
  answer?: string;
}

export interface ApprovalSurface<Ctx = unknown> {
  buildPrompt(event: ToolCallEvent, info: PromptInfo): ApprovalPrompt;
  /** Block-reason prefix, e.g. `"chat-gateway"` | `"supervised"`. */
  reasonPrefix: string;
  /**
   * Reason suffix for a blocked outcome (default: the outcome name). A surface
   * may collapse several outcomes into one string or carry operator text
   * (`detail.answer`, present for `denied`).
   */
  reasonFor?(outcome: BlockedOutcome, detail: { answer?: string }): string;
  /** Open the approval. May throw or reject — both fail closed (`error`). */
  request(prompt: ApprovalPrompt, ctx: Ctx): ApprovalRequest;
  /** Called once per requested approval, with the final outcome. Never gates. */
  onDecision(record: DecisionRecord): void;
}

export type GuardResult = { block: true; reason: string; terminate?: boolean } | undefined;

export interface GuardOptions<Ctx = unknown> {
  /** Required: no default presenter exists. */
  surface: ApprovalSurface<Ctx>;
  policy: ToolPolicy | (() => ToolPolicy);
  /** Strictly-positive ms; a function is evaluated per call when the prompt opens. */
  timeoutMs: number | (() => number);
  /** Decision engine; defaults to the exact-match `decideToolCall`. */
  decide?: (toolName: string, policy: ToolPolicy) => ToolDecision;
  /** The call's abort signal, if any; abort cancels the pending approval. */
  abortSignal?: (ctx: Ctx) => AbortSignal | undefined;
  /** Injectable timer / clock for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelTimer?: (handle: unknown) => void;
  now?: () => number;
}

function positiveMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`tool-gate: timeoutMs must be a finite number > 0 (got ${String(value)})`);
  }
  return value;
}

function toRecord(event: ToolCallEvent, prompt: ApprovalPrompt | undefined, s: Settled): DecisionRecord {
  const record: DecisionRecord = {
    toolName: String(event?.toolName ?? ""),
    summary: prompt?.plain ?? "",
    outcome: s.outcome,
    answeredSurface: s.answeredSurface,
  };
  if (event?.toolCallId !== undefined) record.toolCallId = event.toolCallId;
  if (s.answer !== undefined) record.answer = s.answer;
  return record;
}

interface Settled {
  outcome: GateOutcome;
  answeredSurface: string;
  answer?: string;
}

/**
 * Build the `tool_call` handler. Exported (and timer-injectable) so the whole
 * decision → approval → block path is unit-testable without pi.
 */
export function createToolCallGuard<Ctx = unknown>(opts: GuardOptions<Ctx>) {
  const { surface } = opts;
  const decide = opts.decide ?? decideToolCall;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancelTimer = opts.cancelTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = opts.now ?? Date.now;
  if (typeof opts.timeoutMs === "number") positiveMs(opts.timeoutMs);

  const blockReason = (outcome: BlockedOutcome, answer?: string): string => {
    let suffix: string = outcome;
    try {
      suffix = surface.reasonFor?.(outcome, { answer }) ?? outcome;
    } catch {
      suffix = "error";
    }
    return `${surface.reasonPrefix}: ${suffix}`;
  };

  return async function onToolCall(event: ToolCallEvent, ctx: Ctx): Promise<GuardResult> {
    let prompt: ApprovalPrompt | undefined;
    let settled: Settled;
    try {
      const policy = typeof opts.policy === "function" ? opts.policy() : opts.policy;
      const decision = decide(event?.toolName, policy);
      if (decision.action === "allow") return undefined;
      if (decision.action === "deny") {
        return { block: true, reason: `${surface.reasonPrefix}: ${decision.reason}` };
      }

      const signal = opts.abortSignal?.(ctx);
      if (signal?.aborted) {
        settled = { outcome: "aborted", answeredSurface: "aborted" };
      } else {
        const timeoutMs = positiveMs(typeof opts.timeoutMs === "function" ? opts.timeoutMs() : opts.timeoutMs);
        prompt = surface.buildPrompt(event, { timeoutMs, deadline: now() + timeoutMs });
        const req = surface.request(prompt, ctx);
        settled = await awaitOutcome(req, timeoutMs, signal);
      }
    } catch {
      settled = { outcome: "error", answeredSurface: "error" };
    }

    try {
      surface.onDecision(toRecord(event, prompt, settled));
    } catch {
      // An audit failure never changes the decision.
    }

    if (settled.outcome === "approved") return undefined;
    return { block: true, reason: blockReason(settled.outcome as BlockedOutcome, settled.answer) };
  };

  /** One settlement: whichever of answer / timer / abort lands first; the rest are ignored. */
  function awaitOutcome(req: ApprovalRequest, timeoutMs: number, signal: AbortSignal | undefined): Promise<Settled> {
    return new Promise<Settled>((resolve) => {
      let done = false;
      let handle: unknown;
      const onAbort = () => selfCancel("aborted");
      const settle = (s: Settled) => {
        if (done) return;
        done = true;
        if (handle !== undefined) cancelTimer(handle);
        signal?.removeEventListener("abort", onAbort);
        resolve(s);
      };
      // Mark done BEFORE cancelling: the bus resolves a cancel as "dismissed",
      // which must not be mistaken for a client dismiss.
      function selfCancel(why: "timeout" | "aborted") {
        if (done) return;
        settle({ outcome: why, answeredSurface: why });
        try {
          req.cancel();
        } catch {
          // Already blocked; a failed withdrawal cannot un-block.
        }
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        req.decision.then(
          (d) => {
            try {
              if (d.answer === ALLOW_ONCE) settle({ outcome: "approved", answeredSurface: d.surface });
              else if (d.answer === undefined) settle({ outcome: "dismissed", answeredSurface: d.surface });
              else settle({ outcome: "denied", answeredSurface: d.surface, answer: d.answer });
            } catch {
              settle({ outcome: "error", answeredSurface: "error" });
            }
          },
          () => settle({ outcome: "error", answeredSurface: "error" }),
        );
        handle = schedule(() => selfCancel("timeout"), timeoutMs);
      } catch {
        settle({ outcome: "error", answeredSurface: "error" });
      }
    });
  }
}
