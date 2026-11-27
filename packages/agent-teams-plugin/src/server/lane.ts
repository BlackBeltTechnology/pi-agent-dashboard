/**
 * Request-lane entries (task 2.6, design D3): `agent-teams/call|hello|busy|idle|ack`
 * as `(payload, meta)` handlers registered `{hubLocalOnly:true}`. The caller is
 * resolved from `meta.sessionId` ONLY (`ops.resolveCaller`); a payload never
 * names an identity. A session that is not hub-local gets `origin_denied` before
 * any state is read or written (the host enforces `hubLocalOnly` too; this is
 * the plugin's own fail-closed check).
 * See change: add-agent-teams-core.
 */
import type {
  PluginRequestHandler,
  ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  type HelloPayload,
  type IdlePayload,
  LANE_ACK,
  LANE_BUSY,
  LANE_CALL,
  LANE_HELLO,
  LANE_IDLE,
  type OpResult,
} from "../shared/protocol.js";
import type { ExtensionPoints } from "./extension-points.js";
import type { Ops } from "./ops.js";
import type { Logger } from "./types.js";

type LaneMeta = Parameters<PluginRequestHandler>[1];

const deny = (error: "origin_denied" | "invalid_args", message?: string): OpResult<never> => ({ ok: false, error, ...(message ? { message } : {}) });

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseHello(payload: unknown): HelloPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const get = (k: string) => (Object.hasOwn(payload, k) ? payload[k] : undefined);
  const isIdle = get("isIdle");
  const toolsActive = get("toolsActive");
  const guardActive = get("guardActive");
  const confined = get("confined");
  const policyHash = get("policyHash");
  const sessionFile = get("sessionFile");
  const planToolsActive = get("planToolsActive");
  if (planToolsActive !== undefined && typeof planToolsActive !== "boolean") return undefined;
  if (typeof isIdle !== "boolean" || typeof toolsActive !== "boolean" || typeof guardActive !== "boolean" || typeof confined !== "boolean") return undefined;
  if ((policyHash !== undefined && typeof policyHash !== "string") || (sessionFile !== undefined && typeof sessionFile !== "string")) return undefined;
  return {
    isIdle,
    toolsActive,
    guardActive,
    confined,
    ...(typeof policyHash === "string" ? { policyHash: policyHash.slice(0, 200) } : {}),
    ...(typeof sessionFile === "string" ? { sessionFile: sessionFile.slice(0, 1000) } : {}),
    ...(typeof planToolsActive === "boolean" ? { planToolsActive } : {}),
  };
}

function parseIdle(payload: unknown): IdlePayload | undefined {
  if (!isRecord(payload)) return undefined;
  const settleId = Object.hasOwn(payload, "settleId") ? payload.settleId : undefined;
  if (typeof settleId !== "number" || !Number.isInteger(settleId)) return undefined;
  const text = (k: string) => (Object.hasOwn(payload, k) && typeof payload[k] === "string" ? (payload[k] as string) : undefined);
  const finalText = text("finalText");
  const error = text("error");
  return {
    settleId,
    ...(finalText !== undefined ? { finalText } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(Object.hasOwn(payload, "aborted") && payload.aborted === true ? { aborted: true } : {}),
  };
}

export type LaneHandler = (payload: unknown, meta: LaneMeta) => OpResult<unknown> | Promise<OpResult<unknown>>;

export function createLaneHandlers(deps: { ops: Ops; ext: ExtensionPoints }): Record<string, LaneHandler> {
  const { ops, ext } = deps;
  /** Common admission: seal registries, refuse non-local origin, resolve the caller from the socket. */
  const admit = (meta: LaneMeta, payload?: unknown) => {
    ext.seal();
    if (meta?.origin?.local !== true) return undefined;
    return ops.resolveCaller({ sessionId: meta.sessionId }, payload);
  };
  /** A present-but-invalid proxied `as` (in-process): the caller's rejection code, never a fallback identity. */
  const refusal = (caller: { rejected?: "forbidden" | "member_gone" }): OpResult<never> | undefined => (caller.rejected ? { ok: false, error: caller.rejected } : undefined);

  return {
    [LANE_CALL]: (payload, meta) => {
      const caller = admit(meta, payload);
      if (!caller) return deny("origin_denied");
      const refused = refusal(caller);
      if (refused) return refused;
      if (!isRecord(payload)) return deny("invalid_args", "payload must be {op, args}");
      return ops.callAsync(Object.hasOwn(payload, "op") ? payload.op : undefined, Object.hasOwn(payload, "args") ? payload.args : undefined, caller);
    },
    [LANE_HELLO]: (payload, meta) => {
      const caller = admit(meta, payload);
      if (!caller) return deny("origin_denied");
      const refused = refusal(caller);
      if (refused) return refused;
      const hello = parseHello(payload);
      return hello ? ops.hello(hello, caller) : deny("invalid_args");
    },
    [LANE_BUSY]: (payload, meta) => {
      const caller = admit(meta, payload);
      if (!caller) return deny("origin_denied");
      return refusal(caller) ?? ops.busy({}, caller);
    },
    [LANE_IDLE]: (payload, meta) => {
      const caller = admit(meta, payload);
      if (!caller) return deny("origin_denied");
      const refused = refusal(caller);
      if (refused) return refused;
      const idle = parseIdle(payload);
      return idle ? ops.idle(idle, caller) : deny("invalid_args");
    },
    [LANE_ACK]: (payload, meta) => {
      const caller = admit(meta, payload);
      if (!caller) return deny("origin_denied");
      const refused = refusal(caller);
      if (refused) return refused;
      const ids = isRecord(payload) && Object.hasOwn(payload, "ids") && Array.isArray(payload.ids) ? payload.ids.slice(0, 500) : undefined;
      return ids ? ops.ack({ ids: ids as number[] }, caller) : deny("invalid_args");
    },
  };
}

/**
 * Register every handler hub-local. The seam is optional (old hosts): when
 * absent, log once and return false so the plugin disables its tools
 * (`no_handler` reaches the agent per `docs/plugin-seams.md`).
 */
export function registerLane(
  host: Pick<ServerPluginContext, "registerPiRequestHandler">,
  handlers: Record<string, LaneHandler>,
  logger: Logger,
): boolean {
  if (!host.registerPiRequestHandler) {
    logger.warn("agent-teams: request lane unavailable on this host; team tools are disabled");
    return false;
  }
  for (const [type, handler] of Object.entries(handlers)) {
    host.registerPiRequestHandler(type, handler as PluginRequestHandler, { hubLocalOnly: true });
  }
  return true;
}
