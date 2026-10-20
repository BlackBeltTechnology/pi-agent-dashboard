/**
 * chat-gateway L3 guard — the companion pi extension loaded into
 * gateway-SPAWNED sessions.
 *
 * Why in-session and not at the gateway edge: the gateway sees the prompt, not
 * the agent's mid-turn tool decisions. The only real enforcement point is pi's
 * `tool_call` event, documented as a permission gate (`return { block: true }`).
 *
 * Escalation uses `ctx.ui.confirm`, which the dashboard bridge routes through
 * PromptBus → the gateway → a Discord yes/no. An unanswered approval FAILS
 * CLOSED (C3): the tool is blocked, never auto-allowed.
 *
 * Trust asymmetry (by design): attached sessions (owner's own open session) are
 * never handed this extension, so they stay ungated. This module is loaded ONLY
 * on the spawn path.
 *
 * The decision engine and guard core are shared
 * (`@blackbelt-technology/pi-dashboard-shared/tool-gate/*`); this file supplies the
 * chat-gateway `ApprovalSurface` and the extension entrypoint.
 *
 * See change: add-chat-gateway, add-supervised-tool-approval.
 */

import {
  ALLOW_ONCE,
  type ApprovalSurface,
  createToolCallGuard as createSharedGuard,
  type GuardResult,
} from "@blackbelt-technology/pi-dashboard-shared/tool-gate/guard.js";
import {
  clearToolGateOwner,
  markToolGateOwner,
} from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import { parseToolPolicy, type ToolPolicy } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/policy.js";

export type { GuardResult };

/** Minimal slice of the pi extension API this guard needs. */
export interface GuardPi {
  on(
    event: "tool_call",
    handler: (event: { toolName: string; toolCallId?: string; input?: unknown }, ctx: GuardCtx) => unknown,
  ): void;
  on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: GuardCtx) => unknown): void;
}

/** Minimal slice of pi's extension context this guard needs. */
export interface GuardCtx {
  ui: {
    confirm(title: string, message?: string): Promise<boolean>;
    notify?(message: string, kind?: string): void;
  };
  /** Session id access (session_start / session_shutdown owner marking). */
  sessionManager?: { getSessionId(): string };
}

export interface GuardOptions {
  policy: ToolPolicy;
  /** Approval window. Expiry = deny (C3). */
  timeoutMs?: number;
  /** Injectable timer for tests; defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** The gateway only permits these `defaultAction`s; `"allow"` is supervised-only. */
const GATEWAY_ALLOWED_DEFAULTS = ["deny", "approve"] as const;

const DEFAULT_TIMEOUT_MS = 60_000;

/** The single agent-visible reason for every negative approval path (unchanged pre-extraction). */
const APPROVAL_DENIED_REASON = "approval_denied_or_timed_out";

/**
 * The chat-gateway `ApprovalSurface`: existing chat copy, `chat-gateway` prefix,
 * `ctx.ui.confirm` transport (bridge → PromptBus → gateway → Discord yes/no).
 * `cancel()` is a no-op (card lifetime unchanged); denied / dismissed / timeout /
 * error all collapse to one reason so agent-visible behaviour is byte-identical.
 */
export const chatGatewaySurface: ApprovalSurface<GuardCtx> = {
  buildPrompt: (event) => ({
    title: `Allow tool "${event.toolName}"?`,
    body: "A chat user asked this session to run a tool that needs approval.",
    plain: `Allow tool "${event.toolName}"?`,
    metadata: {},
  }),
  reasonPrefix: "chat-gateway",
  reasonFor: () => APPROVAL_DENIED_REASON,
  request: (prompt, ctx) => ({
    // `Promise.resolve().then` turns a synchronous throw from confirm into a rejection (fail closed).
    decision: Promise.resolve()
      .then(() => ctx.ui.confirm(prompt.title, prompt.body))
      // A `false` is an explicit No: a non-`Allow once` string settles `denied` (the core reads a bare
      // `undefined` as a dismiss). The agent-visible reason is the same single collapsed string.
      .then((ok) => ({ answer: ok === true ? ALLOW_ONCE : "Deny", surface: "chat-gateway" })),
    cancel: () => {},
  }),
  onDecision: (record) => {
    console.log(`[chat-gateway] tool approval ${record.toolName}: ${record.outcome}`);
  },
};

/**
 * Build the `tool_call` handler. Exported (and timer-injectable) so the whole
 * decision → approval → block path is unit-testable without pi. The policy is
 * validated through `parseToolPolicy` with `allowedDefaults: ["deny","approve"]`,
 * so a raw `"allow"` can never reach the gateway path.
 */
export function createToolCallGuard(opts: GuardOptions) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS;
  return createSharedGuard<GuardCtx>({
    surface: chatGatewaySurface,
    policy: parseToolPolicy(opts.policy, { allowedDefaults: GATEWAY_ALLOWED_DEFAULTS }),
    // The shared core needs strictly-positive ms; 0 keeps its "expire at once" meaning.
    timeoutMs: Math.max(1, timeoutMs),
    schedule: opts.schedule,
    cancelTimer: opts.cancel,
  });
}

/**
 * The pi extension entrypoint. `pi-extension` packages load this as their
 * default export; the policy comes from the gateway's config, projected into
 * the spawned session's environment at spawn time as
 * `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` (the host maps
 * `extensionConfig["chat-gateway-guard"].policy` to that env name).
 *
 * pi invokes the factory with ONE argument (its API), so `options` from the
 * loader is effectively empty on a real session — the ENV is the real channel.
 * A missing/unparseable policy defaults to `{ defaultAction: "deny" }` (deny
 * everything), so a delivery failure fails CLOSED rather than disabling the
 * guard's decisions.
 */
export function policyFromEnv(
  env: Record<string, string | undefined> = process.env,
): ToolPolicy {
  const raw = env.PI_EXT_CHAT_GATEWAY_GUARD_POLICY;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parseToolPolicy(parsed, { allowedDefaults: GATEWAY_ALLOWED_DEFAULTS });
      }
    } catch {
      // fall through to deny-all
    }
  }
  return { defaultAction: "deny" };
}

export default function chatGatewayGuard(pi: GuardPi, options?: Partial<GuardOptions>): void {
  const policy: ToolPolicy = options?.policy ?? policyFromEnv();
  // Owner marking needs a session id, so it happens in the session hooks —
  // never at registration. Ids we marked are remembered so shutdown clears
  // even when its ctx can no longer name the session.
  const marked = new Set<string>();
  pi.on("session_start", (_event, ctx) => {
    const id = ctx?.sessionManager?.getSessionId?.();
    if (typeof id !== "string" || id === "") return;
    markToolGateOwner(id, "chat-gateway");
    marked.add(id);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    const id = ctx?.sessionManager?.getSessionId?.();
    const ids = typeof id === "string" && id !== "" ? [id] : [...marked];
    for (const sid of ids) {
      clearToolGateOwner(sid);
      marked.delete(sid);
    }
  });
  pi.on("tool_call", createToolCallGuard({ ...options, policy }));
}
