/**
 * Flow commands owned by the flows plugin (replaces core `flow_control` /
 * `flow_management`). One validator + relay, two entry points:
 *
 * - `plugin_action { pluginId: "flows", action, sessionId, payload }` (WS);
 * - `POST /api/plugins/flows/control { sessionId, action, flowName?, task?, enabled? }`
 *   (operate authority + network guard; the REST replacement of
 *   `/api/session/:id/flow-control`).
 *
 * Each action relays FIXED pi event names through `emitEventToSession` (the
 * manifest `emits` gate admits exactly these). An ACP session is refused with
 * `unsupported_for_acp` before any relay. A rejected command emits nothing,
 * logs a warning and bumps the host's rejected-plugin-action counter.
 * See change: update-flows-plugin (D2; security-hardening).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import { handleSetEditMode, type SetEditModeDeps } from "./edit-mode.js";

/** The six flow-control actions (both entry points). */
export const FLOW_CONTROL_ACTIONS = [
  "flow.abort",
  "flow.toggle-autonomous",
  "flow.dismiss-summary",
  "flow.run",
  "flow.delete",
  "flow.set-edit-mode",
] as const;
type FlowControlAction = (typeof FLOW_CONTROL_ACTIONS)[number];

function isFlowControlAction(a: unknown): a is FlowControlAction {
  return typeof a === "string" && (FLOW_CONTROL_ACTIONS as readonly string[]).includes(a);
}

/** Same code the core ACP guard answers (`acp-guard.ts`). */
const UNSUPPORTED_FOR_ACP = "unsupported_for_acp";

