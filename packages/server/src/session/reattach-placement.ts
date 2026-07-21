/**
 * Reattach placement policy: when a bridge sends `session_register` with
 * `registerReason: "reattach"` (i.e. the dashboard restarted while pi
 * stayed alive), this module decides how the re-registered session id
 * should be placed in the cwd's `sessionOrder`.
 *
 * Pure decision logic is extracted into `decideReattachAction` so it
 * can be unit-tested without spinning up managers or browser gateways;
 * `applyReattachPolicy` is the I/O-bearing entry point that calls it
 * and performs the actual mutation + broadcast.
 *
 * See change: reattach-move-to-front.
 */
import type { ReattachPlacement } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SessionManager } from "./memory-session-manager.js";
import type { SessionOrderManager } from "./session-order-manager.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";

export type ReattachAction = "moveToFront" | "preserve";

/**
 * Pure helper: decide whether the policy demands a `moveToFront` for a
 * reattaching session given the current configured placement and the
 * session's current status.
 *
 * Mapping:
 * - `"always"`     → always `"moveToFront"`
 * - `"streaming-only"` → `"moveToFront"` iff `status === "streaming"`
 * - `"preserve"`   → always `"preserve"`
 */
export function decideReattachAction(
  policy: ReattachPlacement,
  status: SessionStatus | undefined,
): ReattachAction {
  switch (policy) {
    case "always":
      return "moveToFront";
    case "streaming-only":
      return status === "streaming" ? "moveToFront" : "preserve";
    case "preserve":
    default:
      return "preserve";
  }
}

/**
 * Apply the configured reattach placement policy to a session that just
 * re-registered with `registerReason: "reattach"`.
 *
 * Calls `sessionOrderManager.moveToFront` and broadcasts
 * `sessions_reordered` only when the policy demands it. No-op when the
 * session no longer exists in the manager, when its status is
 * `"ended"`, or when the policy resolves to `"preserve"`.
 *
 * `priorStatus` is the session's status BEFORE `register()` coerced it
 * to `"active"`. It's the meaningful signal for `"streaming-only"`:
 * a session mid-stream when the dashboard rebooted carries
 * `priorStatus === "streaming"`, even though `session.status` is now
 * `"active"`. Pass `undefined` when the prior status is unknown
 * (first-ever register), in which case the helper falls back to
 * `session.status`.
 * See change: reattach-move-to-front.
 */
export function applyReattachPolicy(
  sessionId: string,
  cwd: string,
  policy: ReattachPlacement,
  deps: {
    sessionManager: SessionManager;
    sessionOrderManager: SessionOrderManager;
    browserGateway: BrowserGateway;
  },
  priorStatus?: SessionStatus,
): ReattachAction {
  const session = deps.sessionManager.get(sessionId);
  if (!session) return "preserve";
  // Defensive: if the session somehow ended between register and this
  // hook firing, skip — the alive→ended branch in server.ts handles it.
  if (session.status === "ended") return "preserve";

  // Use prior status when known so `streaming-only` honors a session
  // that was streaming when the dashboard went down. `register()`
  // unconditionally sets `status: "active"`, so without this fallback
  // `streaming-only` would silently behave as `preserve`.
  const effectiveStatus = priorStatus ?? session.status;
  const action = decideReattachAction(policy, effectiveStatus);
  if (action === "moveToFront") {
    deps.sessionOrderManager.moveToFront(cwd, sessionId);
    const next = deps.sessionOrderManager.getOrder(cwd) ?? [];
    deps.browserGateway.broadcastToAll({
      type: "sessions_reordered",
      cwd,
      sessionIds: next,
    });
  }
  return action;
}
