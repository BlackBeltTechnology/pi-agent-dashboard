/**
 * The ONE path that drives a session from chat.
 *
 * `dispatchToSession` takes the chokepoint's `Grant` as a REQUIRED argument, so
 * a new call site cannot silently skip authorization: it has to produce a grant
 * (or an explicit `teamControlled: false`) to compile. The runtime guard backs
 * that up — even when the type is bypassed with `as any`, a missing grant with
 * the layer installed leaves the session untouched rather than producing a
 * phantom success.
 *
 * See change: add-chat-gateway-team-controls (task 3.14, X11).
 */
import type { HostSeam } from "./seam.js";
import type { Grant } from "./team/authorize.js";

export type DispatchResult = { ok: true } | { ok: false; reason: "missing_grant" | "unreachable" };

export interface DispatchContext {
  /**
   * The grant returned by the chokepoint. Required whenever the team-controls
   * layer is installed; only the layer-absent case may omit it.
   */
  grant?: Grant;
  /** Whether the team-controls layer gates this gateway. */
  teamControlled: boolean;
}

export function dispatchToSession(
  seam: Pick<HostSeam, "sendPrompt">,
  ctx: DispatchContext,
  req: { sessionId: string; text: string; delivery: "followUp" | "steer" },
): DispatchResult {
  // No policy layer installed -> L1/L2 already gated this request upstream.
  if (ctx.teamControlled && ctx.grant?.kind !== "grant") {
    return { ok: false, reason: "missing_grant" };
  }
  return seam.sendPrompt(req.sessionId, req.text, req.delivery)
    ? { ok: true }
    : { ok: false, reason: "unreachable" };
}