const MAX_FLOW_NAME = 200;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * A valid flow id: a non-empty trimmed string (≤ 200 chars) with no `/`, `\`,
 * `..` or control character. `research` and `batch:apply` are valid (G1).
 */
function isValidFlowName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s === "" || s !== v || s.length > MAX_FLOW_NAME) return false;
  return !s.includes("/") && !s.includes("\\") && !s.includes("..") && !CONTROL_CHARS.test(s);
}

/** pi-side notice after a delete (pi TUI text, not dashboard UI). */
function deletedNotice(flowName: string): string {
  return ["Flow", JSON.stringify(flowName), "deleted."].join(" ");
}

export type FlowControlResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

export interface FlowControlDeps extends Omit<SetEditModeDeps, "logger"> {
  sessionManager: SetEditModeDeps["sessionManager"] & { getSession?(id: string): unknown };
  logger: { info(m: string): void; warn(m: string): void };
  recordRejectedAction?: () => void;
}

function sessionDriver(deps: FlowControlDeps, sessionId: string): { found: boolean; driver?: unknown } {
  let s: unknown;
  try {
    s = deps.sessionManager.getSession?.(sessionId);
  } catch {
    s = undefined;
  }
  if (!s || typeof s !== "object") return { found: false };
  return { found: true, driver: (s as { driver?: unknown }).driver };
}

function reject(
  deps: FlowControlDeps,
  status: 400 | 404 | 409,
  code: string,
  error: string,
  sessionId: string,
  action: string,
): FlowControlResult {
  deps.logger.warn(`flows control rejected action=${action.slice(0, 64)} session=${sessionId} code=${code}: ${error}`);
  deps.recordRejectedAction?.();
  return { ok: false, status, code, error };
}

/**
 * Validate and relay one flow-control command. `requireSession`: the REST
 * path answers 404 for an unknown session; the WS path relays anyway (the
 * bridge drops it, as before). Never throws.
 */
export function runFlowControl(
  deps: FlowControlDeps,
  sessionId: string,
  action: string,
  payload: Record<string, unknown>,
  opts: { requireSession?: boolean } = {},
): FlowControlResult {
  if (!isFlowControlAction(action)) {
    return reject(deps, 400, "unknown_action", `unknown flows action: ${action.slice(0, 64)}`, sessionId, action);
  }
  const { found, driver } = sessionDriver(deps, sessionId);
  if (opts.requireSession && !found) return reject(deps, 404, "session_not_found", "session not found", sessionId, action);
  if (driver === "acp") {
    return reject(deps, 409, UNSUPPORTED_FOR_ACP, `${action} is not supported for ACP sessions (${UNSUPPORTED_FOR_ACP})`, sessionId, action);
  }
  const emit = (event: string, data: Record<string, unknown>) => {
    const delivered = deps.emitEventToSession(sessionId, event, data);
    deps.logger.info(`${action} → ${event} session=${sessionId} delivered=${delivered}`);
  };

  switch (action) {
    case "flow.abort":
      // Also abort the architect (mutually exclusive with a run; the
      // irrelevant emit is a no-op on the pi-flows side).
      emit("flow:abort", {});
      emit("flow:architect-abort", {});
      return { ok: true };
    case "flow.toggle-autonomous":
      emit("flow:toggle-autonomous", {});
      return { ok: true };
    case "flow.dismiss-summary":
      emit("flow:summary-dismissed", {});
      return { ok: true };
    case "flow.delete": {
      const flowName = payload.flowName;
      if (!isValidFlowName(flowName)) return reject(deps, 400, "invalid_flow_name", "invalid flowName", sessionId, action);
      emit("flow:delete-request", { flowName });
      // pi-flows TUI notice text (sent into pi, not rendered by the dashboard);
      // the same text the retired core handler sent.
      emit("flow:notify", { message: deletedNotice(flowName), level: "info" });
      return { ok: true };
    }
    case "flow.run": {
      // `flow` (intent path) or `flowName`.
      const flowName = payload.flowName ?? payload.flow;
      if (!isValidFlowName(flowName)) return reject(deps, 400, "invalid_flow_name", "invalid flowName", sessionId, action);
      if (payload.task !== undefined && typeof payload.task !== "string") {
        return reject(deps, 400, "invalid_payload", "task must be a string", sessionId, action);
      }
      const inputs = payload.inputs;
      if (inputs !== undefined && (inputs === null || typeof inputs !== "object" || Array.isArray(inputs))) {
        return reject(deps, 400, "invalid_payload", "inputs must be an object", sessionId, action);
      }
      const task = typeof payload.task === "string" ? payload.task.trim() : "";
      const data: Record<string, unknown> = { flowName };
      if (task) data.task = task;
      if (inputs) data.inputs = inputs;
      emit("flow:run", data);
      return { ok: true };
    }
    case "flow.set-edit-mode": {
      if (typeof payload.enabled !== "boolean") {
        return reject(deps, 400, "invalid_payload", "enabled must be a boolean", sessionId, action);
      }
      // Emits only when the desired value differs from the effective one
      // (flows-edit-mode-settings; G16). The emit itself is synchronous.
      void handleSetEditMode(deps, sessionId, { enabled: payload.enabled }).catch((err) =>
        deps.logger.warn(`flow.set-edit-mode failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      return { ok: true };
    }
  }
}

export interface FlowControlRouteDeps extends FlowControlDeps {
  fastify: ServerPluginContext["fastify"];
  networkGuard: ServerPluginContext["networkGuard"];
  /** `ctx.identity?.hasOperateAuthority`; absent ⇒ refuse. */
  hasOperateAuthority?: (request: unknown) => boolean;
}

/** `POST /api/plugins/flows/control` — operate authority + network guard. */
export async function registerFlowControlRoute(deps: FlowControlRouteDeps): Promise<void> {
  await deps.fastify.register(async (scope) => {
    await scope.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });
    scope.post("/api/plugins/flows/control", { preHandler: deps.networkGuard }, async (req, reply) => {
      if (deps.hasOperateAuthority?.(req) !== true) {
        return reply.code(403).send({ success: false, error: "operate_required" });
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const sessionId = body.sessionId;
      if (typeof sessionId !== "string" || sessionId === "" || sessionId.length > 256) {
        return reply.code(400).send({ success: false, error: "sessionId is required" });
      }
      const action = typeof body.action === "string" ? body.action : "";
      const payload: Record<string, unknown> = {};
      for (const k of ["flowName", "task", "enabled", "inputs"]) {
        if (Object.prototype.hasOwnProperty.call(body, k)) payload[k] = body[k];
      }
      const r = runFlowControl(deps, sessionId, action, payload, { requireSession: true });
      if (!r.ok) return reply.code(r.status).send({ success: false, error: r.error, code: r.code });
      return { success: true };
    });
  });
}
