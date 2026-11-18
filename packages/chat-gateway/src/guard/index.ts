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
 * Readiness (harden-agent-tool-guards D6): at `session_start` the guard announces
 * `chat_gateway_guard_ready` with the spawn's token over `dashboard:plugin-message`, so the
 * gateway can hold the triggering message back until the guard is proven loaded (pi treats an
 * unresolvable `-e <ref>` as non-fatal, so a typo'd `guardExtension` would otherwise run ungated).
 * A custom `guardExtension` MUST do the same or its spawns are refused.
 *
 * Trust asymmetry (by design): attached sessions (owner's own open session) are
 * never handed this extension, so they stay ungated. This module is loaded ONLY
 * on the spawn path.
 *
 * See change: add-chat-gateway.
 */

import { CHAT_GATEWAY_PLUGIN_ID, GUARD_READY_MESSAGE, GUARD_TOKEN_ENV } from "../shared/guard-ready.js";
import { decideToolCall, type ToolPolicy } from "./policy.js";

/** Minimal slice of the pi extension API this guard needs. */
export interface GuardPi {
  on(
    event: "tool_call",
    handler: (event: { toolName: string; toolCallId?: string; input?: unknown }, ctx: GuardCtx) => unknown,
  ): void;
  on(event: "session_start", handler: () => unknown): void;
  /** Bridge channel: `dashboard:plugin-message` is forwarded to the plugin server with the sender's session id. */
  events?: { emit: (name: string, payload: unknown) => void };
}

/** Minimal slice of pi's extension context this guard needs. */
export interface GuardCtx {
  ui: {
    confirm(title: string, message?: string): Promise<boolean>;
    notify?(message: string, kind?: string): void;
  };
}

export interface GuardOptions {
  policy: ToolPolicy;
  /** Approval window. Expiry = deny (C3). */
  timeoutMs?: number;
  /** Injectable timer for tests; defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export type GuardResult = { block: true; reason: string; terminate?: boolean } | undefined;

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Build the `tool_call` handler. Exported (and timer-injectable) so the whole
 * decision → approval → block path is unit-testable without pi.
 */
export function createToolCallGuard(opts: GuardOptions) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS;
  const schedule =
    opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancel =
    opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  /** Resolve `false` after `timeoutMs`; an unanswered approval must DENY. */
  function withTimeout(promise: Promise<boolean>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const handle = schedule(() => {
        if (settled) return;
        settled = true;
        resolve(false); // fail closed
      }, timeoutMs);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cancel(handle);
          resolve(value);
        },
        () => {
          // A throwing/failing confirm DENIES — never escalate to allow.
          if (settled) return;
          settled = true;
          cancel(handle);
          resolve(false);
        },
      );
    });
  }

  return async function onToolCall(
    event: { toolName: string },
    ctx: GuardCtx,
  ): Promise<GuardResult> {
    const decision = decideToolCall(event?.toolName, opts.policy);
    if (decision.action === "allow") return undefined;
    if (decision.action === "deny") {
      return { block: true, reason: `chat-gateway: ${decision.reason}` };
    }

    const approved = await withTimeout(
      Promise.resolve().then(() =>
        ctx.ui.confirm(
          `Allow tool "${event.toolName}"?`,
          "A chat user asked this session to run a tool that needs approval.",
        ),
      ),
    );
    if (approved) return undefined;
    return { block: true, reason: "chat-gateway: approval_denied_or_timed_out" };
  };
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
      const parsed = JSON.parse(raw) as ToolPolicy;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to deny-all
    }
  }
  return { defaultAction: "deny" };
}

/** The spawn's readiness token (same env projection as the policy); absent/empty → no announcement. */
export function tokenFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env[GUARD_TOKEN_ENV];
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

export default function chatGatewayGuard(pi: GuardPi, options?: Partial<GuardOptions>): void {
  const policy: ToolPolicy = options?.policy ?? policyFromEnv();
  // The enforcement point is registered BEFORE readiness can be announced.
  pi.on("tool_call", createToolCallGuard({ ...options, policy }));
  const token = tokenFromEnv();
  if (!token) return; // no token (older gateway / manual load): nothing to prove readiness to
  pi.on("session_start", () => {
    pi.events?.emit("dashboard:plugin-message", {
      pluginId: CHAT_GATEWAY_PLUGIN_ID,
      messageType: GUARD_READY_MESSAGE,
      payload: { token },
    });
  });
}
